import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  prepareConstructorDaysForSave,
  visibleIngredients,
  assertSaveableConstructorDays,
  InvalidIngredientGramsError,
} from "@/lib/nutrition-constructor/ingredient-normalize";
import { roundTargetsForDb, d } from "@/lib/nutrition-constructor/decimal-math";
import { evaluatePlanKbjuStatus } from "@/lib/nutrition-constructor/plan-kbju-status";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import type { MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import type {
  ConstructorDay,
  FoodProduct,
  IngredientLine,
  MealPlanItem,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import type {
  ConstructorDayRow,
  ConstructorPlanRow,
  SaveConstructorPlanParams,
} from "@/lib/nutrition-constructor/repo";
import {
  buildConstructorNutritionSnapshot,
  nutritionSnapshotHash,
} from "@/lib/published-programs/nutrition-snapshot";
import { withTransaction } from "@/lib/selfhost/db";
import { resolveClientCourseIdPg } from "@/lib/selfhost/postgres-courses";

type Queryable = Pool | PoolClient;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const nutritionPublishSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
  idempotencyKey: z.string().min(8).max(200).optional().nullable(),
  plan_status: z.enum(["draft", "validated", "assigned"]).optional(),
});

export const nutritionDraftSaveSchema = z
  .object({
    userId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    courseId: z.string().uuid().nullable().optional(),
    days: z.array(z.record(z.unknown())).default([]),
    targets: z.object({
      kcal: z.number(),
      protein_g: z.number(),
      fat_g: z.number(),
      carbs_g: z.number(),
    }),
    plan_days_count: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(28)]).default(7),
    plan_status: z.enum(["draft", "validated", "assigned"]).default("draft"),
    bmr: z.number().nullable().optional(),
    tdee: z.number().nullable().optional(),
    calorie_adjustment_pct: z.number().nullable().optional(),
    notes: z.string().max(8000).nullable().optional(),
    excluded_products: z.array(z.string()).optional(),
    targets_manual: z.boolean().optional(),
    meal_schedule_mode: z
      .enum([
        "three_main_two_snacks",
        "three_mains_only",
        "one_main_three_snacks",
        "two_main_two_snacks",
      ])
      .optional(),
    primary_meal_slot: z.enum(["breakfast", "lunch", "dinner"]).optional(),
    requires_manual_review: z.boolean().optional(),
    review_reason: z.string().max(4000).nullable().optional(),
  })
  .refine((value) => Boolean(value.userId || value.clientId), {
    message: "Не указан clientId",
  });

export const nutritionGenerateSchema = z.object({
  profile: z.record(z.unknown()),
  days_count: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(28)]),
  excluded_product_ids: z.array(z.string()).default([]),
  meal_schedule_mode: z
    .enum([
      "three_main_two_snacks",
      "three_mains_only",
      "one_main_three_snacks",
      "two_main_two_snacks",
    ])
    .optional(),
  primary_meal_slot: z.enum(["breakfast", "lunch", "dinner"]).optional(),
  targets_override: z
    .object({
      kcal: z.number(),
      protein_g: z.number(),
      fat_g: z.number(),
      carbs_g: z.number(),
    })
    .optional(),
});

export const nutritionPreferenceSchema = z.object({
  courseId: z.string().uuid().nullable().optional(),
  mode: z.enum([
    "three_main_two_snacks",
    "three_mains_only",
    "one_main_three_snacks",
    "two_main_two_snacks",
  ]),
  primarySlot: z.enum(["breakfast", "lunch", "dinner"]),
  publishedMode: z
    .enum([
      "three_main_two_snacks",
      "three_mains_only",
      "one_main_three_snacks",
      "two_main_two_snacks",
    ])
    .nullable()
    .optional(),
});

function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function mapProduct(row: Record<string, unknown>): FoodProduct {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: row.category as FoodProduct["category"],
    brand: (row.brand as string | null) ?? null,
    state: row.state as FoodProduct["state"],
    measurement_basis: String(row.measurement_basis),
    kcal_per_100g: String(row.kcal_per_100g),
    protein_per_100g: String(row.protein_per_100g),
    fat_per_100g: String(row.fat_per_100g),
    carbs_per_100g: String(row.carbs_per_100g),
    fiber_per_100g: row.fiber_per_100g == null ? null : String(row.fiber_per_100g),
    density: row.density == null ? null : String(row.density),
    source_name: String(row.source_name),
    source_url: (row.source_url as string | null) ?? null,
    verified_at: row.verified_at ? new Date(row.verified_at as string | Date).toISOString() : null,
    is_verified: Boolean(row.is_verified),
    is_active: Boolean(row.is_active),
    allowed_for_snack: Boolean(row.allowed_for_snack),
    requires_cooking: Boolean(row.requires_cooking),
    weighing_note: (row.weighing_note as string | null) ?? null,
    is_active_for_autogeneration: row.is_active_for_autogeneration !== false,
    allergen_tags: (row.allergen_tags as string[] | null) ?? [],
  };
}

