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
  searchValidDayCombo,
  type ComboSearchDiagnostics,
} from "@/lib/nutrition-constructor/day-combo-search";
import { solveDayMacros } from "@/lib/nutrition-constructor/macro-solver";
import {
  balancedMacroDeviationScore,
  enrichMainIngredientsWithOil,
  tuneDayToTargets,
  type DayBalanceContext,
} from "@/lib/nutrition-constructor/day-balance";
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
import {
  constructorDaysHaveInvalidGrams,
  finalizeConstructorPlanDays,
  INVALID_INGREDIENT_GRAMS_MESSAGE,
} from "@/lib/nutrition-constructor/ingredient-normalize";
import { buildPlanValidationMessage } from "@/lib/nutrition-constructor/validation-messages";
import {
  isAutoGenerationEligible,
  macroPriorities,
  pickBestRecipe,
  scoreRecipeForSlot,
  slotMacroTargets,
  pickTopProteinMains,
  isProteinRichRecipe,
  verifiedIngredients,
  type MacroPriorities,
} from "@/lib/nutrition-constructor/recipe-selection";
import {
  UNIQUE_WEEK_TARGET,
  WEEK_SEARCH_BUDGET_MS,
  arrangeBestWeekCycle,
  makeComboReject,
  shouldUseWeekTiling,
  tileConstructorWeek,
} from "@/lib/nutrition-constructor/week-cycle";

export type OptimizerContext = {
  products: Map<string, FoodProduct>;
  recipes: Recipe[];
  recipeIngredients: Map<string, RecipeIngredient[]>;
  mainRecipes: Recipe[];
  snackRecipes: Recipe[];
};

function toDayBalanceCtx(ctx: OptimizerContext): DayBalanceContext {
  return {
    products: ctx.products,
    recipeIngredients: ctx.recipeIngredients,
    recipes: ctx.recipes,
  };
}

function deviationScore(
  actual: MacroBreakdown,
  target: MacroBreakdown,
  priorities?: MacroPriorities,
): number {
  return balancedMacroDeviationScore(actual, target, priorities);
}

function eligibleMains(ctx: OptimizerContext, mode: MealScheduleMode): Recipe[] {
  return ctx.mainRecipes.filter(
    (r) => r.is_active && r.allowed_schedule_modes.includes(mode) && isAutoGenerationEligible(r),
  );
}

function initialGrams(ri: RecipeIngredient): number {
  if (ri.default_g != null) return ri.default_g;
  return Math.round((ri.min_g + ri.max_g) / 2);
}

function optimizeMealQuick(
  ings: RecipeIngredient[],
  products: Map<string, FoodProduct>,
  slotTargets: MacroBreakdown,
): ReturnType<typeof buildIngredientLine>[] {
  const grams = ings.map((ri) => initialGrams(ri));
  const build = () =>
    ings.map((ri, idx) => buildIngredientLine(products.get(ri.product_id)!, grams[idx], idx));
  for (let pass = 0; pass < 80; pass++) {
    let improved = false;
    for (let i = 0; i < ings.length; i++) {
      const ri = ings[i];
      if (!ri.is_scalable) continue;
      for (const delta of [GRAM_STEP, -GRAM_STEP]) {
        const next = grams[i] + delta;
        if (next < ri.min_g || next > ri.max_g) continue;
        grams[i] = next;
        const totals = mealTotalsFromIngredients(build());
        const prev = grams[i] - delta;
        const score =
          Math.abs(totals.kcal.toNumber() - slotTargets.kcal.toNumber()) +
          Math.abs(totals.protein_g.toNumber() - slotTargets.protein_g.toNumber()) * 2;
        grams[i] = prev;
        const prevTotals = mealTotalsFromIngredients(build());
        const prevScore =
          Math.abs(prevTotals.kcal.toNumber() - slotTargets.kcal.toNumber()) +
          Math.abs(prevTotals.protein_g.toNumber() - slotTargets.protein_g.toNumber()) * 2;
        if (score < prevScore) {
          grams[i] = next;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return build();
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
      isAutoGenerationEligible(r) &&
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
          return sum + scoreRecipeForSlot(ctx, recipe, slotTargets, excluded, priorities, "snack");
        }, 0);
        if (!best || score < best.score) best = { triplet, score };
      }
    }
  }

  return best?.triplet ?? null;
}

