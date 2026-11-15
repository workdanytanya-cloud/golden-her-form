import type { Pool, PoolClient } from "pg";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import {
  CANNOT_FIT_RECIPE,
  DRAFT_CONFLICT_MESSAGE,
  SAME_RECIPE_MESSAGE,
  fitRecipeIntoDay,
  manualMealWithinDay,
  recipeRepeatReason,
  type MacroGrams,
  type MealReplacePreview,
} from "@/lib/nutrition-constructor/meal-replace";
import type { MealPlanItem, Recipe } from "@/lib/nutrition-constructor/types";
import { withTransaction } from "@/lib/selfhost/db";
import { resolveClientCourseIdPg } from "@/lib/selfhost/postgres-courses";
import {
  loadConstructorPlanPg,
  loadOptimizerContextPg,
  saveConstructorPlanPg,
} from "@/lib/selfhost/postgres-nutrition";
import { getActivePublishedNutritionPg } from "@/lib/selfhost/postgres-published";
import { constructorDaysFromSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import type { ConstructorPlanRow } from "@/lib/nutrition-constructor/repo";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MealReplaceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type ReplaceDraftMealInput = {
  userId: string;
  courseId?: string | null;
  dayIndex: number;
  slot: PlanSlot;
  mealItemId?: string | null;
  expectedUpdatedAt?: string | null;
  action: "preview" | "apply" | "suggest";
  recipeId?: string | null;
  manual?: {
    name: string;
    lines: Array<{ productId: string; grams: number }>;
  } | null;
};

export type ReplaceDraftMealResult = {
  action: ReplaceDraftMealInput["action"];
  replaced: boolean;
  createdDraft: boolean;
  updatedAt: string | null;
  message?: string;
  preview?: MealReplacePreview;
  options?: MealReplacePreview[];
  plan?: ConstructorPlanRow | null;
  days?: ConstructorDay[];
};

function fail(message: string, statusCode: number): never {
  throw new MealReplaceError(message, statusCode);
}

function sameMillis(stored: string | null | undefined, expected: string): boolean {
  const left = new Date(stored ?? "").getTime();
  const right = new Date(expected).getTime();
  return Number.isFinite(left) && left === right;
}

function targetsOf(plan: ConstructorPlanRow): MacroGrams {
  return {
    kcal: plan.target_kcal,
    protein_g: plan.target_protein_g,
    fat_g: plan.target_fat_g,
    carbs_g: plan.target_carbs_g,
  };
}

function slotKind(slot: PlanSlot): "main" | "snack" {
  return slot.startsWith("snack") ? "snack" : "main";
}

async function resolveRecipe(db: Pool | PoolClient, recipeId: string): Promise<string | null> {
  if (UUID_RE.test(recipeId)) return recipeId;
  const { rows } = await db.query(`SELECT id::text AS id FROM public.recipes WHERE slug = $1`, [
    recipeId,
  ]);
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

async function sourceDays(
  db: Pool | PoolClient,
  userId: string,
  courseId: string | null | undefined,
): Promise<{
  courseId: string;
  plan: ConstructorPlanRow | null;
  days: ConstructorDay[];
  fromPublished: boolean;
  targets: MacroGrams;
  mealScheduleMode: string;
  primaryMealSlot: string;
}> {
  const resolved = await resolveClientCourseIdPg(db, userId, courseId);
  if (!resolved) fail("Курс не найден", 404);
  const loaded = await loadConstructorPlanPg(db, userId, resolved);
  if (loaded.plan && loaded.days.length > 0) {
    return {
      courseId: resolved,
      plan: loaded.plan,
      days: loaded.days,
      fromPublished: false,
      targets: targetsOf(loaded.plan),
      mealScheduleMode: loaded.plan.meal_schedule_mode,
      primaryMealSlot: loaded.plan.primary_meal_slot,
    };
  }
  const published = await getActivePublishedNutritionPg(db, userId, resolved);
  if (!published || published.snapshot.kind !== "constructor") {
    fail("Черновик питания не найден", 404);
  }
  const snapshot = published.snapshot;
  return {
    courseId: resolved,
    plan: null,
    days: constructorDaysFromSnapshot(snapshot),
    fromPublished: true,
    targets: {
      kcal: Number(snapshot.targets.kcal),
      protein_g: Number(snapshot.targets.protein_g),
      fat_g: Number(snapshot.targets.fat_g),
      carbs_g: Number(snapshot.targets.carbs_g),
    },
    mealScheduleMode: snapshot.meal_schedule_mode,
    primaryMealSlot: snapshot.primary_meal_slot,
  };
}

function assertUnlocked(
  plan: ConstructorPlanRow | null,
  expectedUpdatedAt: string | null | undefined,
) {
  if (!plan) return;
  if (!expectedUpdatedAt) fail("Не передана версия черновика", 400);
  if (!sameMillis(plan.updated_at, expectedUpdatedAt)) fail(DRAFT_CONFLICT_MESSAGE, 409);
}

function previewForRecipe(
  days: ConstructorDay[],
  recipes: Recipe[],
  ctx: Awaited<ReturnType<typeof loadOptimizerContextPg>>,
  day: ConstructorDay,
  slot: PlanSlot,
  recipe: Recipe,
  targets: MacroGrams,
): MealReplacePreview {
  const current = day.items.find((item) => item.slot === slot);
  if (!current) fail("В этом дне нет выбранного приёма", 404);
  if (current.recipe_id === recipe.id) fail(SAME_RECIPE_MESSAGE, 400);
  const repeat = recipeRepeatReason(days, recipes, recipe, { dayIndex: day.day_index, slot });
  if (repeat) fail(repeat, 400);
  if (slotKind(slot) === "snack" && recipe.requires_cooking) {
    fail("В перекус нельзя поставить блюдо, которое нужно готовить", 400);
  }
  if (recipe.meal_type !== slotKind(slot)) {
    fail("Этот рецепт не подходит к выбранному типу приёма", 400);
  }
  const fitted = fitRecipeIntoDay({
    day,
    slot,
    recipe,
    ingredients: ctx.recipeIngredients.get(recipe.id) ?? [],
    products: ctx.products,
    targets,
  });
  if (!fitted.ok) {
    fail(`${fitted.message}${fitted.deviationText ? `. ${fitted.deviationText}` : ""}`, 422);
  }
  return fitted.preview;
}

async function writeMeal(
  client: PoolClient,
  itemId: string,
  item: MealPlanItem,
  recipeId: string | null,
): Promise<void> {
  const updated = await client.query(
    `UPDATE public.meal_plan_items
        SET recipe_id = $2,
            recipe_name = $3,
            requires_cooking = $4,
            prep_time_min = $5,
            steps = $6::jsonb,
            weighing_note = $7,
            snack_action = $8,
            kcal = $9,
            protein_g = $10,
            fat_g = $11,
            carbs_g = $12,
            fiber_g = $13,
            is_valid = $14
      WHERE id = $1`,
    [
      itemId,
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
    ],
  );
  if ((updated.rowCount ?? 0) !== 1) fail("Приём не обновлён", 409);
  await client.query(`DELETE FROM public.meal_plan_item_ingredients WHERE meal_item_id = $1`, [
    itemId,
  ]);
  for (let index = 0; index < item.ingredients.length; index += 1) {
    const ing = item.ingredients[index]!;
    const grams = Number(ing.grams);
    if (!Number.isFinite(grams) || grams <= 0) continue;
    await client.query(
      `INSERT INTO public.meal_plan_item_ingredients (
         meal_item_id, product_id, product_name, grams, weighing_note,
         kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
         kcal, protein_g, fat_g, carbs_g, fiber_g, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        itemId,
        ing.product_id,
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
        ing.sort_order ?? index,
      ],
    );
  }
}

export async function replaceDraftMealPg(
  db: Pool,
  input: ReplaceDraftMealInput,
): Promise<ReplaceDraftMealResult> {
  const source = await sourceDays(db, input.userId, input.courseId);
  const day = source.days.find((item) => item.day_index === input.dayIndex);
  if (!day) fail("День не найден", 404);
  const current = day.items.find((item) => item.slot === input.slot);
  if (!current) fail("В этом дне нет выбранного приёма", 404);
  if (input.mealItemId && current.id && input.mealItemId !== current.id) {
    fail(DRAFT_CONFLICT_MESSAGE, 409);
  }
  if (input.action !== "suggest" && !input.recipeId && !input.manual) {
    fail("Не выбран рецепт", 400);
  }
  if (input.action === "apply") assertUnlocked(source.plan, input.expectedUpdatedAt);
  const ctx = await loadOptimizerContextPg(db);
  const targets = source.targets;
  const recipes = ctx.recipes;

  if (input.action === "suggest") {
    const options: MealReplacePreview[] = [];
    const pool = (slotKind(input.slot) === "snack" ? ctx.snackRecipes : ctx.mainRecipes).filter(
      (recipe) => recipe.is_active && recipe.id !== current.recipe_id,
    );
    for (const recipe of pool) {
      if (options.length >= 8) break;
      try {
        options.push(previewForRecipe(source.days, recipes, ctx, day, input.slot, recipe, targets));
      } catch (error) {
        if (
          error instanceof MealReplaceError &&
          (error.statusCode === 400 || error.statusCode === 422)
        ) {
          continue;
        }
        throw error;
      }
    }
    return {
      action: "suggest",
      replaced: false,
      createdDraft: false,
      updatedAt: source.plan?.updated_at ?? null,
      options,
    };
  }

  let preview: MealReplacePreview;
  if (input.manual) {
    const lines = [];
    for (const [index, line] of input.manual.lines.entries()) {
      const product =
        ctx.products.get(line.productId) ??
        [...ctx.products.values()].find((item) => item.slug === line.productId);
      if (!product) fail("Продукт не найден", 400);
      if (!Number.isFinite(line.grams) || line.grams <= 0)
        fail("Граммовка должна быть больше нуля", 400);
      lines.push(buildIngredientLine(product, line.grams, index));
    }
    const manualRecipe: Recipe = {
      id: `manual-${input.slot}`,
      slug: `manual-${input.slot}`,
      name: input.manual.name.trim() || "Собственный приём",
      meal_type: slotKind(input.slot),
      steps: ["Соберите продукты из списка.", "Разложите их по граммовке.", "Подайте приём."],
      prep_time_min: 10,
      requires_cooking: false,
      is_active: true,
      weighing_note: null,
      is_nutrient_dense: true,
      contains_protein_source: false,
      contains_fruit_or_vegetable: false,
      is_treat: false,
      allowed_schedule_modes: [],
      snack_action: null,
    };
    const item = buildMealPlanItem({ slot: input.slot, recipe: manualRecipe, ingredients: lines });
    const checked = manualMealWithinDay({ day, slot: input.slot, item, targets });
    if (!checked.ok) {
      fail(`${checked.message}${checked.deviationText ? `. ${checked.deviationText}` : ""}`, 422);
    }
    preview = checked.preview;
  } else {
    const resolvedId = await resolveRecipe(db, input.recipeId!);
    const recipe =
      recipes.find((item) => item.id === resolvedId) ??
      recipes.find((item) => item.slug === input.recipeId);
    if (!recipe) fail("Рецепт не найден", 404);
    preview = previewForRecipe(source.days, recipes, ctx, day, input.slot, recipe, targets);
  }

  if (input.action === "preview") {
    return {
      action: "preview",
      replaced: false,
      createdDraft: false,
      updatedAt: source.plan?.updated_at ?? null,
      preview,
    };
  }

  assertUnlocked(source.plan, input.expectedUpdatedAt);
  return withTransaction(async (client) => {
    if (!source.plan) {
      const existing = await client.query(
        `SELECT id FROM public.nutrition_plans WHERE user_id = $1 AND course_id = $2 FOR UPDATE`,
        [input.userId, source.courseId],
      );
      if ((existing.rowCount ?? 0) > 0) fail(DRAFT_CONFLICT_MESSAGE, 409);
      const replacedDays = source.days.map((item) =>
        item.day_index === day.day_index ? preview.day : item,
      );
      const saved = await saveConstructorPlanPg(client, {
        userId: input.userId,
        courseId: source.courseId,
        days: replacedDays,
        targets,
        plan_days_count: ([1, 7, 14, 28].includes(replacedDays.length)
          ? replacedDays.length
          : 7) as 1 | 7 | 14 | 28,
        plan_status: "draft",
        meal_schedule_mode: source.mealScheduleMode as "three_main_two_snacks",
        primary_meal_slot: source.primaryMealSlot as "lunch",
        targets_manual: true,
        review_reason: "Создан новый черновик. Клиент продолжает видеть опубликованную версию.",
      });
      const savedItem = saved.days
        .find((item) => item.day_index === input.dayIndex)
        ?.items.find((item) => item.slot === input.slot);
      const expectedId = UUID_RE.test(preview.item.recipe_id) ? preview.item.recipe_id : "";
      if (
        !savedItem ||
        (expectedId
          ? savedItem.recipe_id !== expectedId
          : savedItem.recipe_name !== preview.recipeName)
      ) {
        fail("Повторное чтение не подтвердило замену", 409);
      }
      return {
        action: "apply" as const,
        replaced: true,
        createdDraft: true,
        updatedAt: saved.plan.updated_at ?? null,
        message: "Создан новый черновик. Клиент продолжает видеть опубликованную версию.",
        preview,
        plan: saved.plan,
        days: saved.days,
      };
    }

    const locked = await client.query(
      `SELECT id::text AS id, updated_at
         FROM public.nutrition_plans
        WHERE id = $1
        FOR UPDATE`,
      [source.plan.id],
    );
    const row = locked.rows[0] as { id: string; updated_at: string } | undefined;
    if (!row || !sameMillis(new Date(row.updated_at).toISOString(), input.expectedUpdatedAt!)) {
      fail(DRAFT_CONFLICT_MESSAGE, 409);
    }
    if (!current.id) fail("Не указан заменяемый приём", 400);
    const storedRecipeId = UUID_RE.test(preview.item.recipe_id) ? preview.item.recipe_id : null;
    await writeMeal(client, current.id, { ...preview.item, id: current.id }, storedRecipeId);
    const bumped = await client.query(
      `UPDATE public.nutrition_plans
          SET updated_at = (now() AT TIME ZONE 'utc'),
              plan_status = 'draft'
        WHERE id = $1
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)`,
      [source.plan.id, input.expectedUpdatedAt],
    );
    if ((bumped.rowCount ?? 0) !== 1) fail(DRAFT_CONFLICT_MESSAGE, 409);
    const confirmed = await client.query(
      `SELECT recipe_id::text AS recipe_id, recipe_name
         FROM public.meal_plan_items
        WHERE id = $1`,
      [current.id],
    );
    const confirmedRow = confirmed.rows[0] as
      { recipe_id: string | null; recipe_name: string } | undefined;
    if (!confirmedRow) fail("Повторное чтение не подтвердило замену", 409);
    if (storedRecipeId) {
      if (confirmedRow.recipe_id !== storedRecipeId)
        fail("Повторное чтение не подтвердило замену", 409);
    } else if (confirmedRow.recipe_name !== preview.recipeName) {
      fail("Повторное чтение не подтвердило замену", 409);
    }
    const slotCount = await client.query(
      `SELECT count(*)::int AS n
         FROM public.meal_plan_items
        WHERE plan_day_id = (SELECT plan_day_id FROM public.meal_plan_items WHERE id = $1)
          AND slot = $2`,
      [current.id, input.slot],
    );
    if (Number((slotCount.rows[0] as { n: number }).n) !== 1) {
      fail("В дне должен остаться один приём на этот слот", 409);
    }
    const loaded = await loadConstructorPlanPg(client, input.userId, source.courseId);
    return {
      action: "apply" as const,
      replaced: true,
      createdDraft: false,
      updatedAt: loaded.plan?.updated_at ?? null,
      preview,
      plan: loaded.plan,
      days: loaded.days,
    };
  });
}

export async function loadRebuildExclusions(
  db: Pool,
  userId: string,
  courseId?: string | null,
): Promise<{
  hadDraft: boolean;
  recipeIds: string[];
  variantGroups: string[];
  signatures: string[];
}> {
  const loaded = await loadConstructorPlanPg(db, userId, courseId);
  const recipeIds = [
    ...new Set(
      loaded.days.flatMap((day) =>
        day.items.map((item) => item.recipe_id).filter((id) => UUID_RE.test(id)),
      ),
    ),
  ];
  if (recipeIds.length === 0) {
    return { hadDraft: loaded.days.length > 0, recipeIds: [], variantGroups: [], signatures: [] };
  }
  const { rows } = await db.query(
    `SELECT variant_group, ingredient_signature
       FROM public.recipes
      WHERE id = ANY($1::uuid[])`,
    [recipeIds],
  );
  return {
    hadDraft: loaded.days.length > 0,
    recipeIds,
    variantGroups: [
      ...new Set(
        (rows as Array<{ variant_group: string | null }>)
          .map((row) => row.variant_group)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    signatures: [
      ...new Set(
        (rows as Array<{ ingredient_signature: string | null }>)
          .map((row) => row.ingredient_signature)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}