function mapRecipe(row: Record<string, unknown>): Recipe {
  const modes = (row.allowed_schedule_modes as string[] | null) ?? [
    "two_main_two_snacks",
    "one_main_three_snacks",
  ];
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    meal_type: row.meal_type as Recipe["meal_type"],
    steps: (row.steps as string[]) ?? [],
    prep_time_min: (row.prep_time_min as number | null) ?? null,
    requires_cooking: Boolean(row.requires_cooking),
    is_active: Boolean(row.is_active ?? true),
    weighing_note: (row.weighing_note as string | null) ?? null,
    is_nutrient_dense: Boolean(row.is_nutrient_dense ?? true),
    contains_protein_source: Boolean(row.contains_protein_source ?? false),
    contains_fruit_or_vegetable: Boolean(row.contains_fruit_or_vegetable ?? false),
    is_treat: Boolean(row.is_treat ?? false),
    allowed_schedule_modes: modes as Recipe["allowed_schedule_modes"],
    snack_action: (row.snack_action as string | null) ?? null,
    is_everyday: row.is_everyday !== false,
    is_work_friendly: Boolean(row.is_work_friendly),
    is_portable: Boolean(row.is_portable),
    is_batch_cookable: Boolean(row.is_batch_cookable),
    active_prep_minutes: (row.active_prep_minutes as number | null) ?? null,
    total_cook_minutes: (row.total_cook_minutes as number | null) ?? null,
    complexity: (row.complexity as Recipe["complexity"]) ?? null,
    required_equipment: (row.required_equipment as string[] | null) ?? [],
    requires_reheating: Boolean(row.requires_reheating),
    is_nutritionally_complete: row.is_nutritionally_complete !== false,
    dietitian_approved: row.dietitian_approved !== false,
  };
}

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

export async function seedNutritionCatalog(
  db: Queryable,
): Promise<{ products: number; recipes: number }> {
  // Каталог как в приёмке 1313/1800 (includeTestPackaging), иначе многодневная сборка на Postgres
  // с одними только is_verified продуктами часто даёт infeasible.
  const catalog = buildInMemoryCatalog({ includeTestPackaging: true });
  for (const p of catalog.products.values()) {
    await db.query(
      `INSERT INTO public.food_products (
         slug, name, category, brand, state, measurement_basis,
         kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g, density,
         source_name, source_url, verified_at, is_verified, is_active, is_active_for_autogeneration,
         allowed_for_snack, requires_cooking, weighing_note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         CASE WHEN $15 THEN (now() AT TIME ZONE 'utc') ELSE NULL END,
         $15, true, $16, $17, $18, $19)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         kcal_per_100g = EXCLUDED.kcal_per_100g,
         protein_per_100g = EXCLUDED.protein_per_100g,
         fat_per_100g = EXCLUDED.fat_per_100g,
         carbs_per_100g = EXCLUDED.carbs_per_100g,
         is_verified = EXCLUDED.is_verified,
         is_active_for_autogeneration = EXCLUDED.is_active_for_autogeneration`,
      [
        p.slug,
        p.name,
        p.category,
        p.brand ?? null,
        p.state,
        p.measurement_basis,
        p.kcal_per_100g,
        p.protein_per_100g,
        p.fat_per_100g,
        p.carbs_per_100g,
        p.fiber_per_100g,
        p.density,
        p.source_name,
        p.source_url ?? null,
        p.is_verified,
        p.is_active_for_autogeneration !== false,
        p.allowed_for_snack,
        p.requires_cooking,
        p.weighing_note,
      ],
    );
  }
  const products = await db.query(`SELECT id, slug FROM public.food_products`);
  const productBySlug = new Map(
    products.rows.map((row: { id: string; slug: string }) => [row.slug, row.id]),
  );
  for (const r of catalog.recipes) {
    await db.query(
      `INSERT INTO public.recipes (
         slug, name, meal_type, steps, prep_time_min, requires_cooking, is_active, weighing_note,
         is_nutrient_dense, contains_protein_source, contains_fruit_or_vegetable, is_treat,
         allowed_schedule_modes, snack_action, active_prep_minutes, total_cook_minutes, complexity
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14,$15,'easy')
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         steps = EXCLUDED.steps,
         snack_action = EXCLUDED.snack_action`,
      [
        r.slug,
        r.name,
        r.meal_type,
        JSON.stringify(r.steps),
        r.prep_time_min,
        r.requires_cooking,
        r.weighing_note,
        r.is_nutrient_dense,
        r.contains_protein_source,
        r.contains_fruit_or_vegetable,
        r.is_treat,
        r.allowed_schedule_modes,
        r.snack_action,
        r.active_prep_minutes,
        r.total_cook_minutes,
      ],
    );
  }
  const recipes = await db.query(`SELECT id, slug FROM public.recipes`);
  const recipeBySlug = new Map(
    recipes.rows.map((row: { id: string; slug: string }) => [row.slug, row.id]),
  );
  for (const r of catalog.recipes) {
    const recipeId = recipeBySlug.get(r.slug);
    if (!recipeId) continue;
    const ings = catalog.recipeIngredients.get(r.id) ?? catalog.recipeIngredients.get(r.slug) ?? [];
    let order = 0;
    for (const ing of ings) {
      const productId =
        productBySlug.get(String(ing.product_id)) ??
        productBySlug.get(
          [...catalog.products.values()].find((p) => p.id === ing.product_id)?.slug ?? "",
        );
      if (!productId) continue;
      await db.query(
        `INSERT INTO public.recipe_ingredients (recipe_id, product_id, min_g, max_g, default_g, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (recipe_id, product_id) DO UPDATE SET min_g = EXCLUDED.min_g, max_g = EXCLUDED.max_g, default_g = EXCLUDED.default_g`,
        [recipeId, productId, ing.min_g, ing.max_g, ing.default_g, order],
      );
      order += 1;
    }
  }
  return { products: catalog.products.size, recipes: catalog.recipes.length };
}

