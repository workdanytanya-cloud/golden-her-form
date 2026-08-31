import {
  DEFAULT_TOLERANCE,
  GRAM_STEP,
  MAIN_RECIPE_REPEAT_DAYS,
  ONE_MAIN_TOLERANCE,
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
import { buildPlanValidationMessage } from "@/lib/nutrition-constructor/validation-messages";
import {
  macroDeviationScore,
  macroPriorities,
  pickBestRecipe,
  scoreRecipeForSlot,
  slotMacroTargets,
  pickTopProteinMains,
  isProteinRichRecipe,
  verifiedIngredients,
  type MacroPriorities,
} from "@/lib/nutrition-constructor/recipe-selection";

export type OptimizerContext = {
  products: Map<string, FoodProduct>;
  recipes: Recipe[];
  recipeIngredients: Map<string, RecipeIngredient[]>;
  mainRecipes: Recipe[];
  snackRecipes: Recipe[];
};

function deviationScore(
  actual: MacroBreakdown,
  target: MacroBreakdown,
  priorities?: MacroPriorities,
): number {
  return macroDeviationScore(actual, target, priorities);
}

function initialGrams(ri: RecipeIngredient): number {
  if (ri.default_g != null) return ri.default_g;
  return Math.round((ri.min_g + ri.max_g) / 2);
}

function optimizeMealIngredients(
  ings: RecipeIngredient[],
  products: Map<string, FoodProduct>,
  slotTargets: MacroBreakdown,
  priorities: MacroPriorities,
  maxShareOfDay?: number,
  dayTargetKcal?: number,
): { lines: ReturnType<typeof buildIngredientLine>[]; totals: MacroBreakdown } {
  const grams = ings.map((ri) => initialGrams(ri));
  const slotTargetKcal = slotTargets.kcal.toNumber();
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
  const target = slotTargets;

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
          deviationScore(totals, target, priorities) +
          Math.abs(totals.kcal.toNumber() - slotTargetKcal) * 5;
        const nextScore =
          deviationScore(candidate.totals, target, priorities) +
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
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
): [Recipe, Recipe, Recipe] | null {
  const pool = snacksForMode(ctx, mode).filter(
    (r) => verifiedIngredients(ctx, r, excluded).length > 0,
  );
  if (pool.length < 3) return null;

  const snackSlots: PlanSlot[] = ["snack1", "snack2", "snack3"];
  let best: { triplet: [Recipe, Recipe, Recipe]; score: number } | null = null;

  for (let i = 0; i < pool.length - 2; i++) {
    for (let j = i + 1; j < pool.length - 1; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const triplet = [pool[i]!, pool[j]!, pool[k]!] as [Recipe, Recipe, Recipe];
        if (!snackTripletValid(ctx, triplet)) continue;
        const score = triplet.reduce((sum, recipe, idx) => {
          const slot = snackSlots[idx]!;
          const slotTargets = slotMacroTargets(targets, shares[slot]);
          return (
            sum +
            scoreRecipeForSlot(ctx, recipe, slotTargets, excluded, priorities, "snack")
          );
        }, 0);
        if (!best || score < best.score) best = { triplet, score };
      }
    }
  }

  return best?.triplet ?? null;
}

