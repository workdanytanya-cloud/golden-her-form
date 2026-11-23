import type { Pool, PoolClient } from "pg";
import { buildIngredientLine } from "@/lib/nutrition-constructor/calculator";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import { checkNutritionDraft, type DraftIssue } from "@/lib/nutrition-constructor/draft-check";
import { DRAFT_CONFLICT_MESSAGE } from "@/lib/nutrition-constructor/meal-replace";
import { composeRecipeSteps } from "@/lib/nutrition-constructor/recipe-instructions";
import { repairRecipeName, technicalNameReason } from "@/lib/nutrition-constructor/recipe-names";
import type { ConstructorDay, FoodProduct, MealPlanItem } from "@/lib/nutrition-constructor/types";
import type { ConstructorPlanRow } from "@/lib/nutrition-constructor/repo";
import { withTransaction } from "@/lib/selfhost/db";
import { resolveClientCourseIdPg } from "@/lib/selfhost/postgres-courses";
import {
  loadConstructorPlanPg,
  loadOptimizerContextPg,
  publishNutritionVersionPg,
} from "@/lib/selfhost/postgres-nutrition";
import { getActivePublishedNutritionPg } from "@/lib/selfhost/postgres-published";
import { loadTrainingDraftPg, publishTrainingVersionPg } from "@/lib/selfhost/postgres-training";
import { MealReplaceError } from "@/lib/selfhost/postgres-meal-replace";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, statusCode: number): never {
  throw new MealReplaceError(message, statusCode);
}

function sameMillis(stored: string | null | undefined, expected: string): boolean {
  const left = new Date(stored ?? "").getTime();
  const right = new Date(expected).getTime();
  return Number.isFinite(left) && left === right;
}

type DraftContext = {
  courseId: string;
  plan: ConstructorPlanRow;
  days: ConstructorDay[];
};

async function loadDraft(
  db: Pool | PoolClient,
  userId: string,
  courseId?: string | null,
): Promise<DraftContext> {
  const resolved = await resolveClientCourseIdPg(db, userId, courseId);
  if (!resolved) fail("Курс не найден", 404);
  const loaded = await loadConstructorPlanPg(db, userId, resolved);
  if (!loaded.plan) fail("Черновик питания не найден", 404);
  return { courseId: resolved, plan: loaded.plan, days: loaded.days };
}

function assertVersion(plan: ConstructorPlanRow, expectedUpdatedAt?: string | null) {
  if (!expectedUpdatedAt) fail("Не передана версия черновика", 400);
  if (!sameMillis(plan.updated_at, expectedUpdatedAt)) fail(DRAFT_CONFLICT_MESSAGE, 409);
}

async function bumpDraft(client: PoolClient, planId: string, expectedUpdatedAt: string) {
  const bumped = await client.query(
    `UPDATE public.nutrition_plans
        SET updated_at = (now() AT TIME ZONE 'utc'),
            plan_status = 'draft',
            requires_manual_review = true
      WHERE id = $1
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $2::timestamptz)`,
    [planId, expectedUpdatedAt],
  );
  if ((bumped.rowCount ?? 0) !== 1) fail(DRAFT_CONFLICT_MESSAGE, 409);
}

function findProduct(products: Map<string, FoodProduct>, id: string): FoodProduct | undefined {
  return products.get(id) ?? [...products.values()].find((product) => product.slug === id);
}