function strictProteinSnacksForMode(ctx: OptimizerContext, mode: MealScheduleMode): Recipe[] {
  return snacksForMode(ctx, mode).filter(
    (r) => r.slug.includes("tuna") || r.slug.includes("cheese"),
  );
}

function pickRecipesForDayThreeMainTwoSnacks(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
): { main1: Recipe; main2: Recipe; main3: Recipe; snack1: Recipe; snack2: Recipe } | null {
  const mains = eligibleMains(ctx, "three_main_two_snacks");
  const snacksRaw = snacksForMode(ctx, "three_main_two_snacks");
  const snacks =
    priorities.strictHighProtein &&
    strictProteinSnacksForMode(ctx, "three_main_two_snacks").length >= 2
      ? strictProteinSnacksForMode(ctx, "three_main_two_snacks")
      : snacksRaw;
  if (mains.length < 3 || snacks.length < 2) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 3 ? mainCandidates : mains;

  const snack1 =
    pickBestRecipe(
      snacks,
      ctx,
      slotMacroTargets(targets, shares.snack1),
      excluded,
      priorities,
      "snack",
      dayIndex,
    ) ?? snacks[dayIndex % snacks.length]!;
  const snack2 =
    pickBestRecipe(
      snacks,
      ctx,
      slotMacroTargets(targets, shares.snack2),
      excluded,
      priorities,
      "snack",
      dayIndex + 1,
      new Set([snack1.id]),
    ) ?? snacks[(dayIndex + 1) % snacks.length]!;

  const main1 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main1),
      excluded,
      priorities,
      "main",
      dayIndex,
    ) ?? mainPool[dayIndex % mainPool.length]!;
  const main2 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main2),
      excluded,
      priorities,
      "main",
      dayIndex + 1,
      new Set([main1.id]),
    ) ?? mainPool[(dayIndex + 1) % mainPool.length]!;
  const main3 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main3),
      excluded,
      priorities,
      "main",
      dayIndex + 2,
      new Set([main1.id, main2.id]),
    ) ?? mainPool[(dayIndex + 2) % mainPool.length]!;

  return { main1, main2, main3, snack1, snack2 };
}