export async function loadOptimizerContextPg(db: Queryable): Promise<OptimizerContext> {
  const [productsRows, recipesRows, ingsRows] = await Promise.all([
    db.query(`SELECT * FROM public.food_products WHERE is_active = true`),
    db.query(`SELECT * FROM public.recipes WHERE is_active = true`),
    db.query(`SELECT * FROM public.recipe_ingredients`),
  ]);
  if (productsRows.rowCount === 0) {
    await seedNutritionCatalog(db);
    return loadOptimizerContextPg(db);
  }
  const products = new Map<string, FoodProduct>();
  for (const row of productsRows.rows as Record<string, unknown>[]) {
    const mapped = mapProduct(row);
    products.set(mapped.id, mapped);
  }
  const recipes = (recipesRows.rows as Record<string, unknown>[]).map(mapRecipe);
  const recipeIngredients = new Map<string, RecipeIngredient[]>();
  for (const ri of ingsRows.rows as RecipeIngredient[]) {
    const list = recipeIngredients.get(ri.recipe_id) ?? [];
    list.push(ri);
    recipeIngredients.set(ri.recipe_id, list);
  }
  return {
    products,
    recipes,
    recipeIngredients,
    mainRecipes: recipes.filter((r) => r.meal_type === "main"),
    snackRecipes: recipes.filter((r) => r.meal_type === "snack"),
  };
}

async function resolveRecipeId(
  db: Queryable,
  recipeId: string | null | undefined,
): Promise<string | null> {
  if (!recipeId) return null;
  if (uuidRe.test(recipeId)) return recipeId;
  const { rows } = await db.query(`SELECT id FROM public.recipes WHERE slug = $1`, [recipeId]);
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

async function resolveProductId(
  db: Queryable,
  productId: string | null | undefined,
): Promise<string | null> {
  if (!productId) return null;
  if (uuidRe.test(productId)) return productId;
  const { rows } = await db.query(`SELECT id FROM public.food_products WHERE slug = $1`, [
    productId,
  ]);
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

function mapPlan(row: Record<string, unknown>): ConstructorPlanRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    plan_mode: (row.plan_mode as ConstructorPlanRow["plan_mode"]) ?? "constructor",
    plan_days_count: Number(row.plan_days_count ?? 7),
    plan_status: (row.plan_status as ConstructorPlanRow["plan_status"]) ?? "draft",
    target_kcal: Number(row.target_kcal),
    target_protein_g: Number(row.target_protein_g),
    target_fat_g: Number(row.target_fat_g),
    target_carbs_g: Number(row.target_carbs_g),
    bmr: row.bmr == null ? null : Number(row.bmr),
    tdee: row.tdee == null ? null : Number(row.tdee),
    calorie_adjustment_pct:
      row.calorie_adjustment_pct == null ? null : Number(row.calorie_adjustment_pct),
    tolerance_kcal: Number(row.tolerance_kcal ?? 5),
    tolerance_macro_g: Number(row.tolerance_macro_g ?? 1),
    requires_manual_review: Boolean(row.requires_manual_review),
    review_reason: (row.review_reason as string | null) ?? null,
    targets_manual: Boolean(row.targets_manual),
    notes: (row.notes as string | null) ?? null,
    excluded_products: (row.excluded_products as string[]) ?? [],
    meal_schedule_mode: row.meal_schedule_mode as ConstructorPlanRow["meal_schedule_mode"],
    primary_meal_slot: row.primary_meal_slot as ConstructorPlanRow["primary_meal_slot"],
  };
}