function mealFromLines(params: {
  slot: PlanSlot;
  name: string;
  steps: string[];
  prepTimeMin: number | null;
  note: string | null;
  lines: Array<{ productId: string; grams: number }>;
  products: Map<string, FoodProduct>;
  recipeId: string | null;
}): MealPlanItem {
  const name = repairRecipeName(params.name.trim());
  const nameIssue = technicalNameReason(name);
  if (!name) fail("Укажите название блюда", 400);
  if (nameIssue) fail(nameIssue, 400);
  if (params.lines.length === 0) fail("В приёме должен быть хотя бы один продукт", 400);
  const ingredients = params.lines.map((line, index) => {
    if (!Number.isFinite(line.grams) || line.grams <= 0) {
      fail("Граммы должны быть больше нуля", 400);
    }
    const product = findProduct(params.products, line.productId);
    if (!product) fail("Продукт не найден в каталоге", 400);
    return buildIngredientLine(product, line.grams, index);
  });
  const totals = ingredients.reduce(
    (acc, line) => ({
      kcal: acc.kcal + Number(line.kcal),
      protein_g: acc.protein_g + Number(line.protein_g),
      fat_g: acc.fat_g + Number(line.fat_g),
      carbs_g: acc.carbs_g + Number(line.carbs_g),
      fiber_g: acc.fiber_g + Number(line.fiber_g ?? 0),
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 },
  );
  return {
    slot: params.slot,
    recipe_id: params.recipeId ?? "",
    recipe_name: name,
    requires_cooking: params.steps.length > 0,
    prep_time_min: params.prepTimeMin,
    steps: params.steps
      .map((step) => step.trim())
      .filter(Boolean)
      .slice(0, 7),
    weighing_note: params.note,
    kcal: String(totals.kcal),
    protein_g: String(totals.protein_g),
    fat_g: String(totals.fat_g),
    carbs_g: String(totals.carbs_g),
    fiber_g: String(totals.fiber_g),
    is_valid: true,
    ingredients,
  };
}

async function writeItem(
  client: PoolClient,
  itemId: string,
  item: MealPlanItem,
  recipeId: string | null,
) {
  const updated = await client.query(
    `UPDATE public.meal_plan_items
        SET recipe_name = $2,
            recipe_id = $3,
            requires_cooking = $4,
            prep_time_min = $5,
            steps = $6::jsonb,
            weighing_note = $7,
            kcal = $8,
            protein_g = $9,
            fat_g = $10,
            carbs_g = $11,
            fiber_g = $12,
            is_valid = true
      WHERE id = $1`,
    [
      itemId,
      item.recipe_name,
      recipeId,
      item.requires_cooking,
      item.prep_time_min,
      JSON.stringify(item.steps ?? []),
      item.weighing_note,
      item.kcal,
      item.protein_g,
      item.fat_g,
      item.carbs_g,
      item.fiber_g,
    ],
  );
  if ((updated.rowCount ?? 0) !== 1) fail("Приём не обновлён", 409);
  await client.query(`DELETE FROM public.meal_plan_item_ingredients WHERE meal_item_id = $1`, [
    itemId,
  ]);
  for (const [index, line] of item.ingredients.entries()) {
    await client.query(
      `INSERT INTO public.meal_plan_item_ingredients (
         meal_item_id, product_id, product_name, grams, weighing_note,
         kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
         kcal, protein_g, fat_g, carbs_g, fiber_g, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        itemId,
        line.product_id,
        line.product_name,
        Number(line.grams),
        line.weighing_note,
        line.kcal_per_100g,
        line.protein_per_100g,
        line.fat_per_100g,
        line.carbs_per_100g,
        line.fiber_per_100g,
        line.kcal,
        line.protein_g,
        line.fat_g,
        line.carbs_g,
        line.fiber_g ?? 0,
        index,
      ],
    );
  }
}

export async function updateDraftMealPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    dayIndex: number;
    slot: PlanSlot;
    mealItemId: string;
    expectedUpdatedAt?: string | null;
    name: string;
    steps: string[];
    prepTimeMin?: number | null;
    note?: string | null;
    lines: Array<{ productId: string; grams: number }>;
  },
) {
  const source = await loadDraft(db, input.userId, input.courseId);
  assertVersion(source.plan, input.expectedUpdatedAt);
  const day = source.days.find((item) => item.day_index === input.dayIndex);
  const current = day?.items.find((item) => item.slot === input.slot);
  if (!day || !current?.id || current.id !== input.mealItemId) {
    fail(DRAFT_CONFLICT_MESSAGE, 409);
  }
  const ctx = await loadOptimizerContextPg(db);
  const next = mealFromLines({
    slot: input.slot,
    name: input.name,
    steps: input.steps,
    prepTimeMin: input.prepTimeMin ?? current.prep_time_min,
    note: input.note ?? null,
    lines: input.lines,
    products: ctx.products,
    recipeId: current.recipe_id || null,
  });
  const recipeId = UUID_RE.test(current.recipe_id) ? current.recipe_id : null;
  return withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT updated_at FROM public.nutrition_plans WHERE id = $1 FOR UPDATE`,
      [source.plan.id],
    );
    const stored = locked.rows[0] as { updated_at: string } | undefined;
    if (
      !stored ||
      !sameMillis(new Date(stored.updated_at).toISOString(), input.expectedUpdatedAt!)
    ) {
      fail(DRAFT_CONFLICT_MESSAGE, 409);
    }
    await writeItem(client, current.id!, next, recipeId);
    await bumpDraft(client, source.plan.id, input.expectedUpdatedAt!);
    const loaded = await loadConstructorPlanPg(client, input.userId, source.courseId);
    const saved = loaded.days
      .find((item) => item.day_index === input.dayIndex)
      ?.items.find((item) => item.id === current.id);
    if (!saved || saved.recipe_name !== next.recipe_name) {
      fail("Повторное чтение не подтвердило сохранение", 409);
    }
    const savedGrams = saved.ingredients.map((line) => Math.round(Number(line.grams)));
    const wanted = next.ingredients.map((line) => Math.round(Number(line.grams)));
    if (savedGrams.join(",") !== wanted.join(",")) {
      fail("Повторное чтение не подтвердило граммы", 409);
    }
    return {
      saved: true,
      updatedAt: loaded.plan?.updated_at ?? null,
      plan: loaded.plan,
      days: loaded.days,
      message: "Изменения сохранены. Есть неопубликованные изменения.",
    };
  });
}

