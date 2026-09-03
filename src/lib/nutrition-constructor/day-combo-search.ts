import {
  MAIN_RECIPE_REPEAT_DAYS,
  expectedMainCount,
  type MealScheduleMode,
  type PlanSlot,
  slotCalorieShare,
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
  if (!priorities.proteinFocused) return 500;
  if (mode === "three_mains_only" || mode === "two_main_two_snacks") return 400;
  return priorities.strictHighProtein ? 350 : 450;
};
const DAY_SEARCH_TIMEOUT_MS = 28_000;

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

/** Без перекусов день должен смешать жировой рычаг, постный белок и не три крупы. */
function threeMainsTrioPenalty(recipes: Recipe[]): number {
  if (recipes.length !== 3) return 0;
  const grainN = recipes.filter(isGrainMain).length;
  const fatN = recipes.filter(isFatForwardMain).length;
  const leanN = recipes.filter(isLeanProteinMain).length;
  let penalty = 0;
  if (grainN >= 3) penalty += 24;
  else if (grainN === 2) penalty += 6;
  if (fatN === 0) penalty += 16;
  if (leanN === 0) penalty += 10;
  if (recipes.filter((r) => r.slug.includes("omelette")).length >= 2) penalty += 28;
  if (fatN >= 1 && leanN >= 1 && grainN <= 1) penalty -= 28;
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
  comboReject?: (slotRecipes: Partial<Record<PlanSlot, Recipe>>) => boolean;
  collectValid?: {
    take: (
      day: NonNullable<DayAssemblerResult>,
      slotRecipes: Partial<Record<PlanSlot, Recipe>>,
    ) => boolean;
  };
}): ComboSearchResult {
  const { ctx, mode, dayIndex, targets, excluded, recentMain, mains, snacks, assemble } = params;
  const timeoutMs = params.timeoutMs ?? DAY_SEARCH_TIMEOUT_MS;
  const rejected = (slotRecipes: Partial<Record<PlanSlot, Recipe>>) =>
    params.comboReject?.(slotRecipes) === true;
  const shares = slotCalorieShare(mode);
  const priorities = macroPriorities(targets);
  const started = Date.now();

  const diagnostics: ComboSearchDiagnostics = {
    combinations_checked: 0,
    elapsed_ms: 0,
    timed_out: false,
    infeasible: false,
    last_failure_reason: null,
    best_deviation_score: null,
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
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.infeasible = false;
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
            ? 10
            : 8,
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
    const extraMains = mains.filter((r) => !isGrainMain(r));
    for (const recipe of extraMains) {
      if (mainsForCombo.some((x) => x.id === recipe.id)) continue;
      mainsForCombo.push(recipe);
      if (mainsForCombo.length >= 8) break;
    }
  }

  if (mode === "three_mains_only") {
    for (const trio of combinations(mainsForCombo, 3)) {
      const omeletteN = trio.filter((r) => r.slug.includes("omelette")).length;
      if (omeletteN >= 2) continue;
      if (trio.filter(isGrainMain).length >= 3) continue;
      if (sameProteinOverused(trio)) continue;
      if (priorities.proteinFocused && trio.filter(isLeanProteinMain).length === 0) continue;
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
    const snackPool = priorities.strictHighProtein
      ? snackPoolForMode.filter(isStrictProteinSnack)
      : snacksForCombo;
    for (const main1 of mainCandidates) {
      for (const triplet of combinations(snackPool.slice(0, 10), 3)) {
        if (!snackTripletValid(ctx, triplet)) continue;
        if (priorities.strictHighProtein) {
          if (!triplet.every(isStrictProteinSnack)) continue;
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

  scoredCombos.sort((a, b) => a.score - b.score);
  if (mode === "three_main_two_snacks" && scoredCombos.length > 90) {
    scoredCombos.length = 90;
  }

  const nearCandidates: Array<{ slotRecipes: Partial<Record<PlanSlot, Recipe>>; score: number }> =
    [];

  const preferLeanCarbs =
    priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;

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
        if (nearCandidates.length > (preferLeanCarbs ? 24 : 40)) nearCandidates.pop();
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
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        const handled = handleValid(day, slotRecipes);
        if (handled !== "continue") return handled;
      }
      recordAttempt(day, slotRecipes);
    }
  } else {
    for (const { slotRecipes } of scoredCombos) {
      const status = tryCombo(slotRecipes, true);
      if (status === "found") {
        const day = assemble(slotRecipes, { searchPhase: false });
        return { day, slotRecipes, diagnostics };
      }
      if (status === "stop") break;
    }
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
    const bestMacros = dayMacroNumbers(comboSearch.best.day);
    const diffP = Math.abs(bestMacros.protein_g - targets.protein_g.toNumber());
    const diffF = Math.abs(bestMacros.fat_g - targets.fat_g.toNumber());
    const diffC = Math.abs(bestMacros.carbs_g - targets.carbs_g.toNumber());
    const diffK = Math.abs(bestMacros.kcal - targets.kcal.toNumber());
    if (diffP <= 15 && diffF <= 10 && diffC <= 10 && diffK <= 10) {
      const polished = assemble(comboSearch.best.slotRecipes, { searchPhase: false });
      if (polished?.is_valid) {
        diagnostics.infeasible = false;
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
      return { day: polished, slotRecipes: comboSearch.best.slotRecipes, diagnostics };
    }
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