function pickRecipesForDayTwoMain(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
): { main1: Recipe; main2: Recipe; snack1: Recipe; snack2: Recipe } | null {
  const mains = ctx.mainRecipes.filter((r) => r.is_active);
  const snacks = snacksForMode(ctx, "two_main_two_snacks");
  if (mains.length < 2 || snacks.length < 2) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 2 ? mainCandidates : mains;

  const main1Targets = slotMacroTargets(targets, shares.main1);
  const main2Targets = slotMacroTargets(targets, shares.main2);
  const snack1Targets = slotMacroTargets(targets, shares.snack1);
  const snack2Targets = slotMacroTargets(targets, shares.snack2);

  let main1: Recipe;
  let resolvedMain2: Recipe;

  const snack1 =
    pickBestRecipe(snacks, ctx, snack1Targets, excluded, priorities, "snack", dayIndex) ??
    snacks[dayIndex % snacks.length]!;
  const snack2 =
    pickBestRecipe(
      snacks,
      ctx,
      snack2Targets,
      excluded,
      priorities,
      "snack",
      dayIndex + 1,
      new Set([snack1.id]),
    ) ?? snacks[(dayIndex + 1) % snacks.length]!;

  if (priorities.proteinFocused && priorities.lowCarb) {
    const proteinMains = pickTopProteinMains(mainPool, ctx, excluded, 6);
    const pairPool =
      proteinMains.length >= 2
        ? proteinMains
        : mainPool.filter((r) => isProteinRichRecipe(ctx, r));
    let bestPair: { main1: Recipe; main2: Recipe; score: number } | null = null;

    for (let i = 0; i < pairPool.length; i++) {
      for (let j = i + 1; j < pairPool.length; j++) {
        const candidate = assembleAndTuneDay(
          ctx,
          targets,
          shares,
          excluded,
          "two_main_two_snacks",
          priorities,
          {
            main1: pairPool[i]!,
            snack1,
            main2: pairPool[j]!,
            snack2,
          },
          180,
        );
        if (!candidate) continue;
        const score = deviationScore(
          {
            kcal: d(candidate.kcal),
            protein_g: d(candidate.protein_g),
            fat_g: d(candidate.fat_g),
            carbs_g: d(candidate.carbs_g),
            fiber_g: d(candidate.fiber_g),
          },
          targets,
          priorities,
        );
        if (!bestPair || score < bestPair.score) {
          bestPair = { main1: pairPool[i]!, main2: pairPool[j]!, score };
        }
      }
    }

    if (bestPair) {
      return { main1: bestPair.main1, main2: bestPair.main2, snack1, snack2 };
    }
  }

  main1 =
    pickBestRecipe(mainPool, ctx, main1Targets, excluded, priorities, "main", dayIndex) ??
    mainPool[dayIndex % mainPool.length]!;
  const main2 =
    pickBestRecipe(
      mainPool,
      ctx,
      main2Targets,
      excluded,
      priorities,
      "main",
      dayIndex + 1,
      new Set([main1.id]),
    ) ?? mainPool[(dayIndex + 1) % mainPool.length]!;
  resolvedMain2 =
    main2.id === main1.id && mainPool.length > 1
      ? mainPool[(dayIndex + 2) % mainPool.length]!
      : main2;

  return { main1, main2: resolvedMain2, snack1, snack2 };
}

function pickRecipesForDayOneMain(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
): { main1: Recipe; snack1: Recipe; snack2: Recipe; snack3: Recipe } | null {
  const mains = ctx.mainRecipes.filter((r) => r.is_active);
  if (mains.length < 1) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 1 ? mainCandidates : mains;
  const main1Targets = slotMacroTargets(targets, shares.main1);
  const main1 =
    pickBestRecipe(mainPool, ctx, main1Targets, excluded, priorities, "main", dayIndex) ??
    mainPool[dayIndex % mainPool.length]!;

  const triplet = pickSnackTriplet(ctx, "one_main_three_snacks", dayIndex, targets, shares, excluded, priorities);
  if (!triplet) return null;

  return { main1, snack1: triplet[0], snack2: triplet[1], snack3: triplet[2] };
}

function ingredientGramBounds(
  ctx: OptimizerContext,
  recipeId: string,
  productId: string,
): { min: number; max: number } {
  const ings = ctx.recipeIngredients.get(recipeId) ?? [];
  const ri = ings.find((x) => x.product_id === productId);
  if (ri) return { min: ri.min_g, max: ri.max_g };
  return { min: 20, max: 600 };
}

