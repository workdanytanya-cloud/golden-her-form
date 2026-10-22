import {
  MAIN_RECIPE_REPEAT_DAYS,
  expectedMainCount,
  type MealScheduleMode,
  type PlanSlot,
  slotCalorieShare,
  slotsForMode,
} from "@/lib/nutrition-constructor/config";
import {
  d,
  finiteMacroNumber,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import { analyzeMacroFailure } from "@/lib/nutrition-constructor/macro-solver";
import {
  macroPriorities,
  pickBestRecipe,
  scoreRecipeForSlot,
  slotMacroTargets,
  isProteinRichRecipe,
  isLeanCarbMainRecipe,
  estimateRecipeDefaultMacros,
  type MacroPriorities,
} from "@/lib/nutrition-constructor/recipe-selection";
import type { RecipeSelectionContext } from "@/lib/nutrition-constructor/recipe-selection";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

export type ComboSearchContext = RecipeSelectionContext & {
  recipes: Recipe[];
  mainRecipes: Recipe[];
  snackRecipes: Recipe[];
};

export type DayAssemblerResult = Omit<ConstructorDay, "day_index" | "day_note"> | null;

export type DayAssembler = (
  slotRecipes: Partial<Record<PlanSlot, Recipe>>,
  options?: { searchPhase?: boolean },
) => DayAssemblerResult;

export type ComboSearchDiagnostics = {
  combinations_checked: number;
  elapsed_ms: number;
  timed_out: boolean;
  infeasible: boolean;
  last_failure_reason: string | null;
  best_deviation_score: number | null;
  best_recipe_slugs?: string[] | null;
  search_stage?: import("@/lib/nutrition-constructor/reason-codes").NutritionSearchStage;
  fast_elapsed_ms?: number;
  fallback_elapsed_ms?: number;
  used_fallback?: boolean;
  eligible_recipes_by_slot?: Partial<Record<PlanSlot, number>>;
  combinations_generated?: number;
  combinations_rejected_before_grams?: number;
  exact_fit_attempts?: number;
  exact_pass_signatures?: number;
  pass_recipe_sets?: string[][];
};

export type ComboSearchResult = {
  day: DayAssemblerResult;
  slotRecipes: Partial<Record<PlanSlot, Recipe>> | null;
  diagnostics: ComboSearchDiagnostics;
};

type ComboCandidate = {
  day: NonNullable<DayAssemblerResult>;
  slotRecipes: Partial<Record<PlanSlot, Recipe>>;
  score: number;
};

type ComboSearchState = {
  best: ComboCandidate | null;
};

function dayMacroNumbers(day: NonNullable<DayAssemblerResult>): {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
} {
  return {
    kcal: finiteMacroNumber(day.kcal),
    protein_g: finiteMacroNumber(day.protein_g),
    fat_g: finiteMacroNumber(day.fat_g),
    carbs_g: finiteMacroNumber(day.carbs_g),
  };
}

const MAIN_SHORTLIST = 8;
const SNACK_SHORTLIST = 6;
const maxCombinationsFor = (priorities: MacroPriorities, mode: MealScheduleMode) => {
  if (priorities.lowFat || priorities.highCarb) {
    return mode === "three_mains_only" ? 900 : 700;
  }
  if (!priorities.proteinFocused) return 500;
  if (mode === "three_mains_only" || mode === "two_main_two_snacks") return 400;
  return priorities.strictHighProtein ? 350 : 450;
};
const DAY_SEARCH_TIMEOUT_MS = 28_000;
const daySearchTimeoutMs = (priorities: MacroPriorities, mode: MealScheduleMode) => {
  if ((priorities.lowFat || priorities.highCarb) && mode === "three_mains_only") return 55_000;
  if (priorities.lowFat || priorities.highCarb) return 40_000;
  return DAY_SEARCH_TIMEOUT_MS;
};

function isNearValid(day: NonNullable<DayAssemblerResult>, targets: MacroBreakdown): boolean {
  const macros = dayMacroNumbers(day);
  return (
    Math.abs(macros.kcal - targets.kcal.toNumber()) <= 8 &&
    Math.abs(macros.protein_g - targets.protein_g.toNumber()) <= 12 &&
    Math.abs(macros.fat_g - targets.fat_g.toNumber()) <= 8 &&
    Math.abs(macros.carbs_g - targets.carbs_g.toNumber()) <= 8
  );
}

function deviationScore(day: NonNullable<DayAssemblerResult>, targets: MacroBreakdown): number {
  const macros = dayMacroNumbers(day);
  return (
    Math.abs(macros.kcal - targets.kcal.toNumber()) * 10 +
    Math.abs(macros.protein_g - targets.protein_g.toNumber()) * 4 +
    Math.abs(macros.fat_g - targets.fat_g.toNumber()) * 4 +
    Math.abs(macros.carbs_g - targets.carbs_g.toNumber()) * 2
  );
}

function rankedMains(
  ctx: ComboSearchContext,
  pool: Recipe[],
  slot: PlanSlot,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
  dayIndex: number,
  limit: number,
): Recipe[] {
  const slotTargets = slotMacroTargets(targets, shares[slot]);
  const scored = pool
    .map((recipe, idx) => {
      const base = scoreRecipeForSlot(ctx, recipe, slotTargets, excluded, priorities, "main");
      const proteinBoost = priorities.proteinFocused && isProteinRichRecipe(ctx, recipe) ? -5 : 0;
      const preferLeanCarbs =
        priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;
      const leanCarbBoost = preferLeanCarbs
        ? (recipe.slug.includes("chicken") || recipe.slug.includes("pollock") ? -8 : 0) +
          (recipe.slug.includes("rice") || recipe.slug.includes("buckwheat") ? -6 : 0) +
          (recipe.slug.includes("beef") ? 12 : 0) +
          (recipe.slug.includes("egg") ? 4 : 0)
        : 0;
      return {
        recipe,
        score: base + proteinBoost + leanCarbBoost,
        idx,
      };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => a.score - b.score || a.idx - b.idx);
  const ids = new Set<string>();
  const out: Recipe[] = [];
  for (const { recipe } of scored) {
    if (ids.has(recipe.id)) continue;
    ids.add(recipe.id);
    out.push(recipe);
    if (out.length >= limit) break;
  }
  if (out.length < limit) {
    for (const r of pool) {
      if (!ids.has(r.id)) {
        out.push(r);
        ids.add(r.id);
        if (out.length >= limit) break;
      }
    }
  }
  return out.length > 0 ? out : pool.slice(0, limit);
}

function rankedSnacks(
  ctx: ComboSearchContext,
  pool: Recipe[],
  slot: PlanSlot,
  targets: MacroBreakdown,
  shares: Record<PlanSlot, number>,
  excluded: Set<string>,
  priorities: MacroPriorities,
  limit: number,
): Recipe[] {
  const base = rankedMains(ctx, pool, slot, targets, shares, excluded, priorities, 0, limit * 2);
  if (!priorities.strictHighProtein) return base.slice(0, limit);
  const proteinSnacks = pool.filter(
    (r) =>
      r.contains_protein_source ||
      isProteinRichRecipe(ctx, r) ||
      r.slug.includes("tuna") ||
      r.slug.includes("cheese"),
  );
  const ids = new Set<string>();
  const merged: Recipe[] = [];
  for (const r of [...proteinSnacks, ...base]) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    merged.push(r);
    if (merged.length >= limit) break;
  }
  return merged;
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (arr.length < k) return;
  for (let i = 0; i <= arr.length - k; i++) {
    const head = arr[i]!;
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      yield [head, ...tail];
    }
  }
}

