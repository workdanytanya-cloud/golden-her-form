import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { closePostgresPool } from "./db";
import { createSession } from "./local-auth";
import { csrfCookieName, sessionCookieName } from "./config";
import { handleSelfhostRequest } from "./http";
import {
  loadConstructorPlanPg,
  saveConstructorPlanPg,
  seedNutritionCatalog,
} from "./postgres-nutrition";
import {
  CANNOT_FIT_RECIPE,
  DRAFT_CONFLICT_MESSAGE,
  SAME_RECIPE_MESSAGE,
} from "@/lib/nutrition-constructor/meal-replace";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import { apiErrorMessage } from "@/lib/selfhost/api-error";

const url = process.env.MEAL_REPLACE_TEST_DATABASE_URL;
const run = Boolean(url);
const ADMIN = "33000000-0000-4000-8000-000000000001";
const CLIENT = "33000000-0000-4000-8000-000000000002";
const COURSE = "33000000-0000-4000-8000-000000000011";

describe.runIf(run)("meal replace PostgreSQL integration", () => {
  let pool: pg.Pool;
  let cookie = "";
  const csrf = "meal-replace-csrf";
  let sourceId = "";
  let probeId = "";
  let versionsBefore = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATA_BACKEND = "postgres";
    process.env.AUTH_BACKEND = "local";
    process.env.SELFHOST_MODE = "1";
    pool = new pg.Pool({ connectionString: url });
    await applyMigrations(pool);
    await seedNutritionCatalog(pool);
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES
       ($1,'meal-replace-admin@example.invalid','test'),
       ($2,'meal-replace-client@example.invalid','test')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENT],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [ADMIN],
    );
    await pool.query(
      `INSERT INTO client_courses
       (id, client_id, title, start_date, end_date, status, created_by, program_scope)
       VALUES ($1,$2,'Replace','2026-11-15','2026-12-15','active',$3,'nutrition')
       ON CONFLICT (id) DO NOTHING`,
      [COURSE, CLIENT, ADMIN],
    );
    const source = await pool.query(
      `SELECT r.id
         FROM public.recipes r
         JOIN public.recipe_ingredients i ON i.recipe_id = r.id
        WHERE r.meal_type = 'main' AND r.is_active = true
        GROUP BY r.id
        ORDER BY count(*) ASC
        LIMIT 1`,
    );
    sourceId = (source.rows[0] as { id: string }).id;
    const probe = await pool.query(
      `INSERT INTO public.recipes (slug, name, meal_type, steps, requires_cooking, is_active)
       SELECT 'meal-replace-probe', 'Проверка замены', meal_type, steps, requires_cooking, true
         FROM public.recipes WHERE id = $1
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = true
       RETURNING id`,
      [sourceId],
    );
    probeId = (probe.rows[0] as { id: string }).id;
    await pool.query(`DELETE FROM public.recipe_ingredients WHERE recipe_id = $1`, [probeId]);
    await pool.query(
      `INSERT INTO public.recipe_ingredients
         (recipe_id, product_id, min_g, max_g, default_g, is_scalable, sort_order, optional)
       SELECT $2, product_id, min_g, max_g, default_g, is_scalable, sort_order, optional
         FROM public.recipe_ingredients WHERE recipe_id = $1`,
      [sourceId, probeId],
    );
    const ings = await pool.query(
      `SELECT i.default_g, i.min_g, p.id AS product_id, p.name, p.kcal_per_100g, p.protein_per_100g,
              p.fat_per_100g, p.carbs_per_100g, p.fiber_per_100g
         FROM public.recipe_ingredients i
         JOIN public.food_products p ON p.id = i.product_id
        WHERE i.recipe_id = $1
        ORDER BY i.sort_order`,
      [sourceId],
    );
    const lines = (ings.rows as Array<Record<string, string | number>>).map((row, index) => {
      const grams = Number(row.default_g || row.min_g || 50);
      const factor = grams / 100;
      return {
        product_id: String(row.product_id),
        product_name: String(row.name),
        grams: String(grams),
        weighing_note: null,
        kcal_per_100g: String(row.kcal_per_100g),
        protein_per_100g: String(row.protein_per_100g),
        fat_per_100g: String(row.fat_per_100g),
        carbs_per_100g: String(row.carbs_per_100g),
        fiber_per_100g: row.fiber_per_100g == null ? null : String(row.fiber_per_100g),
        kcal: String(Number(row.kcal_per_100g) * factor),
        protein_g: String(Number(row.protein_per_100g) * factor),
        fat_g: String(Number(row.fat_per_100g) * factor),
        carbs_g: String(Number(row.carbs_per_100g) * factor),
        fiber_g: String(Number(row.fiber_per_100g ?? 0) * factor),
        sort_order: index,
      };
    });
    const kcal = lines.reduce((sum, line) => sum + Number(line.kcal), 0);
    const protein = lines.reduce((sum, line) => sum + Number(line.protein_g), 0);
    const fat = lines.reduce((sum, line) => sum + Number(line.fat_g), 0);
    const carbs = lines.reduce((sum, line) => sum + Number(line.carbs_g), 0);
    const day: ConstructorDay = {
      day_index: 0,
      day_note: null,
      items: [
        {
          slot: "main1",
          recipe_id: sourceId,
          recipe_name: "Исходное блюдо",
          requires_cooking: true,
          prep_time_min: 15,
          steps: ["Один.", "Два.", "Подать."],
          weighing_note: null,
          kcal: String(kcal),
          protein_g: String(protein),
          fat_g: String(fat),
          carbs_g: String(carbs),
          fiber_g: "0",
          is_valid: true,
          ingredients: lines,
        },
        {
          slot: "main2",
          recipe_id: sourceId,
          recipe_name: "Второй приём",
          requires_cooking: true,
          prep_time_min: 15,
          steps: ["Один.", "Два.", "Подать."],
          weighing_note: null,
          kcal: "0.0001",
          protein_g: "0",
          fat_g: "0",
          carbs_g: "0",
          fiber_g: "0",
          is_valid: true,
          ingredients: lines.slice(0, 1).map((line) => ({ ...line, grams: "1" })),
        },
      ],
      kcal: String(kcal),
      protein_g: String(protein),
      fat_g: String(fat),
      carbs_g: String(carbs),
      fiber_g: "0",
      is_valid: true,
    };
    await saveConstructorPlanPg(pool, {
      userId: CLIENT,
      courseId: COURSE,
      days: [day],
      targets: { kcal, protein_g: protein, fat_g: fat, carbs_g: carbs },
      plan_days_count: 1,
      plan_status: "draft",
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      targets_manual: true,
    });
    versionsBefore = Number(
      (await pool.query(`SELECT count(*)::int AS n FROM public.nutrition_plan_versions`)).rows[0].n,
    );
    const token = await createSession(pool, ADMIN);
    cookie = `${sessionCookieName()}=${token}; ${csrfCookieName()}=${csrf}`;
  }, 120_000);

  afterAll(async () => {
    await pool?.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[ADMIN, CLIENT]]);
    await pool?.end();
    await closePostgresPool();
  });

  async function post(body: Record<string, unknown>) {
    const response = await handleSelfhostRequest(
      new Request("http://local.test/api/selfhost/admin/nutrition/draft/replace-meal", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
        body: JSON.stringify(body),
      }),
    );
    if (!response) throw new Error("Маршрут не обработан");
    const payload = (await response.json()) as Record<string, unknown>;
    return { status: response.status, payload };
  }

  it("replaces one slot, keeps the other meal, and survives a reread", async () => {
    const before = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const item = before.days[0]!.items.find((meal) => meal.slot === "main1")!;
    const other = before.days[0]!.items.find((meal) => meal.slot === "main2")!;
    const replaced = await post({
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: item.id,
      expectedUpdatedAt: before.plan!.updated_at,
      action: "apply",
      recipeId: probeId,
    });
    expect(replaced.status, JSON.stringify(replaced.payload)).toBe(200);
    expect(replaced.payload.replaced).toBe(true);
    const after = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const next = after.days[0]!.items.find((meal) => meal.slot === "main1")!;
    const kept = after.days[0]!.items.find((meal) => meal.slot === "main2")!;
    expect(next.recipe_id).toBe(probeId);
    expect(next.recipe_name).toBe("Проверка замены");
    expect(kept.recipe_id).toBe(other.recipe_id);
    expect(kept.recipe_name).toBe(other.recipe_name);
    expect(after.days[0]!.items.filter((meal) => meal.slot === "main1")).toHaveLength(1);
    const same = await post({
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: next.id,
      expectedUpdatedAt: after.plan!.updated_at,
      action: "apply",
      recipeId: probeId,
    });
    expect(same.status).toBe(400);
    expect(apiErrorMessage(same.payload)).toBe(SAME_RECIPE_MESSAGE);
    const conflict = await post({
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: next.id,
      expectedUpdatedAt: before.plan!.updated_at,
      action: "apply",
      recipeId: sourceId,
    });
    expect(conflict.status).toBe(409);
    expect(apiErrorMessage(conflict.payload)).toBe(DRAFT_CONFLICT_MESSAGE);
    const unfit = await post({
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: next.id,
      expectedUpdatedAt: after.plan!.updated_at,
      action: "preview",
      recipeId: sourceId,
    });
    if (unfit.status === 422) expect(apiErrorMessage(unfit.payload)).toContain(CANNOT_FIT_RECIPE);
    const still = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    expect(still.days[0]!.items.find((meal) => meal.slot === "main1")!.recipe_id).toBe(probeId);
    const versionsAfter = Number(
      (await pool.query(`SELECT count(*)::int AS n FROM public.nutrition_plan_versions`)).rows[0].n,
    );
    expect(versionsAfter).toBe(versionsBefore);
  }, 60_000);
});