function pickRecipesForDayThreeMainsOnly(
  ctx: OptimizerContext,
  dayIndex: number,
  recentMain: Map<string, number>,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
): { main1: Recipe; main2: Recipe; main3: Recipe } | null {
  const mains = eligibleMains(ctx, "three_mains_only");
  if (mains.length < 3) return null;

  const mainCandidates = mains.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  const mainPool = mainCandidates.length >= 3 ? mainCandidates : mains;

  const main1 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main1),
      excluded,
      priorities,
      "main",
      dayIndex,
    ) ?? mainPool[dayIndex % mainPool.length]!;
  const main2 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main2),
      excluded,
      priorities,
      "main",
      dayIndex + 1,
      new Set([main1.id]),
    ) ?? mainPool[(dayIndex + 1) % mainPool.length]!;
  const main3 =
    pickBestRecipe(
      mainPool,
      ctx,
      slotMacroTargets(targets, shares.main3),
      excluded,
      priorities,
      "main",
      dayIndex + 2,
      new Set([main1.id, main2.id]),
    ) ?? mainPool[(dayIndex + 2) % mainPool.length]!;

  return { main1, main2, main3 };
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
  const mains = eligibleMains(ctx, "two_main_two_snacks");
  const snacksRaw = snacksForMode(ctx, "two_main_two_snacks");
  const snacks =
    priorities.strictHighProtein &&
    strictProteinSnacksForMode(ctx, "two_main_two_snacks").length >= 2
      ? strictProteinSnacksForMode(ctx, "two_main_two_snacks")
      : snacksRaw;
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

  if (priorities.proteinFocused) {
    const proteinMains = pickTopProteinMains(mainPool, ctx, excluded, 8);
    const pairPool =
      proteinMains.length >= 2 ? proteinMains : mainPool.filter((r) => isProteinRichRecipe(ctx, r));
    const snackPairs: Array<[Recipe, Recipe]> = [];
    for (let a = 0; a < snacks.length; a++) {
      for (let b = 0; b < snacks.length; b++) {
        if (a === b) continue;
        if (priorities.strictHighProtein) {
          if (!snacks[a]!.slug.includes("tuna") && !snacks[a]!.slug.includes("cheese")) continue;
          if (!snacks[b]!.slug.includes("tuna") && !snacks[b]!.slug.includes("cheese")) continue;
        }
        snackPairs.push([snacks[a]!, snacks[b]!]);
        if (snackPairs.length >= 24) break;
      }
      if (snackPairs.length >= 24) break;
    }
    const snackPairList =
      snackPairs.length > 0 ? snackPairs : ([[snack1, snack2]] as Array<[Recipe, Recipe]>);

    let bestPair: {
      main1: Recipe;
      main2: Recipe;
      snack1: Recipe;
      snack2: Recipe;
      score: number;
    } | null = null;
    let attempts = 0;
    const maxAttempts = priorities.strictHighProtein ? 120 : 60;

    outer: for (let i = 0; i < pairPool.length; i++) {
      for (let j = i + 1; j < pairPool.length; j++) {
        for (const [s1, s2] of snackPairList) {
          if (++attempts > maxAttempts) break outer;
          const candidate = assembleAndTuneDay(
            ctx,
            targets,
            shares,
            excluded,
            "two_main_two_snacks",
            priorities,
            {
              main1: pairPool[i]!,
              snack1: s1,
              main2: pairPool[j]!,
              snack2: s2,
            },
          );
          if (!candidate) continue;
          if (candidate.is_valid) {
            return { main1: pairPool[i]!, main2: pairPool[j]!, snack1: s1, snack2: s2 };
          }
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
            bestPair = {
              main1: pairPool[i]!,
              main2: pairPool[j]!,
              snack1: s1,
              snack2: s2,
              score,
            };
          }
        }
      }
    }

    if (bestPair) {
      return {
        main1: bestPair.main1,
        main2: bestPair.main2,
        snack1: bestPair.snack1,
        snack2: bestPair.snack2,
      };
    }
  }

  const main1 =
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
  const resolvedMain2 =
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
  const mains = eligibleMains(ctx, "one_main_three_snacks");
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

  const triplet = pickSnackTriplet(
    ctx,
    "one_main_three_snacks",
    dayIndex,
    targets,
    shares,
    excluded,
    priorities,
  );
  if (!triplet) return null;

  return { main1, snack1: triplet[0], snack2: triplet[1], snack3: triplet[2] };
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
  options?: { searchPhase?: boolean },
): Omit<ConstructorDay, "day_index" | "day_note"> | null {
  const slots = slotsForMode(mode);
  const dayKcal = targets.kcal.toNumber();
  const dayCtx = toDayBalanceCtx(ctx);

  const items = slots
    .map((slot) => {
      const recipe = slotRecipes[slot];
      if (!recipe) return null;
      let ings = verifiedIngredients(ctx, recipe, excluded);
      if (ings.length === 0) return null;
      if (
        slot.startsWith("main") &&
        (priorities.lowCarb || (priorities.proteinFocused && !priorities.strictHighProtein))
      ) {
        ings = enrichMainIngredientsWithOil(dayCtx, recipe, ings, excluded);
      }
      const slotTargets = slotMacroTargets(targets, shares[slot]);
      const isMain = slot.startsWith("main");
      // Quick path only for strict high-protein (e.g. 1313): optimizes kcal+protein only.
      // Standard proteinFocused (e.g. 1800) needs full optimizeMealIngredients for carbs/fat.
      const useQuickMealOpt = priorities.strictHighProtein && mode !== "three_mains_only";
      let lines: ReturnType<typeof buildIngredientLine>[];
      if (useQuickMealOpt) {
        lines = optimizeMealQuick(ings, ctx.products, slotTargets);
      } else {
        ({ lines } = optimizeMealIngredients(
          ings,
          ctx.products,
          slotTargets,
          priorities,
          isMain && mode === "one_main_three_snacks" ? 0.55 : undefined,
          isMain && mode === "one_main_three_snacks" ? dayKcal : undefined,
        ));
      }
      return buildMealPlanItem({ slot, recipe, ingredients: lines });
    })
    .filter(Boolean) as ReturnType<typeof buildMealPlanItem>[];

  if (items.length !== slots.length) return null;

  const searchPhase = options?.searchPhase ?? false;
  const tuneMax = tuneSteps ?? (searchPhase ? 350 : 2000);

  const tuned = tuneDayToTargets({
    ctx: dayCtx,
    items,
    targets,
    tolerance: DEFAULT_TOLERANCE,
    maxSteps: tuneMax,
    priorities,
  });

  const solved = solveDayMacros({
    ctx: dayCtx,
    items: tuned.items,
    targets,
    tolerance: DEFAULT_TOLERANCE,
    maxIterations: searchPhase ? 200 : 2500,
    enableFinishing: !searchPhase,
  });

  const snap = snapshotMacro(solved.totals);

  return {
    items: solved.items,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
    is_valid: solved.valid,
  };
}