export async function deleteDraftMealPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    dayIndex: number;
    slot: PlanSlot;
    mealItemId: string;
    expectedUpdatedAt?: string | null;
  },
) {
  const source = await loadDraft(db, input.userId, input.courseId);
  const day = source.days.find((item) => item.day_index === input.dayIndex);
  const current = day?.items.find((item) => item.slot === input.slot);
  if (!current) {
    return {
      removed: true,
      already: true,
      updatedAt: source.plan.updated_at,
      days: source.days,
      message: "Приём уже удалён",
    };
  }
  if (current.id !== input.mealItemId) fail(DRAFT_CONFLICT_MESSAGE, 409);
  assertVersion(source.plan, input.expectedUpdatedAt);
  return withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT updated_at FROM public.nutrition_plans WHERE id = $1 FOR UPDATE`,
      [source.plan.id],
    );
    const stored = locked.rows[0] as { updated_at: string } | undefined;
    if (
      !stored ||
      !sameMillis(new Date(stored.updated_at).toISOString(), input.expectedUpdatedAt!)
    ) {
      const again = await loadConstructorPlanPg(client, input.userId, source.courseId);
      const still = again.days
        .find((item) => item.day_index === input.dayIndex)
        ?.items.find((item) => item.slot === input.slot);
      if (!still) {
        return {
          removed: true,
          already: true,
          updatedAt: again.plan?.updated_at ?? null,
          days: again.days,
          message: "Приём уже удалён",
        };
      }
      fail(DRAFT_CONFLICT_MESSAGE, 409);
    }
    const deleted = await client.query(
      `DELETE FROM public.meal_plan_items WHERE id = $1 AND slot = $2`,
      [input.mealItemId, input.slot],
    );
    if ((deleted.rowCount ?? 0) !== 1) fail("Приём не удалён", 409);
    await bumpDraft(client, source.plan.id, input.expectedUpdatedAt!);
    const loaded = await loadConstructorPlanPg(client, input.userId, source.courseId);
    const gone = loaded.days
      .find((item) => item.day_index === input.dayIndex)
      ?.items.some((item) => item.id === input.mealItemId || item.slot === input.slot);
    if (gone) fail("Повторное чтение не подтвердило удаление", 409);
    return {
      removed: true,
      already: false,
      updatedAt: loaded.plan?.updated_at ?? null,
      plan: loaded.plan,
      days: loaded.days,
      message: "Приём удалён. День не завершён, пока слот пуст.",
    };
  });
}

export async function addDraftMealPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    dayIndex: number;
    slot: PlanSlot;
    expectedUpdatedAt?: string | null;
    name: string;
    steps: string[];
    prepTimeMin?: number | null;
    note?: string | null;
    lines: Array<{ productId: string; grams: number }>;
    recipeId?: string | null;
  },
) {
  const source = await loadDraft(db, input.userId, input.courseId);
  assertVersion(source.plan, input.expectedUpdatedAt);
  const day = source.days.find((item) => item.day_index === input.dayIndex);
  if (!day) fail("День не найден", 404);
  if (day.items.some((item) => item.slot === input.slot)) {
    fail("В этом слоте уже есть приём. Используйте замену.", 409);
  }
  const ctx = await loadOptimizerContextPg(db);
  const next = mealFromLines({
    slot: input.slot,
    name: input.name,
    steps: input.steps,
    prepTimeMin: input.prepTimeMin ?? null,
    note: input.note ?? null,
    lines: input.lines,
    products: ctx.products,
    recipeId: input.recipeId ?? null,
  });
  const recipeId =
    input.recipeId && UUID_RE.test(input.recipeId)
      ? input.recipeId
      : input.recipeId
        ? ((
            (
              await db.query(`SELECT id::text AS id FROM public.recipes WHERE slug = $1`, [
                input.recipeId,
              ])
            ).rows[0] as { id: string } | undefined
          )?.id ?? null)
        : null;
  return withTransaction(async (client) => {
    const dayRow = await client.query(
      `SELECT d.id
         FROM public.nutrition_plan_days d
         JOIN public.nutrition_plans p ON p.id = d.plan_id
        WHERE p.id = $1 AND d.day_index = $2
        FOR UPDATE OF p`,
      [source.plan.id, input.dayIndex],
    );
    const dayId = (dayRow.rows[0] as { id: string } | undefined)?.id;
    if (!dayId) fail("День черновика не найден", 404);
    const inserted = await client.query(
      `INSERT INTO public.meal_plan_items (
         plan_day_id, slot, recipe_id, recipe_name, requires_cooking, prep_time_min, steps,
         weighing_note, kcal, protein_g, fat_g, carbs_g, fiber_g, is_valid, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,true,$14)
       ON CONFLICT (plan_day_id, slot) DO NOTHING
       RETURNING id`,
      [
        dayId,
        input.slot,
        recipeId,
        next.recipe_name,
        next.requires_cooking,
        next.prep_time_min,
        JSON.stringify(next.steps ?? []),
        next.weighing_note,
        next.kcal,
        next.protein_g,
        next.fat_g,
        next.carbs_g,
        next.fiber_g,
        day.items.length,
      ],
    );
    const itemId = (inserted.rows[0] as { id: string } | undefined)?.id;
    if (!itemId) fail("В этом слоте уже есть приём. Обновите страницу.", 409);
    for (const [index, line] of next.ingredients.entries()) {
      await client.query(
        `INSERT INTO public.meal_plan_item_ingredients (
           meal_item_id, product_id, product_name, grams, weighing_note,
           kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
           kcal, protein_g, fat_g, carbs_g, fiber_g, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          itemId,
          line.product_id,
          line.product_name,
          Number(line.grams),
          line.weighing_note,
          line.kcal_per_100g,
          line.protein_per_100g,
          line.fat_per_100g,
          line.carbs_per_100g,
          line.fiber_per_100g,
          line.kcal,
          line.protein_g,
          line.fat_g,
          line.carbs_g,
          line.fiber_g ?? 0,
          index,
        ],
      );
    }
    await bumpDraft(client, source.plan.id, input.expectedUpdatedAt!);
    const loaded = await loadConstructorPlanPg(client, input.userId, source.courseId);
    const saved = loaded.days
      .find((item) => item.day_index === input.dayIndex)
      ?.items.find((item) => item.slot === input.slot);
    if (!saved || saved.recipe_name !== next.recipe_name) {
      fail("Повторное чтение не подтвердило добавление", 409);
    }
    return {
      added: true,
      updatedAt: loaded.plan?.updated_at ?? null,
      plan: loaded.plan,
      days: loaded.days,
      message: "Приём добавлен",
    };
  });
}

