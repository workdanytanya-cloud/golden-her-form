import {
  MAIN_RECIPE_REPEAT_DAYS,
  expectedMainCount,
  type MealScheduleMode,
  type PlanSlot,
  slotCalorieShare,
} from "@/lib/nutrition-constructor/config";
import { d, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";
import { analyzeMacroFailure } from "@/lib/nutrition-constructor/macro-solver";
import {
  macroPriorities,
  pickBestRecipe,
  scoreRecipeForSlot,
  slotMacroTargets,
  isProteinRichRecipe,
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
};

export type ComboSearchResult = {
  day: DayAssemblerResult;
  slotRecipes: Partial<Record<PlanSlot, Recipe>> | null;
  diagnostics: ComboSearchDiagnostics;
};

const MAIN_SHORTLIST = 8;
const SNACK_SHORTLIST = 6;
const maxCombinationsFor = (priorities: MacroPriorities, mode: MealScheduleMode) => {
  if (!priorities.proteinFocused) return 500;
  if (mode === "three_mains_only" || mode === "two_main_two_snacks") return 400;
  return priorities.strictHighProtein ? 350 : 450;
};
const DAY_SEARCH_TIMEOUT_MS = 28_000;

function isNearValid(day: NonNullable<DayAssemblerResult>, targets: MacroBreakdown): boolean {
  return (
    Math.abs(day.kcal - targets.kcal.toNumber()) <= 8 &&
    Math.abs(day.protein_g - targets.protein_g.toNumber()) <= 12 &&
    Math.abs(day.fat_g - targets.fat_g.toNumber()) <= 8 &&
    Math.abs(day.carbs_g - targets.carbs_g.toNumber()) <= 8
  );
}

function deviationScore(
  day: NonNullable<DayAssemblerResult>,
  targets: MacroBreakdown,
): number {
  return (
    Math.abs(day.kcal - targets.kcal.toNumber()) * 10 +
    Math.abs(day.protein_g - targets.protein_g.toNumber()) * 4 +
    Math.abs(day.fat_g - targets.fat_g.toNumber()) * 4 +
    Math.abs(day.carbs_g - targets.carbs_g.toNumber()) * 2
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
      const proteinBoost =
        priorities.proteinFocused && isProteinRichRecipe(ctx, recipe) ? -5 : 0;
      return {
        recipe,
        score: base + proteinBoost,
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
    (r) => r.contains_protein_source || isProteinRichRecipe(ctx, r) || r.slug.includes("tuna") || r.slug.includes("cheese"),
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

function filterRecentMains(pool: Recipe[], recentMain: Map<string, number>, dayIndex: number): Recipe[] {
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
}): ComboSearchResult {
  const {
    ctx,
    mode,
    dayIndex,
    targets,
    excluded,
    recentMain,
    mains,
    snacks,
    assemble,
  } = params;
  const timeoutMs = params.timeoutMs ?? DAY_SEARCH_TIMEOUT_MS;
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

  if (targets.protein_g.toNumber() > 180) {
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.infeasible = true;
    diagnostics.last_failure_reason = "недостижимый уровень белка для каталога";
    return { day: null, slotRecipes: null, diagnostics };
  }

  let best: {
    day: DayAssemblerResult;
    slotRecipes: Partial<Record<PlanSlot, Recipe>>;
    score: number;
  } | null = null;

  const timedOut = () => Date.now() - started >= timeoutMs;
  const recordAttempt = (day: DayAssemblerResult, slotRecipes: Partial<Record<PlanSlot, Recipe>>) => {
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
    if (!best || score < best.score) {
      best = { day, slotRecipes, score };
    }
    return { valid: false as const };
  };

  const mainPoolBase = priorities.proteinFocused
    ? mains.filter((r) => isProteinRichRecipe(ctx, r))
    : mains;
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
                    !r.slug.includes("avocado") &&
                    !r.slug.includes("walnut") &&
                    !r.slug.includes("almond") &&
                    !r.slug.includes("cheese"),
                )
              : snacks;
            const proteinFirst = preferCarbs
              ? [
                  ...strictProteinSnacks.filter((r) => !r.slug.includes("avocado")),
                  ...proteinSnackPool.filter((r) => pool.some((p) => p.id === r.id)),
                  ...pool.filter(
                    (r) =>
                      r.slug.includes("banana") ||
                      r.slug.includes("crispbread") ||
                      r.slug.includes("lavash") ||
                      r.slug.includes("corn") ||
                      r.slug.includes("apple"),
                  ),
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

  const comboLimit = maxCombinationsFor(priorities, mode);

  const tryCombo = (slotRecipes: Partial<Record<PlanSlot, Recipe>>, quick: boolean) => {
    if (diagnostics.combinations_checked >= comboLimit || timedOut()) return "stop" as const;
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
      score += scoreRecipeForSlot(
        ctx,
        recipe,
        slotMacroTargets(targets, shares[slot]),
        excluded,
        priorities,
        mealType,
      );
      if (priorities.proteinFocused && mealType === "snack") {
        if (priorities.strictHighProtein || priorities.lowCarb) {
          if (recipe.slug.includes("tuna")) score -= 20;
          else if (recipe.slug.includes("cheese")) score -= 8;
          else if (recipe.contains_protein_source) score -= 6;
        } else {
          if (recipe.slug.includes("crispbread") || recipe.slug.includes("lavash") || recipe.slug.includes("banana")) {
            score -= 10;
          }
          if (recipe.slug.includes("tuna") || recipe.contains_protein_source) score -= 8;
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
        mode === "three_main_two_snacks" ? 7 : mode === "three_mains_only" ? 10 : 8,
      )
    : mainShort;
  const snacksForCombo = priorities.proteinFocused
    ? snackPoolForMode.slice(0, mode === "one_main_three_snacks" ? 8 : 6)
    : snackShort;

  if (mode === "three_mains_only") {
    for (const trio of combinations(mainsForCombo, 3)) {
      scoredCombos.push({
        slotRecipes: { main1: trio[0], main2: trio[1], main3: trio[2] },
        score: comboScore({ main1: trio[0], main2: trio[1], main3: trio[2] }),
      });
    }
  } else if (mode === "three_main_two_snacks") {
    const s1 = snacksForCombo;
    const s2pool = snacksForCombo;
    const preferMixedCarbs = priorities.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb;
    for (const trio of combinations(mainsForCombo, 3)) {
      for (const snack1 of s1) {
        for (const snack2 of s2pool) {
          if (snack1.id === snack2.id) continue;
          if (priorities.strictHighProtein) {
            if (!isStrictProteinSnack(snack1) || !isStrictProteinSnack(snack2)) continue;
          } else if (priorities.proteinFocused) {
            const s1ok = isStrictProteinSnack(snack1) || snack1.contains_protein_source;
            const s2ok = isStrictProteinSnack(snack2) || snack2.contains_protein_source;
            if (!s1ok && !s2ok) continue;
            if (preferMixedCarbs) {
              const carbish = (r: Recipe) =>
                r.slug.includes("crispbread") ||
                r.slug.includes("lavash") ||
                r.slug.includes("banana") ||
                r.slug.includes("apple") ||
                r.slug.includes("corn");
              // Один белковый + один с углеводами (или оба с хлебцами/фруктом).
              if (!carbish(snack1) && !carbish(snack2) && !s1ok) continue;
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
    const snackPool =
      priorities.strictHighProtein ? snackPoolForMode : snacksForCombo;
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
          }
          const slotRecipes = { main1: pair[0], main2: pair[1], snack1, snack2 };
          scoredCombos.push({ slotRecipes, score: comboScore(slotRecipes) });
        }
      }
    }
  } else if (mode === "one_main_three_snacks") {
    const mainCandidates = mainsForCombo.slice(0, 10);
    const snackPool =
      priorities.strictHighProtein
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

  if (!(priorities.proteinFocused)) {
    scoredCombos.sort((a, b) => a.score - b.score);
  }

  const nearCandidates: Array<{ slotRecipes: Partial<Record<PlanSlot, Recipe>>; score: number }> = [];

  if (
    (mode === "three_mains_only" || mode === "two_main_two_snacks") &&
    priorities.proteinFocused
  ) {
    scoredCombos.sort((a, b) => a.score - b.score);
    for (const { slotRecipes } of scoredCombos) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        diagnostics.elapsed_ms = Date.now() - started;
        return { day, slotRecipes, diagnostics };
      }
      recordAttempt(day, slotRecipes);
    }
    diagnostics.elapsed_ms = Date.now() - started;
    diagnostics.timed_out = timedOut();
    diagnostics.infeasible = !best?.day?.is_valid;
    if (best?.day?.is_valid && best.slotRecipes) {
      return { day: best.day, slotRecipes: best.slotRecipes, diagnostics };
    }
    return { day: best?.day ?? null, slotRecipes: best?.slotRecipes ?? null, diagnostics };
  }

  if (priorities.proteinFocused) {
    for (const { slotRecipes } of scoredCombos) {
      if (timedOut() || diagnostics.combinations_checked >= comboLimit) break;
      diagnostics.combinations_checked++;
      const quickDay = assemble(slotRecipes, { searchPhase: true });
      if (!quickDay) continue;
      const carbWeight = priorities.lowCarb || priorities.strictHighProtein ? 1 : 2.5;
      const score =
        Math.abs(quickDay.kcal - targets.kcal.toNumber()) +
        Math.abs(quickDay.protein_g - targets.protein_g.toNumber()) * 3 +
        Math.abs(quickDay.fat_g - targets.fat_g.toNumber()) * 2 +
        Math.abs(quickDay.carbs_g - targets.carbs_g.toNumber()) * carbWeight;
      nearCandidates.push({ slotRecipes, score });
      nearCandidates.sort((a, b) => a.score - b.score);
      if (nearCandidates.length > 40) nearCandidates.pop();
      recordAttempt(quickDay, slotRecipes);
    }
    for (const { slotRecipes } of nearCandidates) {
      if (timedOut()) break;
      const day = assemble(slotRecipes, { searchPhase: false });
      diagnostics.combinations_checked++;
      if (day?.is_valid) {
        diagnostics.infeasible = false;
        diagnostics.elapsed_ms = Date.now() - started;
        return { day, slotRecipes, diagnostics };
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
  diagnostics.infeasible = !best?.day?.is_valid;

  if (best?.slotRecipes && best.day && !best.day.is_valid) {
    const diffP = Math.abs(best.day.protein_g - targets.protein_g.toNumber());
    const diffF = Math.abs(best.day.fat_g - targets.fat_g.toNumber());
    const diffC = Math.abs(best.day.carbs_g - targets.carbs_g.toNumber());
    const diffK = Math.abs(best.day.kcal - targets.kcal.toNumber());
    if (diffP <= 15 && diffF <= 10 && diffC <= 10 && diffK <= 10) {
      const polished = assemble(best.slotRecipes, { searchPhase: false });
      if (polished?.is_valid) {
        diagnostics.infeasible = false;
        return { day: polished, slotRecipes: best.slotRecipes, diagnostics };
      }
    }
  }

  if (best?.slotRecipes && best.day && !best.day.is_valid && isNearValid(best.day, targets)) {
    const polished = assemble(best.slotRecipes, { searchPhase: false });
    if (polished?.is_valid) {
      diagnostics.infeasible = false;
      return { day: polished, slotRecipes: best.slotRecipes, diagnostics };
    }
  }

  if (best?.day?.is_valid) {
    return { day: best.day, slotRecipes: best.slotRecipes, diagnostics };
  }

  return {
    day: best?.day ?? null,
    slotRecipes: best?.slotRecipes ?? null,
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
      pickBestRecipe(mainPool, ctx, slotMacroTargets(targets, shares.main1), excluded, priorities, "main", dayIndex) ??
      mainPool[0]!;
    const main2 =
      pickBestRecipe(mainPool, ctx, slotMacroTargets(targets, shares.main2), excluded, priorities, "main", dayIndex + 1, new Set([main1.id])) ??
      mainPool[1]!;
    const main3 =
      pickBestRecipe(mainPool, ctx, slotMacroTargets(targets, shares.main3), excluded, priorities, "main", dayIndex + 2, new Set([main1.id, main2.id])) ??
      mainPool[2]!;
    const snack1 =
      pickBestRecipe(snacks, ctx, slotMacroTargets(targets, shares.snack1), excluded, priorities, "snack", dayIndex) ??
      snacks[0]!;
    const snack2 =
      pickBestRecipe(snacks, ctx, slotMacroTargets(targets, shares.snack2), excluded, priorities, "snack", dayIndex + 1, new Set([snack1.id])) ??
      snacks[1]!;
    return { main1, main2, main3, snack1, snack2 };
  }

  return null;
}
