import {
  DEFAULT_TOLERANCE,
  GRAM_STEP,
  MAIN_RECIPE_REPEAT_DAYS,
  ONE_MAIN_UNACHIEVABLE_MESSAGE,
  type MealScheduleMode,
  type PlanSlot,
  type PrimaryMealSlot,
  slotCalorieShare,
  slotsForMode,
} from "@/lib/nutrition-constructor/config";
import {
  buildIngredientLine,
  buildMealPlanItem,
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  d,
  displayMacro,
  macroDiff,
  snapshotMacro,
  sumMacros,
  withinTolerance,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import { NUT_SEED_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import type {
  ConstructorDay,
  FoodProduct,
  GenerateConstructorPlanInput,
  PlanValidationResult,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";

export type OptimizerContext = {
  products: Map<string, FoodProduct>;
  recipes: Recipe[];
  recipeIngredients: Map<string, RecipeIngredient[]>;
  mainRecipes: Recipe[];
  snackRecipes: Recipe[];
};

function deviationScore(actual: MacroBreakdown, target: MacroBreakdown): number {
  const diff = macroDiff(actual, target);
  return (
    diff.kcal.abs().toNumber() * 10 +
    diff.protein_g.abs().toNumber() * 8 +
    diff.fat_g.abs().toNumber() * 8 +
    diff.carbs_g.abs().toNumber() * 8
  );
}

function initialGrams(ri: RecipeIngredient): number {
  if (ri.default_g != null) return ri.default_g;
  return Math.round((ri.min_g + ri.max_g) / 2);
}

function optimizeMealIngredients(
  ings: RecipeIngredient[],
  products: Map<string, FoodProduct>,
  slotTargetKcal: number,
  maxShareOfDay?: number,
  dayTargetKcal?: number,
): { lines: ReturnType<typeof buildIngredientLine>[]; totals: MacroBreakdown } {
  const grams = ings.map((ri) => initialGrams(ri));
  const maxKcal =
    maxShareOfDay != null && dayTargetKcal != null ? dayTargetKcal * maxShareOfDay : undefined;

  const build = () => {
    const lines = ings.map((ri, idx) => {
      const p = products.get(ri.product_id)!;
      return buildIngredientLine(p, grams[idx], idx);
    });
    return { lines, totals: mealTotalsFromIngredients(lines) };
  };

  let { lines, totals } = build();
  const target = { ...totals, kcal: d(slotTargetKcal) };

  for (let pass = 0; pass < 120; pass++) {
    let improved = false;
    for (let i = 0; i < ings.length; i++) {
      const ri = ings[i];
      if (!ri.is_scalable) continue;
      for (const delta of [GRAM_STEP, -GRAM_STEP]) {
        const next = grams[i] + delta;
        if (next < ri.min_g || next > ri.max_g) continue;
        const prev = grams[i];
        grams[i] = next;
        const candidate = build();
        if (maxKcal != null && candidate.totals.kcal.toNumber() > maxKcal + 5) {
          grams[i] = prev;
          continue;
        }
        const prevScore =
          deviationScore(totals, target) + Math.abs(totals.kcal.toNumber() - slotTargetKcal) * 5;
        const nextScore =
          deviationScore(candidate.totals, target) +
          Math.abs(candidate.totals.kcal.toNumber() - slotTargetKcal) * 5;
        if (nextScore < prevScore) {
          lines = candidate.lines;
          totals = candidate.totals;
          improved = true;
        } else {
          grams[i] = prev;
        }
      }
    }
    if (!improved) break;
  }

  return { lines, totals };
}

function verifiedIngredients(
  ctx: OptimizerContext,
  recipe: Recipe,
  excluded: Set<string>,
): RecipeIngredient[] {
  return (ctx.recipeIngredients.get(recipe.id) ?? []).filter((ri) => {
    const p = ctx.products.get(ri.product_id);
    return p && p.is_active && p.is_verified && !excluded.has(p.id);
  });
}

function isNutHeavyRecipe(ctx: OptimizerContext, recipe: Recipe): boolean {
  const ings = ctx.recipeIngredients.get(recipe.id) ?? [];
  const nutSlugs = ings.filter((ri) => {
    const p = ctx.products.get(ri.product_id);
    return p && NUT_SEED_PRODUCT_SLUGS.has(p.slug);
  });
  return (
    nutSlugs.length >= 2 ||
    (recipe.meal_type === "snack" && nutSlugs.length === 1 && ings.length <= 2)
  );
}

function snacksForMode(ctx: OptimizerContext, mode: MealScheduleMode): Recipe[] {
  return ctx.snackRecipes.filter(
    (r) =>
      r.is_active &&
      r.allowed_schedule_modes.includes(mode) &&
      (mode === "two_main_two_snacks" || (!r.is_treat && r.is_nutrient_dense)),
  );
}

function snackTripletValid(ctx: OptimizerContext, picks: Recipe[]): boolean {
  if (picks.length !== 3) return false;
  const ids = new Set(picks.map((p) => p.id));
  if (ids.size !== 3) return false;
  if (picks.some((p) => p.is_treat)) return false;
  if (!picks.every((p) => p.is_nutrient_dense && !p.requires_cooking)) return false;
  if (!picks.some((p) => p.contains_protein_source)) return false;
  if (!picks.some((p) => p.contains_fruit_or_vegetable)) return false;
  const nutHeavy = picks.filter((p) => isNutHeavyRecipe(ctx, p)).length;
  if (nutHeavy > 1) return false;
  const fruitOnly = picks.filter(
    (p) => p.contains_fruit_or_vegetable && !p.contains_protein_source,
  ).length;
  if (fruitOnly >= 3) return false;
  return true;
}

function pickSnackTriplet(
  ctx: OptimizerContext,
  mode: MealScheduleMode,
  dayIndex: number,
): [Recipe, Recipe, Recipe] | null {
  const pool = snacksForMode(ctx, mode).filter(
    (r) => verifiedIngredients(ctx, r, new Set()).length > 0,
  );
  if (pool.length < 3) return null;

  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      for (let c = b + 1; c < pool.length; c++) {
        const triplet = [
          pool[(a + dayIndex) % pool.length]!,
          pool[(b + dayIndex) % pool.length]!,
          pool[(c + dayIndex) % pool.length]!,
        ];
        const unique = [...new Set(triplet.map((x) => x.id))];
        if (unique.length !== 3) continue;
        if (snackTripletValid(ctx, triplet)) return triplet as [Recipe, Recipe, Recipe];
      }
    }
  }

  for (let i = 0; i < pool.length - 2; i++) {
    for (let j = i + 1; j < pool.length - 1; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const triplet = [pool[i]!, pool[j]!, pool[k]!];
        if (snackTripletValid(ctx, triplet)) return triplet as [Recipe, Recipe, Recipe];
      }
    }
  }
  return null;
}