export async function deleteNutritionDraftPg(
  db: Pool,
  input: { userId: string; courseId?: string | null },
) {
  const resolved = await resolveClientCourseIdPg(db, input.userId, input.courseId);
  if (!resolved) fail("Курс не найден", 404);
  const deleted = await db.query(
    `DELETE FROM public.nutrition_plans WHERE user_id = $1 AND course_id = $2`,
    [input.userId, resolved],
  );
  return {
    deleted: true,
    already: (deleted.rowCount ?? 0) === 0,
    message:
      (deleted.rowCount ?? 0) === 0
        ? "Черновика уже нет. Опубликованная программа не изменилась."
        : "Черновик рациона удалён. Опубликованная программа не изменилась.",
  };
}

function proposedText(
  item: MealPlanItem,
  products: Map<string, FoodProduct>,
  catalogSteps: string[] | null,
) {
  const ingredients = item.ingredients.flatMap((line) => {
    const product = findProduct(products, line.product_id);
    if (!product) return [];
    return [
      {
        slug: product.slug,
        name: product.name,
        category: product.category,
        state: product.state,
        requiresCooking: product.requires_cooking,
      },
    ];
  });
  const name = repairRecipeName(item.recipe_name);
  const steps = composeRecipeSteps({
    name,
    requiresCooking: item.requires_cooking,
    ingredients,
  }).steps;
  const current = (item.steps ?? []).join("\n");
  const manual =
    catalogSteps != null && current !== catalogSteps.join("\n") && current !== steps.join("\n");
  return {
    name,
    steps,
    nameChanged: name !== item.recipe_name,
    stepsChanged: current !== steps.join("\n"),
    manual,
  };
}