function pickSlotRecipesForMode(
  ctx: OptimizerContext,
  mode: MealScheduleMode,
  dayIndex: number,
  recentMain: Map<string, number>,
  targets: MacroBreakdown,
  excluded: Set<string>,
  priorities: MacroPriorities,
): Partial<Record<PlanSlot, Recipe>> | null {
  const shares = slotCalorieShare(mode);
  switch (mode) {
    case "three_main_two_snacks":
      return pickRecipesForDayThreeMainTwoSnacks(
        ctx,
        dayIndex,
        recentMain,
        targets,
        shares,
        excluded,
        priorities,
      );
    case "three_mains_only":
      return pickRecipesForDayThreeMainsOnly(
        ctx,
        dayIndex,
        recentMain,
        targets,
        shares,
        excluded,
        priorities,
      );
    case "two_main_two_snacks":
      return pickRecipesForDayTwoMain(
        ctx,
        dayIndex,
        recentMain,
        targets,
        shares,
        excluded,
        priorities,
      );
    case "one_main_three_snacks":
      return pickRecipesForDayOneMain(
        ctx,
        dayIndex,
        recentMain,
        targets,
        shares,
        excluded,
        priorities,
      );
    default:
      return null;
  }
}

function finalizeBuiltDay(
  dayIndex: number,
  day: Omit<ConstructorDay, "day_index" | "day_note">,
  slotRecipes: Partial<Record<PlanSlot, Recipe>>,
  recentMain: Map<string, number>,
): ConstructorDay {
  for (const recipe of Object.values(slotRecipes)) {
    if (recipe?.meal_type === "main") {
      recentMain.set(recipe.id, dayIndex);
    }
  }
  return { day_index: dayIndex, day_note: null, ...day };
}

function buildDay(
  ctx: OptimizerContext,
  dayIndex: number,
  targets: MacroBreakdown,
  recentMain: Map<string, number>,
  excluded: Set<string>,
  mode: MealScheduleMode,
  options?: {
    timeoutMs?: number;
    comboReject?: (slotRecipes: Partial<Record<PlanSlot, Recipe>>) => boolean;
    collectUnique?: ConstructorDay[];
  },
): { day: ConstructorDay | null; diagnostics: ComboSearchDiagnostics | null } {
  const priorities = macroPriorities(targets);
  const shares = slotCalorieShare(mode);
  const mains = eligibleMains(ctx, mode);
  let snacks = priorities.strictHighProtein
    ? ctx.snackRecipes.filter(
        (r) =>
          r.is_active && r.allowed_schedule_modes.includes(mode) && isAutoGenerationEligible(r),
      )
    : snacksForMode(ctx, mode);

  if (!priorities.strictHighProtein && priorities.proteinFocused) {
    const proteinSnackPool = ctx.snackRecipes.filter(
      (r) =>
        r.is_active &&
        r.allowed_schedule_modes.includes(mode) &&
        isAutoGenerationEligible(r) &&
        (r.contains_protein_source || r.slug.includes("tuna") || r.slug.includes("cheese")),
    );
    if (proteinSnackPool.length >= 2) {
      const ids = new Set(snacks.map((r) => r.id));
      snacks = [...snacks, ...proteinSnackPool.filter((r) => !ids.has(r.id))];
    }
  }

  const assemble = (
    slotRecipes: Partial<Record<PlanSlot, Recipe>>,
    options?: { searchPhase?: boolean },
  ) =>
    assembleAndTuneDay(
      ctx,
      targets,
      shares,
      excluded,
      mode,
      priorities,
      slotRecipes,
      undefined,
      options,
    );

  const slotRecipes = pickSlotRecipesForMode(
    ctx,
    mode,
    dayIndex,
    recentMain,
    targets,
    excluded,
    priorities,
  );
  if (slotRecipes && !options?.comboReject?.(slotRecipes) && !options?.collectUnique) {
    const legacy = assemble(slotRecipes);
    if (legacy?.is_valid) {
      return {
        day: finalizeBuiltDay(dayIndex, legacy, slotRecipes, recentMain),
        diagnostics: null,
      };
    }
  }

  const search = searchValidDayCombo({
    ctx,
    mode,
    dayIndex,
    targets,
    excluded,
    recentMain,
    mains,
    snacks,
    assemble,
    timeoutMs: options?.timeoutMs,
    comboReject: options?.comboReject,
    collectValid: options?.collectUnique
      ? {
          take: (day, slotRecipesFound) => {
            options.collectUnique!.push(
              finalizeBuiltDay(options.collectUnique!.length, day, slotRecipesFound, recentMain),
            );
            return options.collectUnique!.length < UNIQUE_WEEK_TARGET;
          },
        }
      : undefined,
  });

  if (options?.collectUnique) {
    const last = options.collectUnique[options.collectUnique.length - 1] ?? null;
    return { day: last, diagnostics: search.diagnostics };
  }

  if (search.day?.is_valid && search.slotRecipes) {
    return {
      day: finalizeBuiltDay(dayIndex, search.day, search.slotRecipes, recentMain),
      diagnostics: search.diagnostics,
    };
  }

  return { day: null, diagnostics: search.diagnostics };
}