function isStrictProteinSnack(recipe: Recipe): boolean {
  return recipe.slug.includes("tuna") || recipe.slug.includes("cheese");
}

function isGrainMain(recipe: Recipe): boolean {
  return (
    recipe.slug.includes("rice") ||
    recipe.slug.includes("buckwheat") ||
    recipe.slug.includes("oats")
  );
}

function isFatForwardMain(recipe: Recipe): boolean {
  return (
    recipe.slug.includes("beef") ||
    recipe.slug.includes("omelette") ||
    recipe.slug.includes("cheese") ||
    recipe.slug.includes("avocado")
  );
}

function isLeanProteinMain(recipe: Recipe): boolean {
  return recipe.slug.includes("chicken") || recipe.slug.includes("pollock");
}

function dominantProteinKey(recipe: Recipe): string {
  if (recipe.slug.includes("pollock")) return "pollock";
  if (recipe.slug.includes("chicken")) return "chicken";
  if (recipe.slug.includes("beef")) return "beef";
  if (recipe.slug.includes("omelette") || recipe.slug.includes("egg")) return "egg";
  return recipe.id;
}

function sameProteinOverused(recipes: Recipe[]): boolean {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    const key = dominantProteinKey(recipe);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((n) => n >= 3);
}

function isCarbHeavySnack(recipe: Recipe): boolean {
  return (
    recipe.slug.includes("crispbread") ||
    recipe.slug.includes("lavash") ||
    recipe.slug.includes("corn") ||
    recipe.slug.includes("banana")
  );
}

function isFatForwardSnack(recipe: Recipe): boolean {
  return (
    recipe.slug.includes("cheese") ||
    recipe.slug.includes("avocado") ||
    recipe.slug.includes("walnut") ||
    recipe.slug.includes("almond") ||
    recipe.slug.includes("pumpkin")
  );
}

function snackPairPenalty(snack1: Recipe, snack2: Recipe, priorities: MacroPriorities): number {
  const carb1 = isCarbHeavySnack(snack1);
  const carb2 = isCarbHeavySnack(snack2);
  const fat1 = isFatForwardSnack(snack1);
  const fat2 = isFatForwardSnack(snack2);
  const tuna1 = snack1.slug.includes("tuna");
  const tuna2 = snack2.slug.includes("tuna");
  let penalty = 0;
  if (carb1 && carb2) penalty += 32;
  if (!fat1 && !fat2) penalty += 22;
  if (tuna1 && tuna2 && !fat1 && !fat2) penalty += 14;
  if (
    (fat1 || fat2) &&
    (tuna1 || tuna2 || snack1.slug.includes("cheese") || snack2.slug.includes("cheese"))
  ) {
    penalty -= 18;
  }
  if (priorities.lowCarb && (carb1 || carb2) && fat1 && fat2) penalty -= 6;
  return penalty;
}

function diverseSnacksForThreeMainTwo(
  pool: Recipe[],
  priorities: MacroPriorities,
  limit: number,
): Recipe[] {
  const noCook = pool.filter((r) => !r.requires_cooking);
  const prefer = [
    ...noCook.filter((r) => r.slug.includes("cheese")),
    ...noCook.filter((r) => r.slug.includes("avocado")),
    ...noCook.filter((r) => r.slug.includes("walnut") || r.slug.includes("almond")),
    ...noCook.filter(
      (r) => r.slug.includes("tuna") && !r.slug.includes("corn") && !r.slug.includes("lavash"),
    ),
    ...(priorities.lowCarb
      ? []
      : noCook.filter(
          (r) =>
            r.slug.includes("crispbread") || r.slug.includes("lavash") || r.slug.includes("corn"),
        )),
  ];
  const ids = new Set<string>();
  const out: Recipe[] = [];
  for (const r of prefer) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  if (out.length < 2) {
    for (const r of noCook) {
      if (ids.has(r.id)) continue;
      out.push(r);
      if (out.length >= Math.max(2, limit)) break;
    }
  }
  return out.length >= 2 ? out : noCook.slice(0, limit);
}

/** Штраф трио основных: зависит от lowFat/highCarb — иначе 1726 уезжает в жир/недобор круп. */
function threeMainsTrioPenalty(recipes: Recipe[], priorities: MacroPriorities): number {
  if (recipes.length !== 3) return 0;
  const grainN = recipes.filter(isGrainMain).length;
  const fatN = recipes.filter(isFatForwardMain).length;
  const leanN = recipes.filter(isLeanProteinMain).length;
  const oatsN = recipes.filter((r) => r.slug.includes("oats")).length;
  let penalty = 0;
  if (priorities.lowFat || priorities.highCarb) {
    if (fatN >= 2) penalty += 40;
    else if (fatN >= 1 && !priorities.highCarb) penalty += 12;
    if (grainN === 0) penalty += 28;
    else if (grainN === 1) penalty += 8;
    else if (grainN === 2) penalty -= 20;
    else if (grainN >= 3) penalty -= priorities.highCarb ? 14 : 4;
    // Умеренный белок: завтрак на овсянке снижает риск перебора P от 3×курицы.
    if (!priorities.proteinFocused && oatsN >= 1 && leanN >= 1 && grainN >= 2) penalty -= 16;
    if (leanN >= 3 && !priorities.proteinFocused) penalty += 18;
    if (recipes.filter((r) => r.slug.includes("omelette")).length >= 1 && priorities.lowFat) {
      penalty += 8;
    }
  } else {
    if (grainN >= 3) penalty += 24;
    else if (grainN === 2) penalty += 6;
    if (fatN === 0) penalty += 16;
    if (leanN === 0) penalty += 10;
    if (recipes.filter((r) => r.slug.includes("omelette")).length >= 2) penalty += 28;
    if (fatN >= 1 && leanN >= 1 && grainN <= 1) penalty -= 28;
  }
  return penalty;
}