export async function loadConstructorPlanPg(
  db: Queryable,
  userId: string,
  courseId?: string | null,
): Promise<{ plan: ConstructorPlanRow | null; days: ConstructorDayRow[] }> {
  const resolved = await resolveClientCourseIdPg(db, userId, courseId);
  const planRes = resolved
    ? await db.query(`SELECT * FROM public.nutrition_plans WHERE user_id = $1 AND course_id = $2`, [
        userId,
        resolved,
      ])
    : await db.query(
        `SELECT * FROM public.nutrition_plans WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
  const planRow = planRes.rows[0] as Record<string, unknown> | undefined;
  if (!planRow) return { plan: null, days: [] };
  const planMode = String(planRow.plan_mode ?? "legacy");
  if (planMode !== "constructor") return { plan: null, days: [] };
  const daysRes = await db.query(
    `SELECT * FROM public.nutrition_plan_days WHERE plan_id = $1 ORDER BY day_index`,
    [planRow.id],
  );
  const days: ConstructorDayRow[] = [];
  for (const day of daysRes.rows as Record<string, unknown>[]) {
    const itemsRes = await db.query(
      `SELECT * FROM public.meal_plan_items WHERE plan_day_id = $1 ORDER BY sort_order, slot`,
      [day.id],
    );
    const items: MealPlanItem[] = [];
    for (const item of itemsRes.rows as Record<string, unknown>[]) {
      const ings = await db.query(
        `SELECT * FROM public.meal_plan_item_ingredients WHERE meal_item_id = $1 ORDER BY sort_order`,
        [item.id],
      );
      const ingredients: IngredientLine[] = (ings.rows as Record<string, unknown>[]).map(
        (ing, idx) => ({
          product_id: String(ing.product_id ?? ""),
          product_name: String(ing.product_name),
          grams: String(ing.grams),
          weighing_note: (ing.weighing_note as string | null) ?? null,
          kcal_per_100g: String(ing.kcal_per_100g),
          protein_per_100g: String(ing.protein_per_100g),
          fat_per_100g: String(ing.fat_per_100g),
          carbs_per_100g: String(ing.carbs_per_100g),
          fiber_per_100g: ing.fiber_per_100g == null ? null : String(ing.fiber_per_100g),
          kcal: String(ing.kcal),
          protein_g: String(ing.protein_g),
          fat_g: String(ing.fat_g),
          carbs_g: String(ing.carbs_g),
          fiber_g: String(ing.fiber_g ?? 0),
          sort_order: Number(ing.sort_order ?? idx),
        }),
      );
      items.push({
        id: String(item.id),
        slot: item.slot as MealPlanItem["slot"],
        recipe_id: String(item.recipe_id ?? ""),
        recipe_name: String(item.recipe_name),
        requires_cooking: Boolean(item.requires_cooking),
        prep_time_min: (item.prep_time_min as number | null) ?? null,
        steps: (item.steps as string[]) ?? [],
        weighing_note: (item.weighing_note as string | null) ?? null,
        snack_action: (item.snack_action as string | null) ?? null,
        kcal: String(item.kcal),
        protein_g: String(item.protein_g),
        fat_g: String(item.fat_g),
        carbs_g: String(item.carbs_g),
        fiber_g: String(item.fiber_g ?? 0),
        is_valid: Boolean(item.is_valid),
        ingredients: visibleIngredients(ingredients),
      });
    }
    const totals = items.reduce(
      (acc, item) => ({
        kcal: acc.kcal + num(item.kcal),
        protein_g: acc.protein_g + num(item.protein_g),
        fat_g: acc.fat_g + num(item.fat_g),
        carbs_g: acc.carbs_g + num(item.carbs_g),
        fiber_g: acc.fiber_g + num(item.fiber_g),
      }),
      { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 },
    );
    days.push({
      day_index: Number(day.day_index),
      day_note: (day.day_note as string | null) ?? null,
      items,
      kcal: String(totals.kcal),
      protein_g: String(totals.protein_g),
      fat_g: String(totals.fat_g),
      carbs_g: String(totals.carbs_g),
      fiber_g: String(totals.fiber_g),
      is_valid: items.every((item) => item.is_valid),
    });
  }
  return { plan: mapPlan(planRow), days };
}

export async function saveConstructorPlanPg(
  db: Pool | PoolClient,
  params: SaveConstructorPlanParams,
): Promise<{ plan: ConstructorPlanRow; days: ConstructorDayRow[] }> {
  let persistDays;
  try {
    persistDays = prepareConstructorDaysForSave(params.days);
  } catch (error) {
    if (error instanceof InvalidIngredientGramsError) {
      throw Object.assign(error, { statusCode: 400 });
    }
    throw error;
  }
  const dbTargets = roundTargetsForDb(params.targets);
  const run = async (client: Queryable) => {
    const resolved = await resolveClientCourseIdPg(client, params.userId, params.courseId);
    if (!resolved) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    const existing = await client.query(
      `SELECT id FROM public.nutrition_plans WHERE user_id = $1 AND course_id = $2`,
      [params.userId, resolved],
    );
    const payload = [
      params.userId,
      resolved,
      dbTargets.kcal,
      dbTargets.protein_g,
      dbTargets.fat_g,
      dbTargets.carbs_g,
      params.targets_manual ?? true,
      params.notes ?? null,
      params.plan_days_count,
      params.plan_status,
      params.bmr ?? null,
      params.tdee ?? null,
      params.calorie_adjustment_pct ?? null,
      params.requires_manual_review ?? false,
      params.review_reason ?? null,
      params.excluded_products ?? [],
      params.meal_schedule_mode ?? "two_main_two_snacks",
      params.primary_meal_slot ?? "lunch",
    ];
    let planId: string;
    if (existing.rows[0]) {
      planId = (existing.rows[0] as { id: string }).id;
      await client.query(
        `UPDATE public.nutrition_plans SET
           target_kcal=$1, target_protein_g=$2, target_fat_g=$3, target_carbs_g=$4,
           targets_manual=$5, notes=$6, plan_mode='constructor', plan_days_count=$7, plan_status=$8,
           bmr=$9, tdee=$10, calorie_adjustment_pct=$11, requires_manual_review=$12, review_reason=$13,
           excluded_products=$14::text[], meal_schedule_mode=$15, primary_meal_slot=$16,
           generated_at=(now() AT TIME ZONE 'utc'), updated_at=(now() AT TIME ZONE 'utc')
         WHERE id=$17`,
        [...payload.slice(2), planId],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO public.nutrition_plans (
           user_id, course_id, meals_per_day, preferred_products, excluded_products,
           target_kcal, target_protein_g, target_fat_g, target_carbs_g, targets_manual, notes,
           plan_mode, plan_days_count, plan_status, bmr, tdee, calorie_adjustment_pct,
           requires_manual_review, review_reason, meal_schedule_mode, primary_meal_slot
         ) VALUES (
           $1,$2,5,'{}',$16::text[],$3,$4,$5,$6,$7,$8,'constructor',$9,$10,$11,$12,$13,$14,$15,$17,$18
         )
         RETURNING id`,
        payload,
      );
      planId = (inserted.rows[0] as { id: string }).id;
    }
    await client.query(`DELETE FROM public.nutrition_plan_days WHERE plan_id = $1`, [planId]);
    for (const day of persistDays) {
      const dayRow = await client.query(
        `INSERT INTO public.nutrition_plan_days (plan_id, day_index, day_note, meals)
         VALUES ($1,$2,$3,'[]'::jsonb) RETURNING id`,
        [planId, day.day_index, day.day_note],
      );
      const dayId = (dayRow.rows[0] as { id: string }).id;
      for (let si = 0; si < day.items.length; si++) {
        const item = day.items[si];
        const recipeId = await resolveRecipeId(client, item.recipe_id);
        const itemRow = await client.query(
          `INSERT INTO public.meal_plan_items (
             plan_day_id, slot, recipe_id, recipe_name, requires_cooking, prep_time_min, steps,
             weighing_note, snack_action, kcal, protein_g, fat_g, carbs_g, fiber_g, is_valid, sort_order
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING id`,
          [
            dayId,
            item.slot,
            recipeId,
            item.recipe_name,
            item.requires_cooking,
            item.prep_time_min,
            JSON.stringify(item.steps ?? []),
            item.weighing_note,
            item.snack_action ?? null,
            item.kcal,
            item.protein_g,
            item.fat_g,
            item.carbs_g,
            item.fiber_g,
            item.is_valid,
            si,
          ],
        );
        const itemId = (itemRow.rows[0] as { id: string }).id;
        for (let idx = 0; idx < item.ingredients.length; idx++) {
          const ing = item.ingredients[idx];
          const grams = Number(ing.grams);
          if (!Number.isFinite(grams) || grams <= 0) continue;
          const productId = await resolveProductId(client, ing.product_id);
          await client.query(
            `INSERT INTO public.meal_plan_item_ingredients (
               meal_item_id, product_id, product_name, grams, weighing_note,
               kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
               kcal, protein_g, fat_g, carbs_g, fiber_g, sort_order
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              itemId,
              productId,
              ing.product_name,
              grams,
              ing.weighing_note,
              ing.kcal_per_100g,
              ing.protein_per_100g,
              ing.fat_per_100g,
              ing.carbs_per_100g,
              ing.fiber_per_100g,
              ing.kcal,
              ing.protein_g,
              ing.fat_g,
              ing.carbs_g,
              ing.fiber_g ?? 0,
              ing.sort_order ?? idx,
            ],
          );
        }
      }
    }
    return loadConstructorPlanPg(client, params.userId, resolved);
  };
  const loaded = isPoolClient(db) ? await run(db) : await withTransaction((client) => run(client));
  if (!loaded.plan) throw new Error("Не удалось сохранить черновик питания");
  return { plan: loaded.plan, days: loaded.days };
}

export async function cloneNutritionPlanPg(
  db: Queryable,
  sourceCourseId: string,
  targetCourseId: string,
  clientId: string,
): Promise<void> {
  const src = await db.query(
    `SELECT * FROM public.nutrition_plans WHERE course_id = $1 AND user_id = $2`,
    [sourceCourseId, clientId],
  );
  const plan = src.rows[0] as Record<string, unknown> | undefined;
  if (!plan) return;
  const loaded = await loadConstructorPlanPg(db, clientId, sourceCourseId);
  if (!loaded.plan || loaded.days.length === 0) return;
  await saveConstructorPlanPg(db, {
    userId: clientId,
    courseId: targetCourseId,
    days: loaded.days,
    targets: {
      kcal: loaded.plan.target_kcal,
      protein_g: loaded.plan.target_protein_g,
      fat_g: loaded.plan.target_fat_g,
      carbs_g: loaded.plan.target_carbs_g,
    },
    plan_days_count: loaded.plan.plan_days_count as 1 | 7 | 14 | 28,
    plan_status: "draft",
    bmr: loaded.plan.bmr ?? undefined,
    tdee: loaded.plan.tdee ?? undefined,
    calorie_adjustment_pct: loaded.plan.calorie_adjustment_pct ?? undefined,
    notes: loaded.plan.notes,
    excluded_products: loaded.plan.excluded_products,
    targets_manual: loaded.plan.targets_manual,
    meal_schedule_mode: loaded.plan.meal_schedule_mode,
    primary_meal_slot: loaded.plan.primary_meal_slot,
  });
}

export async function publishNutritionVersionPg(
  db: Pool,
  input: {
    clientId: string;
    courseId?: string | null;
    actorId: string;
    reason?: string | null;
    idempotencyKey?: string | null;
    days: ConstructorDay[];
    plan: ConstructorPlanRow;
  },
): Promise<{ versionId: string; contentHash: string; idempotent: boolean }> {
  if (!input.days.length) {
    throw Object.assign(new Error("Нельзя опубликовать пустой черновик"), { statusCode: 400 });
  }
  try {
    assertSaveableConstructorDays(input.days);
  } catch (error) {
    if (error instanceof InvalidIngredientGramsError) {
      throw Object.assign(error, { statusCode: 400 });
    }
    throw error;
  }
  const targets = {
    kcal: d(input.plan.target_kcal),
    protein_g: d(input.plan.target_protein_g),
    fat_g: d(input.plan.target_fat_g),
    carbs_g: d(input.plan.target_carbs_g),
    fiber_g: d(0),
  };
  const mode = (input.plan.meal_schedule_mode ?? "two_main_two_snacks") as MealScheduleMode;
  const firstDay = input.days[0]!;
  const comparison = comparisonRows(targets, {
    kcal: d(firstDay.kcal),
    protein_g: d(firstDay.protein_g),
    fat_g: d(firstDay.fat_g),
    carbs_g: d(firstDay.carbs_g),
    fiber_g: d(firstDay.fiber_g ?? 0),
  });
  const kbju = evaluatePlanKbjuStatus({
    days: input.days,
    targetMacro: targets,
    scheduleMode: mode,
    comparison,
  });
  // Не доверяем client-side is_valid: проверяем структуру и КБЖУ по содержимому.
  if (!kbju.acceptable) {
    throw Object.assign(
      new Error(
        kbju.invalidDayCount > 0
          ? `Нельзя опубликовать план: ${kbju.invalidDayCount} дн. вне допуска КБЖУ`
          : "Нельзя опубликовать невалидный или неполный план питания",
      ),
      { statusCode: 400 },
    );
  }
  const snapshot = buildConstructorNutritionSnapshot({
    days: input.days,
    targets: {
      kcal: input.plan.target_kcal,
      protein_g: input.plan.target_protein_g,
      fat_g: input.plan.target_fat_g,
      carbs_g: input.plan.target_carbs_g,
    },
    meal_schedule_mode: input.plan.meal_schedule_mode,
    primary_meal_slot: input.plan.primary_meal_slot,
    bmr: input.plan.bmr,
    tdee: input.plan.tdee,
    calorie_adjustment_pct: input.plan.calorie_adjustment_pct,
    notes: input.plan.notes,
    reason: input.reason ?? "trainer_publish",
  });
  const hash = nutritionSnapshotHash(snapshot);

  return withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    if (!courseId) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    await client.query(`SELECT id FROM public.client_courses WHERE id = $1 FOR UPDATE`, [courseId]);
    const owned = await client.query(
      `SELECT id FROM public.nutrition_plans WHERE user_id = $1 AND course_id = $2`,
      [input.clientId, courseId],
    );
    if (!owned.rowCount) {
      throw Object.assign(new Error("Черновик питания не принадлежит этому курсу"), {
        statusCode: 403,
      });
    }
    if (input.idempotencyKey) {
      const prior = await client.query(
        `SELECT i.version_id, v.content_hash
           FROM public.nutrition_publish_idempotency i
           JOIN public.nutrition_plan_versions v ON v.id = i.version_id
          WHERE i.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0] as { version_id: string; content_hash: string };
        if (row.content_hash !== hash) {
          throw Object.assign(
            new Error("Idempotency key уже использован с другим содержимым публикации"),
            { statusCode: 409 },
          );
        }
        return {
          versionId: row.version_id,
          contentHash: row.content_hash,
          idempotent: true,
        };
      }
    }
    const prev = await client.query(
      `SELECT a.active_version_id, v.version
         FROM public.client_program_assignments a
         JOIN public.nutrition_plan_versions v ON v.id = a.active_version_id
        WHERE a.course_id = $1 AND a.kind = 'nutrition'
        FOR UPDATE OF a`,
      [courseId],
    );
    const prevId =
      (prev.rows[0] as { active_version_id?: string } | undefined)?.active_version_id ?? null;
    const prevVer = (prev.rows[0] as { version?: number } | undefined)?.version ?? 0;
    const max = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM public.nutrition_plan_versions WHERE client_id = $1`,
      [input.clientId],
    );
    const newVer = prevId
      ? Math.max(prevVer + 1, Number((max.rows[0] as { n: number }).n))
      : Number((max.rows[0] as { n: number }).n);
    if (prevId) {
      await client.query(
        `UPDATE public.nutrition_plan_versions SET status = 'superseded' WHERE id = $1 AND status = 'published'`,
        [prevId],
      );
    }
    const inserted = await client.query(
      `INSERT INTO public.nutrition_plan_versions (
         client_id, course_id, version, status, snapshot, content_hash,
         parent_version_id, created_by, published_at, published_by
       ) VALUES ($1,$2,$3,'published',$4::jsonb,$5,$6,$7,(now() AT TIME ZONE 'utc'),$7)
       RETURNING id`,
      [input.clientId, courseId, newVer, JSON.stringify(snapshot), hash, prevId, input.actorId],
    );
    const versionId = (inserted.rows[0] as { id: string }).id;
    await client.query(
      `INSERT INTO public.client_program_assignments (client_id, course_id, kind, active_version_id, updated_by)
       VALUES ($1,$2,'nutrition',$3,$4)
       ON CONFLICT (client_id, kind, course_id) DO UPDATE SET
         active_version_id = EXCLUDED.active_version_id,
         updated_at = (now() AT TIME ZONE 'utc'),
         updated_by = EXCLUDED.updated_by`,
      [input.clientId, courseId, versionId, input.actorId],
    );
    await client.query(
      `INSERT INTO public.program_change_log (client_id, kind, action, actor_id, from_version_id, to_version_id, diff)
       VALUES ($1,'nutrition','publish',$2,$3,$4,$5::jsonb)`,
      [
        input.clientId,
        input.actorId,
        prevId,
        versionId,
        JSON.stringify({ reason: input.reason ?? null, content_hash: hash, course_id: courseId }),
      ],
    );
    await client.query(
      `INSERT INTO public.client_notifications (user_id, type, message, link)
       VALUES ($1,'nutrition_published',$2,'/dashboard/nutrition')`,
      [input.clientId, "Тренер обновил вашу программу питания с учётом текущего прогресса"],
    );
    if (input.idempotencyKey) {
      await client.query(
        `INSERT INTO public.nutrition_publish_idempotency (idempotency_key, client_id, course_id, version_id)
         VALUES ($1,$2,$3,$4)`,
        [input.idempotencyKey, input.clientId, courseId, versionId],
      );
    }
    return { versionId, contentHash: hash, idempotent: false };
  });
}

export async function loadMealPreferencePg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<{
  mode: ConstructorPlanRow["meal_schedule_mode"];
  primarySlot: ConstructorPlanRow["primary_meal_slot"];
} | null> {
  const loaded = await loadConstructorPlanPg(db, clientId, courseId);
  if (!loaded.plan) return null;
  return { mode: loaded.plan.meal_schedule_mode, primarySlot: loaded.plan.primary_meal_slot };
}

export async function saveMealPreferencePg(
  db: Pool,
  input: {
    clientId: string;
    courseId?: string | null;
    mode: ConstructorPlanRow["meal_schedule_mode"];
    primarySlot: ConstructorPlanRow["primary_meal_slot"];
    publishedMode?: ConstructorPlanRow["meal_schedule_mode"] | null;
  },
): Promise<void> {
  await withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    const updated = await client.query(
      `UPDATE public.nutrition_plans
          SET meal_schedule_mode = $3, primary_meal_slot = $4, updated_at = (now() AT TIME ZONE 'utc')
        WHERE user_id = $1 AND ($2::uuid IS NULL OR course_id = $2)
        RETURNING id`,
      [input.clientId, courseId, input.mode, input.primarySlot],
    );
    if (!updated.rowCount) {
      throw Object.assign(
        new Error("План питания ещё не создан. Дождитесь, пока тренер назначит рацион."),
        {
          statusCode: 400,
        },
      );
    }
    if (input.publishedMode != null && input.publishedMode !== input.mode) {
      const modeLabel =
        input.mode === "three_main_two_snacks"
          ? "5 приёмов (3 основных + 2 перекуса)"
          : input.mode === "three_mains_only"
            ? "3 полноценных приёма без перекусов"
            : input.mode === "one_main_three_snacks"
              ? "1 основной + 3 перекуса без готовки"
              : "классический формат (legacy 2+2)";
      await client.query(
        `INSERT INTO public.admin_notifications (type, client_id, message, link)
         VALUES ('nutrition_schedule_preference', $1, $2, $3)`,
        [
          input.clientId,
          `Клиент хочет изменить режим питания на «${modeLabel}». Соберите и опубликуйте новую версию меню.`,
          `/admin/clients/${input.clientId}/nutrition${courseId ? `?course=${courseId}` : ""}`,
        ],
      );
    }
  });
}

export async function loadPendingNutritionRecommendationPg(
  db: Queryable,
  clientId: string,
): Promise<import("@/lib/published-programs/types").NutritionRecommendation | null> {
  const { rows } = await db.query(
    `SELECT id, client_id, measurement_id, based_on_version_id, status,
            assigned_kcal, assigned_protein_g, assigned_fat_g, assigned_carbs_g,
            recommended_kcal, recommended_protein_g, recommended_fat_g, recommended_carbs_g,
            assigned_weight_kg, new_weight_kg, bmr, tdee, reason
       FROM public.nutrition_recommendations
      WHERE client_id = $1 AND status = 'pending_trainer_review'
      ORDER BY created_at DESC
      LIMIT 1`,
    [clientId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    measurement_id: (row.measurement_id as string | null) ?? null,
    based_on_version_id: (row.based_on_version_id as string | null) ?? null,
    status: row.status as import("@/lib/published-programs/types").RecommendationStatus,
    assigned_kcal: num(row.assigned_kcal),
    assigned_protein_g: num(row.assigned_protein_g),
    assigned_fat_g: num(row.assigned_fat_g),
    assigned_carbs_g: num(row.assigned_carbs_g),
    recommended_kcal: num(row.recommended_kcal),
    recommended_protein_g: num(row.recommended_protein_g),
    recommended_fat_g: num(row.recommended_fat_g),
    recommended_carbs_g: num(row.recommended_carbs_g),
    assigned_weight_kg: row.assigned_weight_kg == null ? null : num(row.assigned_weight_kg),
    new_weight_kg: row.new_weight_kg == null ? null : num(row.new_weight_kg),
    bmr: num(row.bmr),
    tdee: num(row.tdee),
    reason: (row.reason as string | null) ?? null,
  };
}

export async function acceptNutritionRecommendationPg(
  db: Queryable,
  recommendationId: string,
  reviewedBy: string,
): Promise<void> {
  await db.query(
    `UPDATE public.nutrition_recommendations
        SET status = 'accepted',
            reviewed_at = (now() AT TIME ZONE 'utc'),
            reviewed_by = $2
      WHERE id = $1 AND status = 'pending_trainer_review'`,
    [recommendationId, reviewedBy],
  );
}

export { type ConstructorDay };