function pickRecipesForDayTwoMain(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
): { main1: Recipe; main2: Recipe; snack1: Recipe; snack2: Recipe } | null {
  const mains = ctx.mainRecipes.filter((r) => r.is_active);
  const snacks = snacksForMode(ctx, "two_main_two_snacks");
  if (mains.length < 2 || snacks.length < 2) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 2 ? mainCandidates : mains;

  const main1 = mainPool[dayIndex % mainPool.length]!;
  let main2 = mainPool[(dayIndex + 1) % mainPool.length]!;
  if (main1.id === main2.id && mainPool.length > 1) {
    main2 = mainPool[(dayIndex + 2) % mainPool.length]!;
  }

  const snack1 = snacks[dayIndex % snacks.length]!;
  let snack2 = snacks[(dayIndex + 1) % snacks.length]!;
  if (snack2.id === snack1.id) snack2 = snacks[(dayIndex + 2) % snacks.length]!;

  return { main1, main2, snack1, snack2 };
}

function pickRecipesForDayOneMain(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
): { main1: Recipe; snack1: Recipe; snack2: Recipe; snack3: Recipe } | null {
  const mains = ctx.mainRecipes.filter((r) => r.is_active);
  if (mains.length < 1) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 1 ? mainCandidates : mains;
  const main1 = mainPool[dayIndex % mainPool.length]!;

  const triplet = pickSnackTriplet(ctx, "one_main_three_snacks", dayIndex);
  if (!triplet) return null;

  return { main1, snack1: triplet[0], snack2: triplet[1], snack3: triplet[2] };
}