function filterRecentMains(
  pool: Recipe[],
  recentMain: Map<string, number>,
  dayIndex: number,
): Recipe[] {
  const fresh = pool.filter((r) => {
    const last = recentMain.get(r.id);
    return last === undefined || dayIndex - last >= MAIN_RECIPE_REPEAT_DAYS;
  });
  return fresh.length >= 2 ? fresh : pool;
}

function snackTripletValid(_ctx: ComboSearchContext, picks: Recipe[]): boolean {
  if (picks.length !== 3) return false;
  if (new Set(picks.map((p) => p.id)).size !== 3) return false;
  if (picks.some((p) => p.is_treat)) return false;
  if (!picks.every((p) => p.is_nutrient_dense && !p.requires_cooking)) return false;
  if (!picks.some((p) => p.contains_protein_source)) return false;
  if (!picks.some((p) => p.contains_fruit_or_vegetable)) return false;
  return true;
}

export function searchValidDayCombo(params: {
  ctx: ComboSearchContext;
  mode: MealScheduleMode;
  dayIndex: number;
  targets: MacroBreakdown;
  excluded: Set<string>;
  recentMain: Map<string, number>;
  mains: Recipe[];
  snacks: Recipe[];
  assemble: DayAssembler;
  timeoutMs?: number;
  /** Принудительно урезать Top-N (тест: решение за пределами быстрого этапа). */
  forceTopN?: number;
  seed?: number;
  comboReject?: (slotRecipes: Partial<Record<PlanSlot, Recipe>>) => boolean;
  collectValid?: {
    take: (
      day: NonNullable<DayAssemblerResult>,
      slotRecipes: Partial<Record<PlanSlot, Recipe>>,
    ) => boolean;
  };
}): ComboSearchResult {
  const { ctx, mode, dayIndex, targets, excluded, recentMain, mains, snacks, assemble } = params;
  const shares = slotCalorieShare(mode);
  const priorities = macroPriorities(targets);
  const timeoutMs = params.timeoutMs ?? daySearchTimeoutMs(priorities, mode);
  const rejected = (slotRecipes: Partial<Record<PlanSlot, Recipe>>) =>
    params.comboReject?.(slotRecipes) === true;
  const started = Date.now();

  const diagnostics: ComboSearchDiagnostics = {
    combinations_checked: 0,
    elapsed_ms: 0,
    search_stage: "fast_topn",
    used_fallback: false,
    timed_out: false,
    infeasible: false,
    last_failure_reason: null,
    best_deviation_score: null,
    combinations_generated: 0,
    combinations_rejected_before_grams: 0,
    exact_fit_attempts: 0,
    exact_pass_signatures: 0,
    pass_recipe_sets: [],
  };

  const collectedValid: Array<{
    day: NonNullable<DayAssemblerResult>;
    slotRecipes: Partial<Record<PlanSlot, Recipe>>;
  }> = [];
  const handleValid = (
    day: NonNullable<DayAssemblerResult>,
    slotRecipes: Partial<Record<PlanSlot, Recipe>>,
  ): ComboSearchResult | "continue" => {
    if (rejected(slotRecipes) || !day.is_valid) return "continue";
    diagnostics.exact_pass_signatures = (diagnostics.exact_pass_signatures ?? 0) + 1;
    diagnostics.pass_recipe_sets!.push(
      Object.values(slotRecipes)
        .filter(Boolean)
        .map((recipe) => recipe!.slug),
    );
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.infeasible = false;
    diagnostics.last_failure_reason = null;
    if (!params.collectValid) {
      return { day, slotRecipes, diagnostics };
    }
    collectedValid.push({ day, slotRecipes });
    const more = params.collectValid.take(day, slotRecipes);
    return more ? "continue" : { day, slotRecipes, diagnostics };
  };

  if (targets.protein_g.toNumber() > 180) {
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.infeasible = true;
    diagnostics.last_failure_reason = "недостижимый уровень белка для каталога";
    return { day: null, slotRecipes: null, diagnostics };
  }

  const comboSearch: ComboSearchState = { best: null };

  const timedOut = () => Date.now() - started >= timeoutMs;
  const recordAttempt = (
    day: DayAssemblerResult,
    slotRecipes: Partial<Record<PlanSlot, Recipe>>,
  ) => {
    diagnostics.combinations_checked++;
    if (!day) {
      diagnostics.last_failure_reason = "нет допустимых ингредиентов для сочетания";
      return;
    }
    if (day.is_valid) {
      diagnostics.elapsed_ms = Date.now() - started;
      return { valid: true as const, day, slotRecipes };
    }
    const score = deviationScore(day, targets);
    if (diagnostics.best_deviation_score == null || score < diagnostics.best_deviation_score) {
      diagnostics.best_deviation_score = score;
      diagnostics.best_recipe_slugs = Object.values(slotRecipes)
        .filter(Boolean)
        .map((r) => r!.slug);
    }
    diagnostics.last_failure_reason = analyzeMacroFailure(
      {
        kcal: d(day.kcal),
        protein_g: d(day.protein_g),
        fat_g: d(day.fat_g),
        carbs_g: d(day.carbs_g),
        fiber_g: d(day.fiber_g),
      },
      targets,
      { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 },
    );
    if (!comboSearch.best || score < comboSearch.best.score) {
      comboSearch.best = { day, slotRecipes, score };
    }
    return { valid: false as const };
  };

  const mainPoolBase = (() => {
    const preferLeanCarbs =
      priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;
    if (preferLeanCarbs) {
      const lean = mains.filter((r) => isLeanCarbMainRecipe(ctx, r));
      if (lean.length >= expectedMainCount(mode)) return lean;
    }
    if (priorities.proteinFocused) {
      return mains.filter((r) => isProteinRichRecipe(ctx, r));
    }
    return mains;
  })();
  const mainPool = filterRecentMains(
    mainPoolBase.length >= expectedMainCount(mode) ? mainPoolBase : mains,
    recentMain,
    dayIndex,
  );
  const mainShort = rankedMains(
    ctx,
    mainPool,
    "main1",
    targets,
    shares,
    excluded,
    priorities,
    dayIndex,
    MAIN_SHORTLIST,
  );
  const strictProteinSnacks = snacks.filter(isStrictProteinSnack);
  const proteinSnackPool = snacks.filter(
    (r) => r.contains_protein_source || r.slug.includes("tuna") || r.slug.includes("cheese"),
  );
  const snackPoolForMode =
    priorities.strictHighProtein && strictProteinSnacks.length >= 2
      ? strictProteinSnacks
      : priorities.proteinFocused
        ? (() => {
            const ids = new Set<string>();
            const mixed: Recipe[] = [];
            const preferCarbs = !priorities.lowCarb && !priorities.strictHighProtein;
            const pool = preferCarbs
              ? snacks.filter(
                  (r) =>
                    !r.slug.includes("walnut") &&
                    !r.slug.includes("almond") &&
                    !r.slug.includes("pumpkin"),
                )
              : snacks;
            const carbSnacks = pool.filter(
              (r) =>
                r.slug.includes("banana") ||
                r.slug.includes("crispbread") ||
                r.slug.includes("lavash") ||
                r.slug.includes("corn") ||
                r.slug.includes("apple"),
            );
            // 1800: tuna/cheese + carbs; cheese/avocado для жира.
            const proteinFirst = preferCarbs
              ? [
                  ...pool.filter(
                    (r) =>
                      r.slug.includes("cheese") &&
                      (r.slug.includes("crispbread") || r.slug.includes("apple")),
                  ),
                  ...pool.filter(
                    (r) =>
                      r.slug.includes("tuna") &&
                      (r.slug.includes("crispbread") ||
                        r.slug.includes("lavash") ||
                        r.slug.includes("corn") ||
                        r.slug.includes("avocado")),
                  ),
                  ...pool.filter(
                    (r) => r.slug.includes("avocado") && r.slug.includes("crispbread"),
                  ),
                  ...carbSnacks,
                  ...proteinSnackPool.filter((r) => pool.some((p) => p.id === r.id)),
                  ...pool,
                ]
              : [...strictProteinSnacks, ...proteinSnackPool, ...snacks];
            for (const r of proteinFirst) {
              if (ids.has(r.id)) continue;
              ids.add(r.id);
              mixed.push(r);
              if (mixed.length >= 10) break;
            }
            return mixed.length >= 2 ? mixed : snacks;
          })()
        : snacks;
  const snackShort = rankedSnacks(
    ctx,
    snackPoolForMode,
    "snack1",
    targets,
    shares,
    excluded,
    priorities,
    SNACK_SHORTLIST,
  );
  diagnostics.eligible_recipes_by_slot = Object.fromEntries(
    slotsForMode(mode).map((slot) => [
      slot,
      slot.startsWith("main") ? mainPool.length : snacks.length,
    ]),
  );

  const comboLimit = params.collectValid
    ? Math.max(maxCombinationsFor(priorities, mode), 900)
    : maxCombinationsFor(priorities, mode);

  const tryCombo = (slotRecipes: Partial<Record<PlanSlot, Recipe>>, quick: boolean) => {
    if (diagnostics.combinations_checked >= comboLimit || timedOut()) return "stop" as const;
    if (rejected(slotRecipes)) return "continue" as const;
    const day = assemble(slotRecipes, { searchPhase: quick });
    const result = recordAttempt(day, slotRecipes);
    if (result && "valid" in result && result.valid) {
      if (quick) {
        const full = assemble(slotRecipes, { searchPhase: false });
        if (full?.is_valid) {
          return "found" as const;
        }
        if (full && isNearValid(full, targets)) {
          recordAttempt(full, slotRecipes);
        }
        return "continue" as const;
      }
      return "found" as const;
    }
    if (quick && day && isNearValid(day, targets)) {
      const full = assemble(slotRecipes, { searchPhase: false });
      if (full?.is_valid) return "found" as const;
    }
    return "continue" as const;
  };

  type ScoredCombo = { slotRecipes: Partial<Record<PlanSlot, Recipe>>; score: number };
  const scoredCombos: ScoredCombo[] = [];

  const comboScore = (slotRecipes: Partial<Record<PlanSlot, Recipe>>): number => {
    let score = 0;
    for (const [slot, recipe] of Object.entries(slotRecipes) as [PlanSlot, Recipe][]) {
      if (!recipe) continue;
      const mealType = slot.startsWith("main") ? "main" : "snack";
      const slotScore = scoreRecipeForSlot(
        ctx,
        recipe,
        slotMacroTargets(targets, shares[slot]),
        excluded,
        priorities,
        mealType,
      );
      score += Number.isFinite(slotScore) ? slotScore : 80;
    }
    if (mode === "three_mains_only" || mode === "three_main_two_snacks") {
      score += threeMainsTrioPenalty(
        [slotRecipes.main1, slotRecipes.main2, slotRecipes.main3].filter(Boolean) as Recipe[],
        priorities,
      );
      let kcal = 0;
      let protein = 0;
      let fat = 0;
      let carbs = 0;
      let missing = false;
      for (const recipe of Object.values(slotRecipes)) {
        if (!recipe) continue;
        const macros = estimateRecipeDefaultMacros(ctx, recipe, excluded);
        if (!macros) {
          missing = true;
          break;
        }
        kcal += macros.kcal.toNumber();
        protein += macros.protein_g.toNumber();
        fat += macros.fat_g.toNumber();
        carbs += macros.carbs_g.toNumber();
      }
      if (!missing) {
        score +=
          Math.abs(kcal - targets.kcal.toNumber()) * 0.35 +
          Math.abs(protein - targets.protein_g.toNumber()) * 4 +
          Math.abs(fat - targets.fat_g.toNumber()) * 5 +
          Math.abs(carbs - targets.carbs_g.toNumber()) * 3.5;
      }
    }
    if (mode === "three_main_two_snacks" && slotRecipes.snack1 && slotRecipes.snack2) {
      score += snackPairPenalty(slotRecipes.snack1, slotRecipes.snack2, priorities);
    }
    for (const [slot, recipe] of Object.entries(slotRecipes) as [PlanSlot, Recipe][]) {
      if (!recipe) continue;
      const mealType = slot.startsWith("main") ? "main" : "snack";
      if (priorities.proteinFocused && mealType === "snack") {
        if (priorities.strictHighProtein || priorities.lowCarb) {
          if (recipe.slug.includes("tuna")) score -= 20;
          else if (recipe.slug.includes("cheese")) score -= 8;
          else if (recipe.contains_protein_source) score -= 6;
        } else {
          if (
            recipe.slug.includes("crispbread") ||
            recipe.slug.includes("lavash") ||
            recipe.slug.includes("corn")
          ) {
            score -= 12;
          }
          if (recipe.slug.includes("tuna")) score -= 14;
          else if (recipe.slug.includes("cheese")) score -= 12;
          else if (recipe.contains_protein_source) score -= 4;
          if (recipe.slug.includes("avocado") && recipe.slug.includes("tuna")) score -= 4;
          if (
            recipe.slug.includes("pumpkin") ||
            recipe.slug.includes("walnut") ||
            recipe.slug.includes("almond")
          ) {
            score += 10;
          }
        }
      }
    }
    return score;
  };

  const mainsForCombo = priorities.proteinFocused
    ? rankedMains(
        ctx,
        mainPool,
        "main1",
        targets,
        shares,
        excluded,
        priorities,
        dayIndex,
        mode === "three_main_two_snacks"
          ? priorities.strictHighProtein
            ? 7
            : priorities.lowCarb
              ? 7
              : 6
          : mode === "three_mains_only"
            ? 20
            : 8,
      )
    : priorities.lowFat || priorities.highCarb
      ? rankedMains(
          ctx,
          // Держим овсянку/зерновые + lean; не выкидываем oats только из‑за «не lean meat».
          (() => {
            const preferred = mainPool.filter(
              (r) =>
                isGrainMain(r) ||
                isLeanProteinMain(r) ||
                r.slug.includes("oats") ||
                (!isFatForwardMain(r) && r.contains_protein_source),
            );
            return preferred.length >= expectedMainCount(mode) ? preferred : mainPool;
          })(),
          "main1",
          targets,
          shares,
          excluded,
          priorities,
          dayIndex,
          mode === "three_mains_only" ? 16 : 10,
        )
      : mainShort;
  const snacksForComboBase = priorities.proteinFocused
    ? snackPoolForMode.slice(0, mode === "one_main_three_snacks" ? 8 : 6)
    : snackShort;
  const snacksForCombo =
    mode === "three_main_two_snacks"
      ? diverseSnacksForThreeMainTwo(snacks, priorities, 8)
      : snacksForComboBase;
  if ((mode === "three_main_two_snacks" || mode === "three_mains_only") && !priorities.lowCarb) {
    const extraMains = priorities.lowFat
      ? mains.filter((r) => isLeanProteinMain(r) && isGrainMain(r))
      : mains.filter((r) => !isGrainMain(r));
    for (const recipe of extraMains) {
      if (mainsForCombo.some((x) => x.id === recipe.id)) continue;
      mainsForCombo.push(recipe);
      if (mainsForCombo.length >= (priorities.lowFat || priorities.highCarb ? 14 : 8)) break;
    }
  }

  if (mode === "three_mains_only") {
    diagnostics.combinations_generated =
      (mainsForCombo.length * (mainsForCombo.length - 1) * (mainsForCombo.length - 2)) / 6;
    for (const trio of combinations(mainsForCombo, 3)) {
      const omeletteN = trio.filter((r) => r.slug.includes("omelette")).length;
      if (omeletteN >= 2) {
        diagnostics.combinations_rejected_before_grams!++;
        continue;
      }
      if (priorities.lowFat && trio.filter(isFatForwardMain).length >= 1) {
        diagnostics.combinations_rejected_before_grams!++;
        continue;
      }
      if (priorities.highCarb && trio.filter(isGrainMain).length < 2) {
        diagnostics.combinations_rejected_before_grams!++;
        continue;
      }
      if (!priorities.highCarb && !priorities.lowFat && trio.filter(isGrainMain).length >= 3)
        continue;
      if (sameProteinOverused(trio)) {
        diagnostics.combinations_rejected_before_grams!++;
        continue;
      }
      if (priorities.proteinFocused && trio.filter(isLeanProteinMain).length === 0) {
        diagnostics.combinations_rejected_before_grams!++;
        continue;
      }
      if (priorities.highCarb && trio.filter(isGrainMain).length < 2) continue;
      scoredCombos.push({
        slotRecipes: { main1: trio[0], main2: trio[1], main3: trio[2] },
        score: comboScore({ main1: trio[0], main2: trio[1], main3: trio[2] }),
      });
    }
  } else if (mode === "three_main_two_snacks") {
    const s1 = snacksForCombo;
    const s2pool = snacksForCombo;
    const preferMixedCarbs =
      priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;
    for (const trio of combinations(mainsForCombo, 3)) {
      const omeletteN = trio.filter((r) => r.slug.includes("omelette")).length;
      if (omeletteN >= 2) continue;
      if (priorities.proteinFocused && trio.filter(isLeanProteinMain).length === 0) continue;
      if (trio.filter(isGrainMain).length >= 3) continue;
      if (priorities.lowCarb && trio.filter(isGrainMain).length >= 2) continue;
      for (const snack1 of s1) {
        for (const snack2 of s2pool) {
          if (snack1.id === snack2.id) continue;
          if (snack1.requires_cooking || snack2.requires_cooking) continue;
          const carb1 = isCarbHeavySnack(snack1);
          const carb2 = isCarbHeavySnack(snack2);
          const fat1 = isFatForwardSnack(snack1);
          const fat2 = isFatForwardSnack(snack2);
          if (carb1 && carb2) continue;
          if ((priorities.lowCarb || priorities.proteinFocused) && !fat1 && !fat2) continue;
          if (priorities.strictHighProtein) {
            if (!isStrictProteinSnack(snack1) && !isStrictProteinSnack(snack2)) continue;
          } else if (priorities.proteinFocused) {
            const s1ok = isStrictProteinSnack(snack1) || snack1.contains_protein_source;
            const s2ok = isStrictProteinSnack(snack2) || snack2.contains_protein_source;
            if (!s1ok && !s2ok) continue;
            if (preferMixedCarbs) {
              const proteinSnack = (r: Recipe) =>
                r.slug.includes("tuna") || r.slug.includes("cheese");
              if (!proteinSnack(snack1) && !proteinSnack(snack2)) continue;
            }
          }
          const slotRecipes = {
            main1: trio[0],
            main2: trio[1],
            main3: trio[2],
            snack1,
            snack2,
          };
          scoredCombos.push({ slotRecipes, score: comboScore(slotRecipes) });
        }
      }
    }
  } else if (mode === "two_main_two_snacks") {
    const snackPool = priorities.strictHighProtein ? snackPoolForMode : snacksForCombo;
    const preferMixedCarbs =
      priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;
    const carbish = (r: Recipe) =>
      r.slug.includes("crispbread") ||
      r.slug.includes("lavash") ||
      r.slug.includes("banana") ||
      r.slug.includes("apple") ||
      r.slug.includes("corn");
    const proteinSnack = (r: Recipe) => r.slug.includes("tuna") || r.slug.includes("cheese");
    const fatSnack = (r: Recipe) => r.slug.includes("cheese") || r.slug.includes("avocado");
    for (const pair of combinations(mainsForCombo, 2)) {
      for (const snack1 of snackPool) {
        for (const snack2 of snackPool) {
          if (snack1.id === snack2.id) continue;
          if (priorities.strictHighProtein) {
            if (!isStrictProteinSnack(snack1) || !isStrictProteinSnack(snack2)) continue;
          } else if (priorities.proteinFocused) {
            const s1ok = isStrictProteinSnack(snack1) || snack1.contains_protein_source;
            const s2ok = isStrictProteinSnack(snack2) || snack2.contains_protein_source;
            if (!s1ok && !s2ok) continue;
            if (preferMixedCarbs) {
              if (!carbish(snack1) && !carbish(snack2)) continue;
              if (!proteinSnack(snack1) && !proteinSnack(snack2)) continue;
              if (!fatSnack(snack1) && !fatSnack(snack2)) continue;
            }
          }
          const slotRecipes = { main1: pair[0], main2: pair[1], snack1, snack2 };
          scoredCombos.push({ slotRecipes, score: comboScore(slotRecipes) });
        }
      }
    }
  } else if (mode === "one_main_three_snacks") {
    const mainCandidates = mainsForCombo.slice(0, 10);
    const strictPool = snackPoolForMode.filter(isStrictProteinSnack);
    const snackPool =
      priorities.strictHighProtein && strictPool.length >= 3 ? strictPool : snacksForCombo;
    for (const main1 of mainCandidates) {
      for (const triplet of combinations(snackPool.slice(0, 8), 3)) {
        if (!snackTripletValid(ctx, triplet)) continue;
        if (priorities.strictHighProtein && strictPool.length >= 3) {
          if (!triplet.every(isStrictProteinSnack)) continue;
        } else if (
          !triplet.some((recipe) => recipe.contains_protein_source || isStrictProteinSnack(recipe))
        ) {
          continue;
        }
        const slotRecipes = {
          main1,
          snack1: triplet[0],
          snack2: triplet[1],
          snack3: triplet[2],
        };
        scoredCombos.push({ slotRecipes, score: comboScore(slotRecipes) });
      }
    }
  }

  const seededTie = (slotRecipes: Partial<Record<PlanSlot, Recipe>>) => {
    const text = `${params.seed ?? 0}:${Object.values(slotRecipes)
      .map((recipe) => recipe?.id ?? "")
      .join("|")}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
  };
  scoredCombos.sort(
    (a, b) => {
      const diversityScore = (candidate: ScoredCombo) =>
        Object.values(candidate.slotRecipes).reduce((score, recipe) => {
          if (recipe?.slug.includes("cod")) return score - 24;
          if (recipe?.slug.includes("turkey")) return score - 18;
          return score;
        }, 0);
      const scoreA = a.score + (params.collectValid ? diversityScore(a) : 0);
      const scoreB = b.score + (params.collectValid ? diversityScore(b) : 0);
      return scoreA - scoreB || seededTie(a.slotRecipes) - seededTie(b.slotRecipes);
    },
  );
  if (params.collectValid && mode === "three_mains_only" && scoredCombos.length > 240) {
    const beam: ScoredCombo[] = [];
    const seen = new Set<string>();
    const add = (candidate: ScoredCombo) => {
      const key = Object.values(candidate.slotRecipes)
        .map((recipe) => recipe?.id ?? "")
        .sort()
        .join("|");
      if (seen.has(key)) return;
      seen.add(key);
      beam.push(candidate);
    };
    scoredCombos.slice(0, 120).forEach(add);
    for (const recipe of mainsForCombo) {
      let taken = 0;
      for (const candidate of scoredCombos) {
        if (!Object.values(candidate.slotRecipes).some((item) => item?.id === recipe.id)) continue;
        add(candidate);
        if (++taken >= 8) break;
      }
    }
    for (let i = 0; i < mainsForCombo.length; i++) {
      for (let j = i + 1; j < mainsForCombo.length; j++) {
        let taken = 0;
        for (const candidate of scoredCombos) {
          const ids = new Set(Object.values(candidate.slotRecipes).map((item) => item?.id));
          if (!ids.has(mainsForCombo[i]!.id) || !ids.has(mainsForCombo[j]!.id)) continue;
          add(candidate);
          if (++taken >= 2) break;
        }
      }
    }
    scoredCombos.length = 0;
    scoredCombos.push(...beam.slice(0, 360));
  }
  if (mode === "three_main_two_snacks" && scoredCombos.length > 90) {
    scoredCombos.length = 90;
  }

  const nearCandidates: Array<{ slotRecipes: Partial<Record<PlanSlot, Recipe>>; score: number }> =
    [];

  const preferLeanCarbs =
    priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;

  if (params.collectValid && excluded.size > 0) {
    for (const { slotRecipes } of scoredCombos) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      diagnostics.exact_fit_attempts!++;
      const day = assemble(slotRecipes, { searchPhase: false });
      const attempt = recordAttempt(day, slotRecipes);
      if (attempt && "valid" in attempt && attempt.valid) {
        const handled = handleValid(attempt.day, slotRecipes);
        if (handled !== "continue") return handled;
      }
    }
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.timed_out = timedOut();
    diagnostics.infeasible = collectedValid.length === 0 && !diagnostics.timed_out;
    const collected = collectedValid.at(-1);
    return {
      day: collected?.day ?? null,
      slotRecipes: collected?.slotRecipes ?? null,
      diagnostics,
    };
  }

  // 1800: сразу полная сборка лучших комбо (quick-фаза слишком дорогая с маслом).
  if (preferLeanCarbs) {
    const budget = mode === "one_main_three_snacks" ? 60 : 90;
    for (const { slotRecipes } of scoredCombos.slice(0, budget)) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        const handled = handleValid(day, slotRecipes);
        if (handled !== "continue") return handled;
      }
      recordAttempt(day, slotRecipes);
    }
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.timed_out = timedOut();
    diagnostics.infeasible = !comboSearch.best?.day?.is_valid;
    if (
      comboSearch.best?.slotRecipes &&
      comboSearch.best.day &&
      !comboSearch.best.day.is_valid &&
      !rejected(comboSearch.best.slotRecipes)
    ) {
      const polished = assemble(comboSearch.best.slotRecipes, { searchPhase: false });
      if (polished?.is_valid) {
        diagnostics.infeasible = false;
        return { day: polished, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
      }
      recordAttempt(polished, comboSearch.best.slotRecipes);
    }
    if (comboSearch.best?.day?.is_valid && !rejected(comboSearch.best.slotRecipes ?? {})) {
      return { day: comboSearch.best.day, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
    }
    return {
      day: comboSearch.best?.day ?? null,
      slotRecipes: comboSearch.best?.slotRecipes ?? null,
      diagnostics,
    };
  }

  if (mode === "two_main_two_snacks" && priorities.proteinFocused) {
    scoredCombos.sort((a, b) => a.score - b.score);
    for (const { slotRecipes } of scoredCombos) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        const handled = handleValid(day, slotRecipes);
        if (handled !== "continue") return handled;
      }
      recordAttempt(day, slotRecipes);
    }
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.timed_out = timedOut();
    diagnostics.infeasible = !comboSearch.best?.day?.is_valid && collectedValid.length === 0;
    const collected = collectedValid[collectedValid.length - 1];
    if (collected) {
      diagnostics.infeasible = false;
      return {
        day: collected.day,
        slotRecipes: collected.slotRecipes,
        diagnostics,
      };
    }
    if (
      comboSearch.best?.day?.is_valid &&
      comboSearch.best.slotRecipes &&
      !rejected(comboSearch.best.slotRecipes)
    ) {
      return { day: comboSearch.best.day, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
    }
    return {
      day: comboSearch.best?.day ?? null,
      slotRecipes: comboSearch.best?.slotRecipes ?? null,
      diagnostics,
    };
  }

  if (priorities.proteinFocused) {
    const preferLeanCarbs = !priorities.strictHighProtein && !priorities.lowCarb;
    // Сначала быстрый проход, потом полная сборка топ-кандидатов — без двойного счёта.
    for (const { slotRecipes } of scoredCombos) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      const quickDay = assemble(slotRecipes, { searchPhase: true });
      diagnostics.combinations_checked++;
      if (!quickDay) continue;
      if (quickDay.is_valid) {
        const full = assemble(slotRecipes, { searchPhase: false });
        diagnostics.exact_fit_attempts!++;
        diagnostics.combinations_checked++;
        if (full?.is_valid) {
          const handled = handleValid(full, slotRecipes);
          if (handled !== "continue") return handled;
        }
        recordAttempt(full ?? quickDay, slotRecipes);
      } else {
        const carbWeight = priorities.lowCarb || priorities.strictHighProtein ? 1 : 2.5;
        const fatWeight = preferLeanCarbs ? 2.5 : 2;
        const quickMacros = dayMacroNumbers(quickDay);
        const score =
          Math.abs(quickMacros.kcal - targets.kcal.toNumber()) +
          Math.abs(quickMacros.protein_g - targets.protein_g.toNumber()) * 3 +
          Math.abs(quickMacros.fat_g - targets.fat_g.toNumber()) * fatWeight +
          Math.abs(quickMacros.carbs_g - targets.carbs_g.toNumber()) * carbWeight;
        nearCandidates.push({ slotRecipes, score });
        nearCandidates.sort((a, b) => a.score - b.score);
        if (nearCandidates.length > (preferLeanCarbs ? 48 : 60)) nearCandidates.pop();
        const scoreDay = deviationScore(quickDay, targets);
        if (
          diagnostics.best_deviation_score == null ||
          scoreDay < diagnostics.best_deviation_score
        ) {
          diagnostics.best_deviation_score = scoreDay;
          diagnostics.best_recipe_slugs = Object.values(slotRecipes)
            .filter(Boolean)
            .map((r) => r!.slug);
          diagnostics.last_failure_reason = analyzeMacroFailure(
            {
              kcal: d(quickDay.kcal),
              protein_g: d(quickDay.protein_g),
              fat_g: d(quickDay.fat_g),
              carbs_g: d(quickDay.carbs_g),
              fiber_g: d(quickDay.fiber_g),
            },
            targets,
            { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 },
          );
          comboSearch.best = { day: quickDay, slotRecipes, score: scoreDay };
        }
      }
    }
    for (const { slotRecipes } of nearCandidates) {
      if (timedOut()) break;
      if (rejected(slotRecipes)) continue;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.exact_fit_attempts!++;
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        const handled = handleValid(day, slotRecipes);
        if (handled !== "continue") return handled;
      }
      recordAttempt(day, slotRecipes);
    }
  } else {
    // Стандартный / lowFat / highCarb: Top-N → near polish → expand/exact fallback.
    const defaultTopN =
      priorities.lowFat || priorities.highCarb ? (mode === "three_mains_only" ? 120 : 90) : 80;
    const topN = params.forceTopN != null ? Math.max(1, params.forceTopN) : defaultTopN;
    const nearBudget = priorities.lowFat || priorities.highCarb ? 36 : 24;
    diagnostics.search_stage = "fast_topn";
    for (const { slotRecipes } of scoredCombos.slice(0, topN)) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      const quickDay = assemble(slotRecipes, { searchPhase: true });
      diagnostics.combinations_checked++;
      if (!quickDay) continue;
      if (quickDay.is_valid) {
        const full = assemble(slotRecipes, { searchPhase: false });
        diagnostics.combinations_checked++;
        if (full?.is_valid) {
          const handled = handleValid(full, slotRecipes);
          if (handled !== "continue") {
            diagnostics.fast_elapsed_ms = Date.now() - started;
            return handled;
          }
        }
        recordAttempt(full ?? quickDay, slotRecipes);
        continue;
      }
      const fatWeight = priorities.lowFat ? 4 : 2;
      const carbWeight = priorities.highCarb ? 3.5 : 2;
      const proteinWeight = priorities.proteinFocused ? 3 : 2.2;
      const quickMacros = dayMacroNumbers(quickDay);
      const score =
        Math.abs(quickMacros.kcal - targets.kcal.toNumber()) +
        Math.abs(quickMacros.protein_g - targets.protein_g.toNumber()) * proteinWeight +
        Math.abs(quickMacros.fat_g - targets.fat_g.toNumber()) * fatWeight +
        Math.abs(quickMacros.carbs_g - targets.carbs_g.toNumber()) * carbWeight;
      nearCandidates.push({ slotRecipes, score });
      nearCandidates.sort((a, b) => a.score - b.score);
      if (nearCandidates.length > nearBudget) nearCandidates.pop();
      recordAttempt(quickDay, slotRecipes);
    }
    for (const { slotRecipes } of nearCandidates) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      if (rejected(slotRecipes)) continue;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        const handled = handleValid(day, slotRecipes);
        if (handled !== "continue") {
          diagnostics.fast_elapsed_ms = Date.now() - started;
          return handled;
        }
      }
      recordAttempt(day, slotRecipes);
    }
    diagnostics.fast_elapsed_ms = Date.now() - started;

    // Exact fallback: Top-N не дал PASS — расширяем пространство и перебираем остаток.
    if (!comboSearch.best?.day?.is_valid && !timedOut()) {
      const fallbackStarted = Date.now();
      diagnostics.search_stage = "expand_candidates";
      diagnostics.used_fallback = true;
      const expandLimit = Math.max(comboLimit, scoredCombos.length);
      const rest = scoredCombos.slice(topN);
      diagnostics.search_stage = "exact_fallback";
      for (const { slotRecipes } of rest) {
        if (timedOut() || diagnostics.combinations_checked >= expandLimit) break;
        if (rejected(slotRecipes)) continue;
        const day = assemble(slotRecipes, { searchPhase: false });
        diagnostics.combinations_checked++;
        if (day?.is_valid) {
          const handled = handleValid(day, slotRecipes);
          if (handled !== "continue") {
            diagnostics.fallback_elapsed_ms = Date.now() - fallbackStarted;
            diagnostics.elapsed_ms = Date.now() - started;
            diagnostics.timed_out = false;
            diagnostics.infeasible = false;
            return handled;
          }
        }
        recordAttempt(day, slotRecipes);
      }
      diagnostics.fallback_elapsed_ms = Date.now() - fallbackStarted;
    }
  }

  diagnostics.elapsed_ms = Date.now() - started;
  diagnostics.timed_out = timedOut();
  // INFEASIBLE только если поиск исчерпан без timeout; TIMEOUT отдельно.
  const foundValid = !!comboSearch.best?.day?.is_valid;
  diagnostics.infeasible = !foundValid && !diagnostics.timed_out;

  if (
    comboSearch.best?.slotRecipes &&
    comboSearch.best.day &&
    !comboSearch.best.day.is_valid &&
    !rejected(comboSearch.best.slotRecipes)
  ) {
    const bestMacros = dayMacroNumbers(comboSearch.best.day);
    const diffP = Math.abs(bestMacros.protein_g - targets.protein_g.toNumber());
    const diffF = Math.abs(bestMacros.fat_g - targets.fat_g.toNumber());
    const diffC = Math.abs(bestMacros.carbs_g - targets.carbs_g.toNumber());
    const diffK = Math.abs(bestMacros.kcal - targets.kcal.toNumber());
    const fatSlack = priorities.lowFat ? 28 : 10;
    const carbSlack = priorities.highCarb ? 45 : 10;
    if (diffP <= 15 && diffF <= fatSlack && diffC <= carbSlack && diffK <= 80) {
      const polished = assemble(comboSearch.best.slotRecipes, { searchPhase: false });
      if (polished?.is_valid) {
        diagnostics.infeasible = false;
        diagnostics.timed_out = false;
        return { day: polished, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
      }
    }
  }

  if (
    comboSearch.best?.slotRecipes &&
    comboSearch.best.day &&
    !comboSearch.best.day.is_valid &&
    !rejected(comboSearch.best.slotRecipes) &&
    isNearValid(comboSearch.best.day, targets)
  ) {
    const polished = assemble(comboSearch.best.slotRecipes, { searchPhase: false });
    if (polished?.is_valid) {
      diagnostics.infeasible = false;
      diagnostics.timed_out = false;
      return { day: polished, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
    }
  }

  if (comboSearch.best?.day?.is_valid && !rejected(comboSearch.best.slotRecipes ?? {})) {
    return { day: comboSearch.best.day, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
  }

  // Near-miss не возвращаем как «готовый» день: только null + диагностика.
  return {
    day: null,
    slotRecipes: null,
    diagnostics,
  };
}

/** Fallback single-pick path when search exhausts budget. */
export function pickDefaultSlotRecipes(params: {
  ctx: ComboSearchContext;
  mode: MealScheduleMode;
  dayIndex: number;
  targets: MacroBreakdown;
  excluded: Set<string>;
  recentMain: Map<string, number>;
  mains: Recipe[];
  snacks: Recipe[];
}): Partial<Record<PlanSlot, Recipe>> | null {
  const { ctx, mode, dayIndex, targets, excluded, recentMain, mains, snacks } = params;
  const shares = slotCalorieShare(mode);
  const priorities = macroPriorities(targets);
  const mainPool = filterRecentMains(mains, recentMain, dayIndex);

  if (mode === "three_main_two_snacks" && mainPool.length >= 3 && snacks.length >= 2) {
    const main1 =
      pickBestRecipe(
        mainPool,
        ctx,
        slotMacroTargets(targets, shares.main1),
        excluded,
        priorities,
        "main",
        dayIndex,
      ) ?? mainPool[0]!;
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
      ) ?? mainPool[1]!;
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
      ) ?? mainPool[2]!;
    const snack1 =
      pickBestRecipe(
        snacks,
        ctx,
        slotMacroTargets(targets, shares.snack1),
        excluded,
        priorities,
        "snack",
        dayIndex,
      ) ?? snacks[0]!;
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
      ) ?? snacks[1]!;
    return { main1, main2, main3, snack1, snack2 };
  }

  return null;
}
