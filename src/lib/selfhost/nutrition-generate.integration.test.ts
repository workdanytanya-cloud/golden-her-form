import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { closePostgresPool } from "./db";
import { createSession } from "./local-auth";
import { csrfCookieName, sessionCookieName } from "./config";
import { handleSelfhostRequest } from "./http";
import { loadConstructorPlanPg, seedNutritionCatalog } from "./postgres-nutrition";
import { fingerprintExactDay } from "@/lib/nutrition-constructor/week-cycle";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";

const url = process.env.SELFHOST_NUTRITION_GENERATE_TEST_DATABASE_URL;
const run = Boolean(url);
const ADMIN = "32000000-0000-4000-8000-000000000001";
const CLIENT = "32000000-0000-4000-8000-000000000002";
const COURSE = "32000000-0000-4000-8000-000000000011";

describe.runIf(run)("nutrition generate endpoint PostgreSQL integration", () => {
  let pool: pg.Pool;
  let cookie = "";
  let excluded: string[] = [];
  let excludedSet = new Set<string>();
  const csrf = "integration-csrf-token";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATA_BACKEND = "postgres";
    process.env.AUTH_BACKEND = "local";
    process.env.SELFHOST_MODE = "1";
    pool = new pg.Pool({ connectionString: url });
    await applyMigrations(pool);
    await seedNutritionCatalog(pool);
    excluded = (
      await pool.query(`SELECT id FROM food_products WHERE slug = ANY($1::text[])`, [
        [
          "tomato",
          "lemon",
          "hard-cheese",
          "butter",
          "canned-tuna",
          "canned-corn",
          "stevia-candy",
          "marshmallow",
          "dried-mango",
          "avocado",
        ],
      ])
    ).rows.map((row: { id: string }) => row.id);
    excludedSet = new Set(excluded);
    await pool.query(
      `INSERT INTO users (id,email,password_hash) VALUES
       ($1,'generate-admin@example.invalid','test'),
       ($2,'generate-client@example.invalid','test')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENT],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id,role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [ADMIN],
    );
    await pool.query(
      `INSERT INTO client_courses
       (id,client_id,title,start_date,end_date,status,created_by,program_scope)
       VALUES ($1,$2,'Nutrition','2026-10-22','2026-11-22','active',$3,'nutrition')
       ON CONFLICT (id) DO UPDATE SET program_scope='nutrition'`,
      [COURSE, CLIENT, ADMIN],
    );
    const token = await createSession(pool, ADMIN);
    cookie = `${sessionCookieName()}=${token}; ${csrfCookieName()}=${csrf}`;
  });

  afterAll(async () => {
    await pool?.end();
    await closePostgresPool();
  });

  async function generate() {
    const response = await handleSelfhostRequest(
      new Request("http://local.test/api/selfhost/admin/nutrition/generate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
        body: JSON.stringify({
          clientId: CLIENT,
          courseId: COURSE,
          seed: 20261022,
          profile: {
            gender: "female",
            birth_date: "1989-01-01",
            height_cm: 165,
            weight_kg: 64.8,
            activity_level: "low",
            goal_primary: "weight_loss",
            profile_complete: true,
          },
          days_count: 7,
          excluded_product_ids: excluded,
          meal_schedule_mode: "three_mains_only",
          primary_meal_slot: "lunch",
          targets_override: { kcal: 1396, protein_g: 116.6, fat_g: 58.3, carbs_g: 101.2 },
        }),
      }),
    );
    expect(response?.status).toBe(200);
    return response!.json() as Promise<{
      is_valid: boolean;
      days: ConstructorDay[];
      draftId: string;
      diagnostics?: { pass_pool_size?: number };
    }>;
  }

  const stableContent = (value: unknown) =>
    JSON.parse(JSON.stringify(value), (key, current) => (key === "id" ? undefined : current));

  it("creates, reloads and replaces one draft without touching published records", async () => {
    const before = await pool.query(
      `SELECT
       (SELECT count(*)::int FROM nutrition_plan_versions) AS versions,
       (SELECT count(*)::int FROM client_program_assignments) AS assignments`,
    );
    const first = await generate();
    expect(first.is_valid, JSON.stringify(first)).toBe(true);
    expect(first.days).toHaveLength(7);
    expect(first.diagnostics?.pass_pool_size).toBeGreaterThanOrEqual(4);
    expect(new Set(first.days.map(fingerprintExactDay)).size).toBe(7);
    for (const day of first.days)
      for (const item of day.items)
        for (const ingredient of item.ingredients) {
          expect(Number.isInteger(Number(ingredient.grams))).toBe(true);
          expect(Number(ingredient.grams)).toBeGreaterThan(0);
          expect(excludedSet.has(ingredient.product_id)).toBe(false);
        }
    const loaded = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    expect(loaded.plan?.id).toBe(first.draftId);
    expect(loaded.days).toEqual(first.days);
    const second = await generate();
    expect(second.draftId).toBe(first.draftId);
    expect(stableContent(second.days)).toEqual(stableContent(first.days));
    const count = await pool.query(
      `SELECT count(*)::int AS count FROM nutrition_plans WHERE user_id=$1 AND course_id=$2`,
      [CLIENT, COURSE],
    );
    expect(count.rows[0].count).toBe(1);
    const after = await pool.query(
      `SELECT
       (SELECT count(*)::int FROM nutrition_plan_versions) AS versions,
       (SELECT count(*)::int FROM client_program_assignments) AS assignments`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, 120_000);

  it("answers the rebuild endpoint with JSON and stores one 1710 draft", async () => {
    const denied = await handleSelfhostRequest(
      new Request("http://local.test/api/selfhost/admin/nutrition/generate", { method: "POST" }),
    );
    expect(denied?.headers.get("content-type")).toContain("application/json");
    const deniedText = await denied!.text();
    expect(deniedText.trim().startsWith("<")).toBe(false);
    const deniedBody = JSON.parse(deniedText) as { error: { code: string; message: string } };
    expect(deniedBody.error.code).toBeTruthy();
    expect(deniedBody.error.message).not.toMatch(/Unexpected token|<html/i);

    await pool.query(`DELETE FROM nutrition_plans WHERE user_id = $1 AND course_id = $2`, [
      CLIENT,
      COURSE,
    ]);
    const publishedBefore = await pool.query(
      `SELECT count(*)::int AS n FROM nutrition_plan_versions`,
    );
    const response = await handleSelfhostRequest(
      new Request("http://local.test/api/selfhost/admin/nutrition/generate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
        body: JSON.stringify({
          clientId: CLIENT,
          courseId: COURSE,
          rebuild: true,
          profile: {
            gender: "female",
            birth_date: "1990-04-04",
            height_cm: 168,
            weight_kg: 72,
            activity_level: "moderate",
            goal_primary: "weight_loss",
            profile_complete: true,
          },
          days_count: 7,
          excluded_product_ids: [],
          meal_schedule_mode: "three_main_two_snacks",
          primary_meal_slot: "lunch",
          targets_override: { kcal: 1710, protein_g: 150, fat_g: 70, carbs_g: 120 },
        }),
      }),
    );
    expect(response?.headers.get("content-type")).toContain("application/json");
    const text = await response!.text();
    expect(text.trim().startsWith("<")).toBe(false);
    const body = JSON.parse(text) as {
      saved?: boolean;
      is_valid?: boolean;
      days?: ConstructorDay[];
      message?: string;
      error?: { message?: string };
    };
    expect(response?.status).toBe(200);
    expect(
      body.error,
      JSON.stringify({ message: body.message, is_valid: body.is_valid }),
    ).toBeUndefined();
    const detail = body as {
      message?: string;
      reason_code?: string;
      diagnostics?: { last_failure_reason?: string; timed_out?: boolean; search_stage?: string };
    };
    expect(body.saved, JSON.stringify(detail)).toBe(true);
    expect(body.is_valid).toBe(true);
    expect(body.days).toHaveLength(7);
    const loaded = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    expect(loaded.days).toHaveLength(7);
    expect(loaded.plan?.id).toBeTruthy();
    const plans = await pool.query(
      `SELECT count(*)::int AS count FROM nutrition_plans WHERE user_id = $1 AND course_id = $2`,
      [CLIENT, COURSE],
    );
    expect(plans.rows[0].count).toBe(1);
    const publishedAfter = await pool.query(
      `SELECT count(*)::int AS n FROM nutrition_plan_versions`,
    );
    expect(publishedAfter.rows[0].n).toBe(publishedBefore.rows[0].n);

    const firstKey = loaded.days.map((day) => fingerprintExactDay(day)).join("\n");
    const again = await handleSelfhostRequest(
      new Request("http://local.test/api/selfhost/admin/nutrition/generate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
        body: JSON.stringify({
          clientId: CLIENT,
          courseId: COURSE,
          rebuild: true,
          profile: {
            gender: "female",
            birth_date: "1990-04-04",
            height_cm: 168,
            weight_kg: 72,
            activity_level: "moderate",
            goal_primary: "weight_loss",
            profile_complete: true,
          },
          days_count: 7,
          excluded_product_ids: [],
          meal_schedule_mode: "three_main_two_snacks",
          primary_meal_slot: "lunch",
          targets_override: { kcal: 1710, protein_g: 150, fat_g: 70, carbs_g: 120 },
        }),
      }),
    );
    const againText = await again!.text();
    expect(againText.trim().startsWith("<")).toBe(false);
    const againBody = JSON.parse(againText) as { saved?: boolean; days?: ConstructorDay[] };
    expect(again?.headers.get("content-type")).toContain("application/json");
    expect(againBody.saved).toBe(true);
    expect(againBody.days).toHaveLength(7);
    const reloaded = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const secondKey = reloaded.days.map((day) => fingerprintExactDay(day)).join("\n");
    expect(secondKey).not.toBe(firstKey);
    const plansAfter = await pool.query(
      `SELECT count(*)::int AS count FROM nutrition_plans WHERE user_id = $1 AND course_id = $2`,
      [CLIENT, COURSE],
    );
    expect(plansAfter.rows[0].count).toBe(1);
  }, 180_000);
});