function assembleAndTuneDay(
  ctx: OptimizerContext,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  mode: MealScheduleMode,
  priorities: MacroPriorities,
  slotRecipes: Partial<Record<PlanSlot, Recipe>>,
  tuneSteps?: number,
): Omit<ConstructorDay, "day_index" | "day_note"> | null {
  const slots = slotsForMode(mode);
  const dayKcal = targets.kcal.toNumber();

  const items = slots
    .map((slot) => {
      const recipe = slotRecipes[slot];
      if (!recipe) return null;
      const ings = verifiedIngredients(ctx, recipe, excluded);
      if (ings.length === 0) return null;
      const slotTargets = slotMacroTargets(targets, shares[slot]);
      const isMain = slot.startsWith("main");
      const { lines } = optimizeMealIngredients(
        ings,
        ctx.products,
        slotTargets,
        priorities,
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

  const maxTuneSteps =
    tuneSteps ??
    (mode === "one_main_three_snacks" ? 400 : priorities.proteinFocused ? 350 : 200);
  for (let step = 0; step < maxTuneSteps; step++) {
    const dayTolerance = mode === "one_main_three_snacks" ? ONE_MAIN_TOLERANCE : DEFAULT_TOLERANCE;
    if (withinTolerance(dayTotals, targets, dayTolerance)) break;
    let moved = false;
    for (const item of items) {
      for (const ing of item.ingredients) {
        for (const delta of [GRAM_STEP, -GRAM_STEP]) {
          const prevG = d(ing.grams).toNumber();
          const nextG = prevG + delta;
          const bounds = ingredientGramBounds(ctx, item.recipe_id, ing.product_id);
          if (nextG < bounds.min || nextG > bounds.max) continue;
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
          if (
            deviationScore(newDayTotals, targets, priorities) <
            deviationScore(dayTotals, targets, priorities)
          ) {
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
  const dayTolerance = mode === "one_main_three_snacks" ? ONE_MAIN_TOLERANCE : DEFAULT_TOLERANCE;
  const valid = withinTolerance(dayTotals, targets, dayTolerance);

  return {
    items,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
    is_valid: valid,
  };
}

function buildDay(
  ctx: OptimizerContext,
  dayIndex: number,
  targets: MacroBreakdown,
  recentMain: Map<string, number>,
  excluded: Set<string>,
  mode: MealScheduleMode,
): ConstructorDay | null {
  const shares = slotCalorieShare(mode);
  const priorities = macroPriorities(targets);

  let slotRecipes: Partial<Record<PlanSlot, Recipe>>;

  if (mode === "two_main_two_snacks") {
    const picks = pickRecipesForDayTwoMain(
      ctx,
      dayIndex,
      recentMain,
      targets,
      shares,
      excluded,
      priorities,
    );
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
    const picks = pickRecipesForDayOneMain(
      ctx,
      dayIndex,
      recentMain,
      targets,
      shares,
      excluded,
      priorities,
    );
    if (!picks) return null;
    slotRecipes = {
      main1: picks.main1,
      snack1: picks.snack1,
      snack2: picks.snack2,
      snack3: picks.snack3,
    };
    recentMain.set(picks.main1.id, dayIndex);
  }

  const assembled = assembleAndTuneDay(
    ctx,
    targets,
    shares,
    excluded,
    mode,
    priorities,
    slotRecipes,
  );
  if (!assembled) return null;

  return {
    day_index: dayIndex,
    day_note: null,
    ...assembled,
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
  const tolerance =
    mode === "one_main_three_snacks"
      ? { ...input.tolerance, ...ONE_MAIN_TOLERANCE }
      : input.tolerance;
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
  const invalidDayCount = days.filter((dayRow) => !dayRow.is_valid).length;
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

  const avgValid = withinTolerance(avg, input.targets, tolerance);
  const allowedBadDays =
    mode === "one_main_three_snacks" ? Math.max(1, Math.floor(days.length * 0.15)) : 0;
  const kbjuAcceptable =
    avgValid &&
    (mode === "one_main_three_snacks"
      ? invalidDayCount <= allowedBadDays
      : allValid);
  const structureValid = days.every((dayRow) => {
    const mains = dayRow.items.filter((i) => i.slot.startsWith("main")).length;
    const snacks = dayRow.items.filter((i) => i.slot.startsWith("snack")).length;
    if (mode === "two_main_two_snacks") return mains === 2 && snacks === 2;
    return mains === 1 && snacks === 3;
  });
  const valid =
    kbjuAcceptable || (mode === "one_main_three_snacks" && structureValid && days.length > 0);

  return {
    is_valid: valid,
    kbju_acceptable: kbjuAcceptable,
    message: valid
      ? null
      : buildPlanValidationMessage({
          comparison,
          tolerance,
          hasDays: days.length > 0,
          failMessage,
          invalidDayCount,
          totalDays: days.length,
        }),
    comparison,
    days,
    best_approximation: valid ? undefined : { days, comparison },
  };
}

export type { PrimaryMealSlot };
