import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConstructorDay, IngredientLine } from "@/lib/nutrition-constructor/types";
import { csrfCookieName, sessionCookieName } from "./config";
import { closePostgresPool } from "./db";
import { handleSelfhostRequest } from "./http";
import { createSession } from "./local-auth";
import { applyMigrations } from "./migrate";
import {
  loadConstructorPlanPg,
  saveConstructorPlanPg,
  seedNutritionCatalog,
} from "./postgres-nutrition";

const url = process.env.MEAL_REPLACE_TEST_DATABASE_URL;
const run = Boolean(url);
const ADMIN = "33000000-0000-4000-8000-000000000201";
const CLIENT = "33000000-0000-4000-8000-000000000202";
const COURSE = "33000000-0000-4000-8000-000000000211";

describe.runIf(run)("nutrition draft edit PostgreSQL", () => {
  let pool: pg.Pool;
  let cookie = "";
  let clientCookie = "";
  const csrf = "draft-edit-csrf";

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
       ($1,'draft-edit-admin@example.invalid','test'),
       ($2,'draft-edit-client@example.invalid','test')
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
       VALUES ($1,$2,'Draft edit','2026-11-15','2026-12-15','active',$3,'nutrition')
       ON CONFLICT (id) DO NOTHING`,
      [COURSE, CLIENT, ADMIN],
    );
    const recipes = await pool.query(
      `SELECT r.id, r.name, r.steps, r.requires_cooking
         FROM public.recipes r
         JOIN public.recipe_ingredients i ON i.recipe_id = r.id
        WHERE r.meal_type = 'main' AND r.is_active = true AND r.dietitian_approved = true
        GROUP BY r.id
        HAVING count(i.*) >= 2
        ORDER BY r.name
        LIMIT 3`,
    );
    expect(recipes.rowCount).toBe(3);
    const slots = ["main1", "main2", "main3"] as const;
    const items = [];
    for (const [index, recipe] of (recipes.rows as Array<Record<string, unknown>>).entries()) {
      const ings = await pool.query(
        `SELECT i.default_g, i.min_g, p.id AS product_id, p.name, p.kcal_per_100g, p.protein_per_100g,
                p.fat_per_100g, p.carbs_per_100g, p.fiber_per_100g
           FROM public.recipe_ingredients i
           JOIN public.food_products p ON p.id = i.product_id
          WHERE i.recipe_id = $1
          ORDER BY i.sort_order`,
        [recipe.id],
      );
      const lines: IngredientLine[] = (ings.rows as Array<Record<string, string | number>>).map(
        (row, lineIndex) => {
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
            sort_order: lineIndex,
          };
        },
      );
      const sum = (key: "kcal" | "protein_g" | "fat_g" | "carbs_g" | "fiber_g") =>
        lines.reduce((total, line) => total + Number(line[key] ?? 0), 0);
      items.push({
        slot: slots[index]!,
        recipe_id: String(recipe.id),
        recipe_name: String(recipe.name),
        requires_cooking: Boolean(recipe.requires_cooking),
        prep_time_min: 20,
        steps: (recipe.steps as string[]) ?? [],
        weighing_note: null,
        kcal: String(sum("kcal")),
        protein_g: String(sum("protein_g")),
        fat_g: String(sum("fat_g")),
        carbs_g: String(sum("carbs_g")),
        fiber_g: String(sum("fiber_g")),
        is_valid: true,
        ingredients: lines,
      });
    }
    const day: ConstructorDay = {
      day_index: 0,
      day_note: null,
      items,
      kcal: String(items.reduce((sum, item) => sum + Number(item.kcal), 0)),
      protein_g: String(items.reduce((sum, item) => sum + Number(item.protein_g), 0)),
      fat_g: String(items.reduce((sum, item) => sum + Number(item.fat_g), 0)),
      carbs_g: String(items.reduce((sum, item) => sum + Number(item.carbs_g), 0)),
      fiber_g: "0",
      is_valid: true,
    };
    await saveConstructorPlanPg(pool, {
      userId: CLIENT,
      courseId: COURSE,
      days: [day],
      targets: {
        kcal: Number(day.kcal),
        protein_g: Number(day.protein_g),
        fat_g: Number(day.fat_g),
        carbs_g: Number(day.carbs_g),
      },
      plan_days_count: 1,
      plan_status: "draft",
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      targets_manual: true,
    });
    cookie = `${sessionCookieName()}=${await createSession(pool, ADMIN)}; ${csrfCookieName()}=${csrf}`;
    clientCookie = `${sessionCookieName()}=${await createSession(pool, CLIENT)}; ${csrfCookieName()}=${csrf}`;
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.query(
        `ALTER TABLE public.nutrition_plan_versions DISABLE TRIGGER nutrition_plan_versions_immutable`,
      );
      await pool.query(
        `ALTER TABLE public.program_change_log DISABLE TRIGGER program_change_log_immutable`,
      );
      await pool.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[ADMIN, CLIENT]]);
      await pool.query(
        `ALTER TABLE public.nutrition_plan_versions ENABLE TRIGGER nutrition_plan_versions_immutable`,
      );
      await pool.query(
        `ALTER TABLE public.program_change_log ENABLE TRIGGER program_change_log_immutable`,
      );
      await pool.end();
    }
    await closePostgresPool();
  });

  async function call(
    path: string,
    method: string,
    body?: Record<string, unknown>,
    asClient = false,
  ) {
    const response = await handleSelfhostRequest(
      new Request(`http://local.test${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          cookie: asClient ? clientCookie : cookie,
          "x-csrf-token": csrf,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    if (!response) throw new Error("Маршрут не обработан");
    const payload = (await response.json()) as Record<string, unknown>;
    return { status: response.status, payload };
  }

  it("edits, deletes, restores, publishes and serves only the published meal", async () => {
    const before = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const meal = before.days[0]!.items.find((item) => item.slot === "main1")!;
    const kept = before.days[0]!.items.find((item) => item.slot === "main2")!;
    const extra = await pool.query(
      `SELECT id::text AS id FROM public.food_products
        WHERE is_active = true AND id <> ALL($1::uuid[])
        ORDER BY name LIMIT 1`,
      [meal.ingredients.map((line) => line.product_id)],
    );
    const extraId = (extra.rows[0] as { id: string }).id;
    const renamed = await call("/api/selfhost/admin/nutrition/draft/meal", "POST", {
      action: "update",
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: meal.id,
      expectedUpdatedAt: before.plan!.updated_at,
      name: `${meal.recipe_name} домашнее`,
      steps: meal.steps,
      prepTimeMin: 25,
      note: "Подать сразу",
      lines: [
        ...meal.ingredients.map((line, index) => ({
          productId: line.product_id,
          grams: index === 0 ? Number(line.grams) + 15 : Number(line.grams),
        })),
        { productId: extraId, grams: 20 },
      ],
    });
    expect(renamed.status, JSON.stringify(renamed.payload)).toBe(200);
    const withExtra = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const edited = withExtra.days[0]!.items.find((item) => item.slot === "main1")!;
    expect(edited.recipe_name).toBe(`${meal.recipe_name} домашнее`);
    expect(edited.ingredients.some((line) => line.product_id === extraId)).toBe(true);
    expect(Number(edited.ingredients[0]!.grams)).toBeCloseTo(
      Number(meal.ingredients[0]!.grams) + 15,
      0,
    );
    const removed = await call("/api/selfhost/admin/nutrition/draft/meal", "POST", {
      action: "update",
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main1",
      mealItemId: edited.id,
      expectedUpdatedAt: withExtra.plan!.updated_at,
      name: edited.recipe_name,
      steps: edited.steps,
      lines: edited.ingredients
        .filter((line) => line.product_id !== extraId)
        .map((line) => ({ productId: line.product_id, grams: Number(line.grams) })),
    });
    expect(removed.status, JSON.stringify(removed.payload)).toBe(200);
    const third = withExtra.days[0]!.items.find((item) => item.slot === "main3")!;
    const afterEdit = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    const deleted = await call("/api/selfhost/admin/nutrition/draft/meal", "POST", {
      action: "delete",
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main3",
      mealItemId: third.id,
      expectedUpdatedAt: afterEdit.plan!.updated_at,
    });
    expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
    const gone = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    expect(gone.days[0]!.items.some((item) => item.slot === "main3")).toBe(false);
    expect(gone.days[0]!.items.find((item) => item.slot === "main2")!.recipe_name).toBe(
      kept.recipe_name,
    );
    const again = await call("/api/selfhost/admin/nutrition/draft/meal", "POST", {
      action: "delete",
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main3",
      mealItemId: third.id,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(again.status).toBe(200);
    const blocked = await call("/api/selfhost/admin/nutrition/draft/validate", "POST", {
      clientId: CLIENT,
      courseId: COURSE,
    });
    expect(blocked.status).toBe(200);
    expect(blocked.payload.ok).toBe(false);
    const restored = await call("/api/selfhost/admin/nutrition/draft/meal", "POST", {
      action: "add",
      clientId: CLIENT,
      courseId: COURSE,
      dayIndex: 0,
      slot: "main3",
      expectedUpdatedAt: gone.plan!.updated_at,
      name: third.recipe_name,
      steps: third.steps,
      recipeId: third.recipe_id,
      lines: third.ingredients.map((line) => ({
        productId: line.product_id,
        grams: Number(line.grams),
      })),
    });
    expect(restored.status, JSON.stringify(restored.payload)).toBe(200);
    const preview = await call("/api/selfhost/admin/nutrition/draft/text", "POST", {
      clientId: CLIENT,
      courseId: COURSE,
      expectedUpdatedAt: (await loadConstructorPlanPg(pool, CLIENT, COURSE)).plan!.updated_at,
      apply: false,
    });
    expect(preview.status, JSON.stringify(preview.payload)).toBe(200);
    const current = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    await pool.query(
      `UPDATE public.nutrition_plans
          SET target_kcal = $2, target_protein_g = $3, target_fat_g = $4, target_carbs_g = $5
        WHERE id = $1`,
      [
        current.plan!.id,
        Number(current.days[0]!.kcal),
        Number(current.days[0]!.protein_g),
        Number(current.days[0]!.fat_g),
        Number(current.days[0]!.carbs_g),
      ],
    );
    const checked = await call("/api/selfhost/admin/nutrition/draft/validate", "POST", {
      clientId: CLIENT,
      courseId: COURSE,
    });
    expect(checked.payload.ok, JSON.stringify(checked.payload)).toBe(true);
    const published = await call("/api/selfhost/admin/nutrition/publish-access", "POST", {
      clientId: CLIENT,
      courseId: COURSE,
    });
    expect(published.status, JSON.stringify(published.payload)).toBe(200);
    const cabinet = await call(
      `/api/selfhost/nutrition?clientId=${CLIENT}&courseId=${COURSE}`,
      "GET",
      undefined,
      true,
    );
    expect(cabinet.status, JSON.stringify(cabinet.payload)).toBe(200);
    const pdf = await call(
      "/api/selfhost/pdf",
      "POST",
      { kind: "nutrition", courseId: COURSE },
      true,
    );
    expect(pdf.status, JSON.stringify({ error: pdf.payload.error })).toBe(200);
    expect(typeof pdf.payload.pdfBase64).toBe("string");
    const versions = await pool.query(
      `SELECT count(*)::int AS n FROM public.nutrition_plan_versions WHERE client_id = $1`,
      [CLIENT],
    );
    expect(versions.rows[0].n).toBe(1);
  }, 120_000);
});