export function generateConstructorPlan(
  ctx: OptimizerContext,
  input: GenerateConstructorPlanInput,
): PlanValidationResult {
  const excluded = new Set(input.excluded_product_ids);
  const recentMain = new Map<string, number>();
  const days: ConstructorDay[] = [];
  const mode = input.meal_schedule_mode;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  let totalCombinations = 0;
  let totalElapsedMs = 0;
  let timedOut = false;
  let lastFailureReason: string | null = null;
  let uniqueWeekDays: number | undefined;
  const weekTiled = shouldUseWeekTiling(mode, input.days_count);
  const failMessage =
    mode === "one_main_three_snacks"
      ? ONE_MAIN_UNACHIEVABLE_MESSAGE
      : "Не удалось собрать рацион в заданных ограничениях. Измените целевые показатели, исключённые продукты или режим питания.";

  if (shouldUseWeekTiling(mode, input.days_count)) {
    const uniqueDays: ConstructorDay[] = [];
    const { diagnostics } = buildDay(
      ctx,
      0,
      input.targets,
      new Map<string, number>(),
      excluded,
      mode,
      {
        timeoutMs: WEEK_SEARCH_BUDGET_MS,
        comboReject: makeComboReject(uniqueDays, UNIQUE_WEEK_TARGET),
        collectUnique: uniqueDays,
      },
    );
    if (diagnostics) {
      totalCombinations += diagnostics.combinations_checked;
      totalElapsedMs += diagnostics.elapsed_ms;
      timedOut = timedOut || diagnostics.timed_out;
      if (diagnostics.last_failure_reason) {
        lastFailureReason = diagnostics.last_failure_reason;
      }
    }
    uniqueWeekDays = uniqueDays.length;
    if (uniqueDays.length === 0) {
      const infeasibleMsg = lastFailureReason
        ? `Рацион не удалось собрать: ${lastFailureReason}. Проверьте исключённые продукты или выберите другой режим.`
        : failMessage;
      return {
        is_valid: false,
        kbju_acceptable: false,
        message: diagnostics?.infeasible || diagnostics?.timed_out ? infeasibleMsg : failMessage,
        comparison: [],
        days: [],
        diagnostics: {
          combinations_checked: totalCombinations,
          elapsed_ms: totalElapsedMs,
          timed_out: timedOut,
          infeasible: true,
          last_failure_reason: lastFailureReason,
          days_with_issues: 1,
          best_recipe_slugs: diagnostics?.best_recipe_slugs ?? null,
          best_deviation_score: diagnostics?.best_deviation_score ?? null,
          unique_week_days: 0,
          week_tiled: true,
        },
      };
    }
    const arranged = arrangeBestWeekCycle(uniqueDays);
    uniqueWeekDays = arranged.length;
    days.push(...tileConstructorWeek(arranged, input.days_count));
    if (days.length !== input.days_count || days.some((dayRow) => !dayRow.is_valid)) {
      const infeasibleMsg = lastFailureReason
        ? `Рацион не удалось собрать: ${lastFailureReason}. Проверьте исключённые продукты или выберите другой режим.`
        : failMessage;
      return {
        is_valid: false,
        kbju_acceptable: false,
        message: infeasibleMsg,
        comparison: [],
        days: [],
        diagnostics: {
          combinations_checked: totalCombinations,
          elapsed_ms: totalElapsedMs,
          timed_out: timedOut,
          infeasible: true,
          last_failure_reason: lastFailureReason,
          days_with_issues: uniqueDays.length,
          unique_week_days: uniqueDays.length,
          week_tiled: true,
        },
      };
    }
  } else {
    for (let i = 0; i < input.days_count; i++) {
      const { day, diagnostics } = buildDay(ctx, i, input.targets, recentMain, excluded, mode);
      if (diagnostics) {
        totalCombinations += diagnostics.combinations_checked;
        totalElapsedMs += diagnostics.elapsed_ms;
        timedOut = timedOut || diagnostics.timed_out;
        if (diagnostics.last_failure_reason) {
          lastFailureReason = diagnostics.last_failure_reason;
        }
      }
      if (!day || !day.is_valid) {
        const infeasibleMsg = lastFailureReason
          ? `Рацион не удалось собрать: ${lastFailureReason}. Проверьте исключённые продукты или выберите другой режим.`
          : failMessage;
        return {
          is_valid: false,
          kbju_acceptable: false,
          message: diagnostics?.infeasible || diagnostics?.timed_out ? infeasibleMsg : failMessage,
          comparison: [],
          days: [],
          diagnostics: {
            combinations_checked: totalCombinations,
            elapsed_ms: totalElapsedMs,
            timed_out: timedOut,
            infeasible: true,
            last_failure_reason: lastFailureReason,
            days_with_issues: i + 1,
            best_recipe_slugs: diagnostics?.best_recipe_slugs ?? null,
            best_deviation_score: diagnostics?.best_deviation_score ?? null,
          },
        };
      }
      days.push(day);
    }
  }

  const gramsInvalid = constructorDaysHaveInvalidGrams(days);
  const finalizedDays = finalizeConstructorPlanDays(days);
  const allValid = !gramsInvalid && finalizedDays.every((dayRow) => dayRow.is_valid);
  const invalidDayCount = finalizedDays.filter((dayRow) => !dayRow.is_valid).length;
  const avgTotals = sumMacros(
    finalizedDays.map((dayRow) => ({
      kcal: d(dayRow.kcal),
      protein_g: d(dayRow.protein_g),
      fat_g: d(dayRow.fat_g),
      carbs_g: d(dayRow.carbs_g),
      fiber_g: d(dayRow.fiber_g),
    })),
  );
  const avg = {
    kcal: avgTotals.kcal.div(finalizedDays.length),
    protein_g: avgTotals.protein_g.div(finalizedDays.length),
    fat_g: avgTotals.fat_g.div(finalizedDays.length),
    carbs_g: avgTotals.carbs_g.div(finalizedDays.length),
    fiber_g: avgTotals.fiber_g.div(finalizedDays.length),
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
  const kbjuAcceptable = allValid && avgValid;
  const valid = kbjuAcceptable;

  return {
    is_valid: valid,
    kbju_acceptable: kbjuAcceptable,
    message: gramsInvalid
      ? INVALID_INGREDIENT_GRAMS_MESSAGE
      : valid
        ? null
        : buildPlanValidationMessage({
            comparison,
            tolerance,
            hasDays: finalizedDays.length > 0,
            failMessage,
            invalidDayCount,
            totalDays: finalizedDays.length,
          }),
    comparison,
    days: finalizedDays,
    best_approximation: valid ? undefined : { days: finalizedDays, comparison },
    diagnostics: {
      combinations_checked: totalCombinations,
      elapsed_ms: totalElapsedMs,
      timed_out: timedOut,
      infeasible: !valid,
      last_failure_reason: lastFailureReason,
      days_with_issues: invalidDayCount,
      unique_week_days: uniqueWeekDays,
      week_tiled: weekTiled || undefined,
    },
  };
}

export type { PrimaryMealSlot };