function buildDay(
  ctx: OptimizerContext,
  dayIndex: number,
  targets: MacroBreakdown,
  recentMain: Map<string, number>,
  excluded: Set<string>,
  mode: MealScheduleMode,
): ConstructorDay | null {
  const slots = slotsForMode(mode);
  const shares = slotCalorieShare(mode);
  const dayKcal = targets.kcal.toNumber();

  let slotRecipes: Partial<Record<PlanSlot, Recipe>>;

  if (mode === "two_main_two_snacks") {
    const picks = pickRecipesForDayTwoMain(ctx, dayIndex, recentMain);
    if (!picks) return null;
    slotRecipes = {
      main1: picks.main1,
      snack1: picks.snack1,
      main2: picks.main2,
      snack2: picks.snack2,
    };
    recentMain.set(picks.main1.id, dayIndex);
    recentMain.set(picks.main2.id, dayIndex);
  } else {
    const picks = pickRecipesForDayOneMain(ctx, dayIndex, recentMain);
    if (!picks) return null;
    slotRecipes = {
      main1: picks.main1,
      snack1: picks.snack1,
      snack2: picks.snack2,
      snack3: picks.snack3,
    };
    recentMain.set(picks.main1.id, dayIndex);
  }

  const items = slots
    .map((slot) => {
      const recipe = slotRecipes[slot];
      if (!recipe) return null;
      const ings = verifiedIngredients(ctx, recipe, excluded);
      if (ings.length === 0) return null;
      const slotTargetKcal = targets.kcal.mul(shares[slot]).toNumber();
      const isMain = slot.startsWith("main");
      const { lines } = optimizeMealIngredients(
        ings,
        ctx.products,
        slotTargetKcal,
        isMain && mode === "one_main_three_snacks" ? 0.55 : undefined,
        isMain && mode === "one_main_three_snacks" ? dayKcal : undefined,
      );
      return buildMealPlanItem({ slot, recipe, ingredients: lines });
    })
    .filter(Boolean) as ReturnType<typeof buildMealPlanItem>[];

  if (items.length !== slots.length) return null;

  const dayTotals = sumMacros(
    items.map((i) => ({
      kcal: d(i.kcal),
      protein_g: d(i.protein_g),
      fat_g: d(i.fat_g),
      carbs_g: d(i.carbs_g),
      fiber_g: d(i.fiber_g),
    })),
  );

  for (let step = 0; step < 200; step++) {
    if (withinTolerance(dayTotals, targets, DEFAULT_TOLERANCE)) break;
    let moved = false;
    for (const item of items) {
      if (!item.requires_cooking) continue;
      for (const ing of item.ingredients) {
        for (const delta of [GRAM_STEP, -GRAM_STEP]) {
          const prevG = d(ing.grams).toNumber();
          const nextG = prevG + delta;
          if (nextG < 20 || nextG > 600) continue;
          const product = ctx.products.get(ing.product_id);
          if (!product) continue;
          const newLine = buildIngredientLine(product, nextG, ing.sort_order);
          const newItems = items.map((it) => {
            if (it.slot !== item.slot) return it;
            const newIngs = it.ingredients.map((x) =>
              x.product_id === ing.product_id ? newLine : x,
            );
            const recipe = ctx.recipes.find((r) => r.id === it.recipe_id)!;
            return buildMealPlanItem({ slot: it.slot, recipe, ingredients: newIngs });
          });
          const newDayTotals = sumMacros(
            newItems.map((i) => ({
              kcal: d(i.kcal),
              protein_g: d(i.protein_g),
              fat_g: d(i.fat_g),
              carbs_g: d(i.carbs_g),
              fiber_g: d(i.fiber_g),
            })),
          );
          if (deviationScore(newDayTotals, targets) < deviationScore(dayTotals, targets)) {
            const idx = items.findIndex((x) => x.slot === item.slot);
            items[idx] = newItems.find((x) => x.slot === item.slot)!;
            Object.assign(dayTotals, newDayTotals);
            moved = true;
            break;
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }

  const snap = snapshotMacro(dayTotals);
  const valid = withinTolerance(dayTotals, targets, DEFAULT_TOLERANCE);

  return {
    day_index: dayIndex,
    day_note: null,
    items,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
    is_valid: valid,
  };
}

export function generateConstructorPlan(
  ctx: OptimizerContext,
  input: GenerateConstructorPlanInput,
): PlanValidationResult {
  const excluded = new Set(input.excluded_product_ids);
  const recentMain = new Map<string, number>();
  const days: ConstructorDay[] = [];
  const mode = input.meal_schedule_mode;
  const failMessage =
    mode === "one_main_three_snacks"
      ? ONE_MAIN_UNACHIEVABLE_MESSAGE
      : "Не удалось собрать рацион в заданных пределах из выбранных продуктов. Измените целевые показатели, разрешённые продукты или диапазон порций.";

  for (let i = 0; i < input.days_count; i++) {
    const day = buildDay(ctx, i, input.targets, recentMain, excluded, mode);
    if (!day) {
      return { is_valid: false, message: failMessage, comparison: [], days: [] };
    }
    days.push(day);
  }

  const allValid = days.every((dayRow) => dayRow.is_valid);
  const avgTotals = sumMacros(
    days.map((dayRow) => ({
      kcal: d(dayRow.kcal),
      protein_g: d(dayRow.protein_g),
      fat_g: d(dayRow.fat_g),
      carbs_g: d(dayRow.carbs_g),
      fiber_g: d(dayRow.fiber_g),
    })),
  );
  const avg = {
    kcal: avgTotals.kcal.div(days.length),
    protein_g: avgTotals.protein_g.div(days.length),
    fat_g: avgTotals.fat_g.div(days.length),
    carbs_g: avgTotals.carbs_g.div(days.length),
    fiber_g: avgTotals.fiber_g.div(days.length),
  };

  const comparison = [
    {
      label: "Калории",
      target: displayMacro(input.targets).kcal,
      actual: displayMacro(avg).kcal,
      diff: displayMacro(avg).kcal - displayMacro(input.targets).kcal,
    },
    {
      label: "Белки",
      target: displayMacro(input.targets).protein_g,
      actual: displayMacro(avg).protein_g,
      diff: displayMacro(avg).protein_g - displayMacro(input.targets).protein_g,
    },
    {
      label: "Жиры",
      target: displayMacro(input.targets).fat_g,
      actual: displayMacro(avg).fat_g,
      diff: displayMacro(avg).fat_g - displayMacro(input.targets).fat_g,
    },
    {
      label: "Углеводы",
      target: displayMacro(input.targets).carbs_g,
      actual: displayMacro(avg).carbs_g,
      diff: displayMacro(avg).carbs_g - displayMacro(input.targets).carbs_g,
    },
  ];

  const valid = allValid && withinTolerance(avg, input.targets, input.tolerance);

  return {
    is_valid: valid,
    message: valid ? null : failMessage,
    comparison,
    days,
    best_approximation: valid ? undefined : { days, comparison },
  };
}

export type { PrimaryMealSlot };