export async function refreshDraftTextPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    expectedUpdatedAt?: string | null;
    apply: boolean;
    overwriteManual?: boolean;
  },
) {
  const source = await loadDraft(db, input.userId, input.courseId);
  const ctx = await loadOptimizerContextPg(db);
  const recipeSteps = new Map(ctx.recipes.map((recipe) => [recipe.id, recipe.steps]));
  const changes = source.days.flatMap((day) =>
    day.items.flatMap((item) => {
      const proposal = proposedText(item, ctx.products, recipeSteps.get(item.recipe_id) ?? null);
      if (!proposal.nameChanged && !proposal.stepsChanged) return [];
      return [
        {
          dayIndex: day.day_index,
          slot: item.slot,
          mealItemId: item.id ?? "",
          from: item.recipe_name,
          to: proposal.name,
          nameChanged: proposal.nameChanged,
          stepsChanged: proposal.stepsChanged,
          manual: proposal.manual,
          steps: proposal.steps,
        },
      ];
    }),
  );
  if (!input.apply) {
    return {
      preview: true,
      names: changes.filter((row) => row.nameChanged).length,
      instructions: changes.filter((row) => row.stepsChanged).length,
      changes,
    };
  }
  assertVersion(source.plan, input.expectedUpdatedAt);
  const applicable = changes.filter((row) => !row.manual || input.overwriteManual);
  return withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT updated_at FROM public.nutrition_plans WHERE id = $1 FOR UPDATE`,
      [source.plan.id],
    );
    const stored = locked.rows[0] as { updated_at: string } | undefined;
    if (
      !stored ||
      !sameMillis(new Date(stored.updated_at).toISOString(), input.expectedUpdatedAt!)
    ) {
      fail(DRAFT_CONFLICT_MESSAGE, 409);
    }
    for (const change of applicable) {
      await client.query(
        `UPDATE public.meal_plan_items
            SET recipe_name = $2, steps = $3::jsonb
          WHERE id = $1`,
        [change.mealItemId, change.to, JSON.stringify(change.steps)],
      );
    }
    if (applicable.length > 0) await bumpDraft(client, source.plan.id, input.expectedUpdatedAt!);
    const loaded = await loadConstructorPlanPg(client, input.userId, source.courseId);
    return {
      preview: false,
      names: applicable.filter((row) => row.nameChanged).length,
      instructions: applicable.filter((row) => row.stepsChanged).length,
      skippedManual: changes.filter((row) => row.manual && !input.overwriteManual).length,
      updatedAt: loaded.plan?.updated_at ?? source.plan.updated_at,
      days: loaded.days,
      message:
        applicable.length === 0
          ? "Названия и инструкции уже в порядке"
          : "Названия и инструкции черновика обновлены",
    };
  });
}

export async function validateDraftPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    acknowledgeOutOfTolerance?: boolean;
  },
): Promise<{ ok: boolean; issues: DraftIssue[]; message: string }> {
  const source = await loadDraft(db, input.userId, input.courseId);
  const ctx = await loadOptimizerContextPg(db);
  const issues = checkNutritionDraft({
    days: source.days,
    targets: {
      kcal: source.plan.target_kcal,
      protein_g: source.plan.target_protein_g,
      fat_g: source.plan.target_fat_g,
      carbs_g: source.plan.target_carbs_g,
    },
    mode: source.plan.meal_schedule_mode,
    products: ctx.products,
    expectedDays: source.plan.plan_days_count,
    allowOutOfToleranceKbju: input.acknowledgeOutOfTolerance === true,
  });
  return {
    ok: issues.length === 0,
    issues,
    message:
      issues.length === 0
        ? "Рацион можно публиковать"
        : "В рационе есть ошибки. Публикация недоступна.",
  };
}

export async function publishAndOpenAccessPg(
  db: Pool,
  input: {
    userId: string;
    courseId?: string | null;
    actorId: string;
    reason?: string | null;
    acknowledgeOutOfTolerance?: boolean;
  },
) {
  const resolved = await resolveClientCourseIdPg(db, input.userId, input.courseId);
  if (!resolved) fail("Курс не найден", 404);
  const course = await db.query(
    `SELECT program_scope FROM public.client_courses WHERE id = $1 AND client_id = $2`,
    [resolved, input.userId],
  );
  const scope = String(
    (course.rows[0] as { program_scope?: string } | undefined)?.program_scope ?? "",
  );
  if (!scope) fail("Курс не найден", 404);
  const nutritionNeeded = scope === "nutrition" || scope === "both";
  const trainingNeeded = scope === "training" || scope === "both";
  if (nutritionNeeded) {
    const check = await validateDraftPg(db, input);
    if (!check.ok) {
      const error = new MealReplaceError(
        "Рацион нельзя опубликовать, пока в проверке есть ошибки",
        422,
      );
      (error as MealReplaceError & { issues?: DraftIssue[] }).issues = check.issues;
      throw error;
    }
  }
  if (trainingNeeded) {
    const training = await loadTrainingDraftPg(db, input.userId, resolved);
    if (!training.program || training.days.length === 0) {
      fail("Тренировки не готовы. Публикация не выполнена, доступ не открыт.", 422);
    }
  }
  let nutrition: { versionId: string } | null = null;
  if (nutritionNeeded) {
    const loaded = await loadConstructorPlanPg(db, input.userId, resolved);
    if (!loaded.plan) fail("Черновик питания не найден", 404);
    if (input.acknowledgeOutOfTolerance) {
      await db.query(
        `UPDATE public.nutrition_plans
            SET requires_manual_review = true,
                review_reason = COALESCE($3, review_reason),
                updated_at = (now() AT TIME ZONE 'utc')
          WHERE user_id = $1 AND course_id = $2`,
        [
          input.userId,
          resolved,
          "Опубликовано тренером вне допуска КБЖУ",
        ],
      );
    }
    nutrition = await publishNutritionVersionPg(db, {
      clientId: input.userId,
      courseId: resolved,
      actorId: input.actorId,
      reason:
        input.reason ??
        (input.acknowledgeOutOfTolerance
          ? "Опубликовать и открыть доступ (подтверждение тренера вне допуска КБЖУ)"
          : "Опубликовать и открыть доступ"),
      days: loaded.days,
      plan: loaded.plan,
      acknowledgeOutOfTolerance: input.acknowledgeOutOfTolerance,
    });
  }
  const training = trainingNeeded
    ? await publishTrainingVersionPg(db, {
        clientId: input.userId,
        courseId: resolved,
        actorId: input.actorId,
        reason: input.reason ?? "Опубликовать и открыть доступ",
      })
    : null;
  await db.query(
    `UPDATE public.client_courses SET status = 'completed'
      WHERE client_id = $1 AND status = 'active' AND id <> $2`,
    [input.userId, resolved],
  );
  await db.query(
    `UPDATE public.client_courses SET status = 'active' WHERE id = $1 AND client_id = $2`,
    [resolved, input.userId],
  );
  await db.query(
    `INSERT INTO public.client_access (user_id, status, activated_at, activated_by, updated_at)
     VALUES ($1, 'active', (now() AT TIME ZONE 'utc'), $2, (now() AT TIME ZONE 'utc'))
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'active',
       activated_at = COALESCE(public.client_access.activated_at, EXCLUDED.activated_at),
       activated_by = COALESCE(public.client_access.activated_by, EXCLUDED.activated_by),
       updated_at = (now() AT TIME ZONE 'utc')`,
    [input.userId, input.actorId],
  );
  if (nutrition) {
    const visible = await getActivePublishedNutritionPg(db, input.userId, resolved);
    if (!visible || visible.version.id !== nutrition.versionId) {
      fail("Клиент не получил опубликованную версию питания", 409);
    }
  }
  return {
    published: true,
    nutritionVersionId: nutrition?.versionId ?? null,
    trainingVersionId: training?.versionId ?? null,
    message: "Программа опубликована. Доступ клиента открыт",
  };
}
