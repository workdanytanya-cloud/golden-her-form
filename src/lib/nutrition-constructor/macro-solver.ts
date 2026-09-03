import {
  GRAM_STEP,
  GRAM_STEP_COARSE,
  OIL_DAILY_MAX_G,
  OIL_GRAM_MIN,
  OIL_GRAM_MAX,
} from "@/lib/nutrition-constructor/config";
import {
  buildIngredientLine,
  buildMealPlanItem,
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  d,
  macroDiff,
  snapshotMacro,
  sumMacros,
  withinTolerance,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import {
  FAT_LEVER_SLUGS,
  OIL_PRODUCT_SLUGS,
  PROTEIN_MAIN_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import type { FoodProduct, MealPlanItem } from "@/lib/nutrition-constructor/types";
import type { DayBalanceContext } from "@/lib/nutrition-constructor/day-balance";

type MacroKey = "kcal" | "protein_g" | "fat_g" | "carbs_g";

type LeverRef = {
  itemIdx: number;
  ingIdx: number;
  slug: string | null;
  step: number;
  minG: number;
  maxG: number;
  baseG: number;
  perG: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
};

function productSlug(ctx: DayBalanceContext, productId: string): string | null {
  return ctx.products.get(productId)?.slug ?? null;
}

function gramStepForSlug(slug: string | null): number {
  if (!slug) return GRAM_STEP_COARSE;
  if (OIL_PRODUCT_SLUGS.has(slug) || slug === "hard-cheese") return GRAM_STEP;
  if (PROTEIN_MAIN_PRODUCT_SLUGS.has(slug) || slug.includes("-dry")) return GRAM_STEP_COARSE;
  return GRAM_STEP_COARSE;
}

function isOil(slug: string | null): boolean {
  return !!slug && OIL_PRODUCT_SLUGS.has(slug);
}

function dayOilTotalG(items: MealPlanItem[], ctx: DayBalanceContext): number {
  let total = 0;
  for (const item of items) {
    for (const ing of item.ingredients) {
      if (isOil(productSlug(ctx, ing.product_id))) {
        total += d(ing.grams).toNumber();
      }
    }
  }
  return total;
}

function boundsForIngredient(
  ctx: DayBalanceContext,
  item: MealPlanItem,
  productId: string,
  slug: string | null,
): { min_g: number; max_g: number } {
  const fromRecipe = ctx.recipeIngredients
    .get(item.recipe_id)
    ?.find((x) => x.product_id === productId);
  if (fromRecipe) return { min_g: fromRecipe.min_g, max_g: fromRecipe.max_g };
  if (slug && OIL_PRODUCT_SLUGS.has(slug)) return { min_g: 0, max_g: OIL_GRAM_MAX };
  return { min_g: 0, max_g: 600 };
}

function perGramFromProduct(p: FoodProduct): LeverRef["perG"] {
  return {
    kcal: p.kcal_per_100g / 100,
    protein_g: p.protein_per_100g / 100,
    fat_g: p.fat_per_100g / 100,
    carbs_g: p.carbs_per_100g / 100,
  };
}

function collectLevers(items: MealPlanItem[], ctx: DayBalanceContext): LeverRef[] {
  const levers: LeverRef[] = [];
  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx]!;
    for (let ingIdx = 0; ingIdx < item.ingredients.length; ingIdx++) {
      const ing = item.ingredients[ingIdx]!;
      const slug = productSlug(ctx, ing.product_id);
      if (slug === "butter") continue;
      const p = ctx.products.get(ing.product_id);
      if (!p || p.is_active_for_autogeneration === false) continue;
      const recipeIng = ctx.recipeIngredients
        .get(item.recipe_id)
        ?.find((x) => x.product_id === ing.product_id);
      if (recipeIng && !recipeIng.is_scalable) continue;
      const bounds = boundsForIngredient(ctx, item, ing.product_id, slug);
      const baseG =
        recipeIng?.default_g ??
        (recipeIng ? Math.round((recipeIng.min_g + recipeIng.max_g) / 2) : d(ing.grams).toNumber());
      levers.push({
        itemIdx,
        ingIdx,
        slug,
        step: gramStepForSlug(slug),
        minG: bounds.min_g,
        maxG: bounds.max_g,
        baseG,
        perG: perGramFromProduct(p),
      });
    }
  }
  return levers;
}

function totalsFromItems(items: MealPlanItem[]): MacroBreakdown {
  return sumMacros(
    items.map((i) => ({
      kcal: d(i.kcal),
      protein_g: d(i.protein_g),
      fat_g: d(i.fat_g),
      carbs_g: d(i.carbs_g),
      fiber_g: d(i.fiber_g),
    })),
  );
}

function snapToStep(value: number, step: number, minG: number, maxG: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.min(maxG, Math.max(minG, snapped));
}

function applyGrams(
  items: MealPlanItem[],
  ctx: DayBalanceContext,
  lever: LeverRef,
  nextG: number,
): MealPlanItem[] | null {
  const item = items[lever.itemIdx]!;
  const ing = item.ingredients[lever.ingIdx]!;
  const slug = lever.slug;
  const prevG = d(ing.grams).toNumber();
  if (nextG === prevG) return null;
  if (slug && isOil(slug) && nextG > 0 && nextG < OIL_GRAM_MIN) return null;
  if (slug && isOil(slug) && nextG > prevG) {
    if (dayOilTotalG(items, ctx) + (nextG - prevG) > OIL_DAILY_MAX_G) return null;
  }
  const product = ctx.products.get(ing.product_id);
  if (!product) return null;
  const newLine = buildIngredientLine(product, nextG, ing.sort_order);
  return items.map((it, idx) => {
    if (idx !== lever.itemIdx) return it;
    const newIngs = it.ingredients.map((x, i) => (i === lever.ingIdx ? newLine : x));
    const recipe = ctx.recipes.find((r) => r.id === it.recipe_id)!;
    return buildMealPlanItem({ slot: it.slot, recipe, ingredients: newIngs });
  });
}

function deviationScore(totals: MacroBreakdown, targets: MacroBreakdown): number {
  const diff = macroDiff(totals, targets);
  return (
    diff.kcal.toNumber() ** 2 * 10 +
    diff.protein_g.toNumber() ** 2 * 6 +
    diff.fat_g.toNumber() ** 2 * 6 +
    diff.carbs_g.toNumber() ** 2 * 3
  );
}

/** Solve (A^T A + λI) x = A^T b for small n. */
function solveNormalEq(A: number[][], b: number[], lambda: number): number[] | null {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  if (n === 0) return null;
  const ata: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const atb = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let r = 0; r < m; r++) s += A[r]![i]! * A[r]![j]!;
      ata[i]![j] = s + (i === j ? lambda : 0);
    }
    let sb = 0;
    for (let r = 0; r < m; r++) sb += A[r]![i]! * b[r]!;
    atb[i] = sb;
  }
  return gaussElim(ata, atb);
}

function gaussElim(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const div = M[col]![col]!;
    if (Math.abs(div) < 1e-12) return null;
    for (let j = col; j <= n; j++) M[col]![j]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r]![col]!;
      for (let j = col; j <= n; j++) M[r]![j]! -= factor * M[col]![j]!;
    }
  }
  return M.map((row) => row[n]!);
}

function buildMacroMatrix(
  levers: LeverRef[],
  weights: Record<MacroKey, number>,
): number[][] {
  const keys: MacroKey[] = ["kcal", "protein_g", "fat_g", "carbs_g"];
  return keys.map((k) => levers.map((l) => l.perG[k] * weights[k]!));
}

function applyBatchDeltas(
  items: MealPlanItem[],
  ctx: DayBalanceContext,
  levers: LeverRef[],
  currentGrams: number[],
  deltas: number[],
): MealPlanItem[] | null {
  let next = items;
  for (let i = 0; i < levers.length; i++) {
    const lever = levers[i]!;
    const targetG = snapToStep(currentGrams[i]! + deltas[i]!, lever.step, lever.minG, lever.maxG);
    const trial = applyGrams(next, ctx, lever, targetG);
    if (trial) next = trial;
  }
  return next;
}

export type MacroSolverResult = {
  items: MealPlanItem[];
  totals: MacroBreakdown;
  valid: boolean;
};

export function solveDayMacros(params: {
  ctx: DayBalanceContext;
  items: MealPlanItem[];
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  maxIterations?: number;
  enableFinishing?: boolean;
}): MacroSolverResult {
  const { ctx, targets, tolerance } = params;
  const enableFinishing = params.enableFinishing !== false;
  let items = params.items.map((i) => ({
    ...i,
    ingredients: i.ingredients.map((ing) => ({ ...ing })),
  }));
  let totals = totalsFromItems(items);
  const maxIter = params.maxIterations ?? 800;

  const weights = { kcal: 1.2, protein_g: 1, fat_g: 1, carbs_g: 0.85 };

  for (let iter = 0; iter < maxIter; iter++) {
    if (withinTolerance(totals, targets, tolerance)) break;

    const levers = collectLevers(items, ctx);
    if (levers.length === 0) break;

    const currentGrams = levers.map((l) => d(items[l.itemIdx]!.ingredients[l.ingIdx]!.grams).toNumber());
    const diff = macroDiff(totals, targets);
    const carbNeed = Math.abs(diff.carbs_g.toNumber());
    const fatNeed = Math.abs(diff.fat_g.toNumber());
    weights.carbs_g = carbNeed > 15 ? 1.8 : carbNeed > 5 ? 1.3 : 0.85;
    weights.fat_g = fatNeed > 10 ? 1.5 : 1;
    weights.protein_g = Math.abs(diff.protein_g.toNumber()) > 5 ? 1.4 : 1;
    const b = [
      diff.kcal.toNumber() * weights.kcal,
      diff.protein_g.toNumber() * weights.protein_g,
      diff.fat_g.toNumber() * weights.fat_g,
      diff.carbs_g.toNumber() * weights.carbs_g,
    ];

    const A = buildMacroMatrix(levers, weights);
    const lambda = 0.05 + iter * 0.0001;
    const dx = solveNormalEq(A, b, lambda);
    if (!dx) break;

    let improved = false;
    const scales = [1, 0.75, 0.5, 0.35, 0.2];
    for (const scale of scales) {
      const scaled = dx.map((v) => v * scale);
      const trial = applyBatchDeltas(items, ctx, levers, currentGrams, scaled);
      if (!trial) continue;
      const newTotals = totalsFromItems(trial);
      if (deviationScore(newTotals, targets) < deviationScore(totals, targets)) {
        items = trial;
        totals = newTotals;
        improved = true;
        break;
      }
    }

    if (!improved) {
      let best: { items: MealPlanItem[]; totals: MacroBreakdown; score: number } | null = null;
      for (let i = 0; i < levers.length; i++) {
        const lever = levers[i]!;
        const g = currentGrams[i]!;
        for (const delta of [lever.step, -lever.step, lever.step * 2, -lever.step * 2]) {
          const targetG = snapToStep(g + delta, lever.step, lever.minG, lever.maxG);
          const trial = applyGrams(items, ctx, lever, targetG);
          if (!trial) continue;
          const newTotals = totalsFromItems(trial);
          const score = deviationScore(newTotals, targets);
          if (!best || score < best.score) best = { items: trial, totals: newTotals, score };
        }
      }
      if (best && best.score < deviationScore(totals, targets)) {
        items = best.items;
        totals = best.totals;
        improved = true;
      }
    }

    if (!improved) break;
  }

  // Финальная полировка при близости к цели: парные шаги ±1–2 г
  const diff = macroDiff(totals, targets);
  const closeEnough =
    diff.kcal.abs().toNumber() <= 15 &&
    diff.protein_g.abs().toNumber() <= 15 &&
    diff.fat_g.abs().toNumber() <= 10 &&
    diff.carbs_g.abs().toNumber() <= 10;

  if (closeEnough && enableFinishing) {
    const levers = collectLevers(items, ctx)
      .map((l) => {
        const g = d(items[l.itemIdx]!.ingredients[l.ingIdx]!.grams).toNumber();
        const headroom = Math.min(g - l.minG, l.maxG - g);
        const sensitivity =
          l.perG.protein_g * weights.protein_g +
          l.perG.fat_g * weights.fat_g +
          l.perG.carbs_g * weights.carbs_g;
        return { l, headroom, sensitivity };
      })
      .sort((a, b) => b.sensitivity - a.sensitivity || a.headroom - b.headroom)
      .slice(0, 12)
      .map((x) => x.l);

    for (let pass = 0; pass < 48; pass++) {
      if (withinTolerance(totals, targets, tolerance)) break;
      let bestLocal: { items: MealPlanItem[]; totals: MacroBreakdown; score: number } | null = null;
      for (let i = 0; i < levers.length; i++) {
        for (let j = i + 1; j < levers.length; j++) {
          const li = levers[i]!;
          const lj = levers[j]!;
          const gi = d(items[li.itemIdx]!.ingredients[li.ingIdx]!.grams).toNumber();
          const gj = d(items[lj.itemIdx]!.ingredients[lj.ingIdx]!.grams).toNumber();
          for (const di of [-2, -1, 1, 2]) {
            for (const dj of [-2, -1, 1, 2]) {
              if (di === 0 && dj === 0) continue;
              let trial = applyGrams(items, ctx, li, snapToStep(gi + di, 1, li.minG, li.maxG));
              if (!trial) continue;
              trial = applyGrams(trial, ctx, lj, snapToStep(gj + dj, 1, lj.minG, lj.maxG));
              if (!trial) continue;
              const newTotals = totalsFromItems(trial);
              const score = deviationScore(newTotals, targets);
              if (!bestLocal || score < bestLocal.score) {
                bestLocal = { items: trial, totals: newTotals, score };
              }
            }
          }
        }
      }
      if (bestLocal && bestLocal.score < deviationScore(totals, targets)) {
        items = bestLocal.items;
        totals = bestLocal.totals;
      } else break;
    }
  }

  // Агрессивный обмен жир→углеводы при сильном дисбалансе
  if (enableFinishing) {
    const d0 = macroDiff(totals, targets);
    if (d0.fat_g.toNumber() > 8 && d0.carbs_g.toNumber() < -15) {
      const levers = collectLevers(items, ctx);
      const fatLevers = levers.filter(
        (l) => l.perG.fat_g >= 0.3 || isOil(l.slug) || l.slug === "hard-cheese" || l.slug === "avocado",
      );
      const carbLevers = levers.filter(
        (l) =>
          l.perG.carbs_g >= 0.4 ||
          (l.slug?.includes("-dry") ?? false) ||
          l.slug === "crispbread" ||
          l.slug === "lavash" ||
          l.slug === "banana",
      );
      for (let pass = 0; pass < 60; pass++) {
        if (withinTolerance(totals, targets, tolerance)) break;
        const diffNow = macroDiff(totals, targets);
        if (diffNow.fat_g.toNumber() <= 1 && diffNow.carbs_g.toNumber() >= -1) break;
        let improved = false;
        for (const fl of fatLevers) {
          for (const cl of carbLevers) {
            const gf = d(items[fl.itemIdx]!.ingredients[fl.ingIdx]!.grams).toNumber();
            const gc = d(items[cl.itemIdx]!.ingredients[cl.ingIdx]!.grams).toNumber();
            let trial = applyGrams(items, ctx, fl, snapToStep(gf - 5, 1, fl.minG, fl.maxG));
            if (!trial) continue;
            trial = applyGrams(trial, ctx, cl, snapToStep(gc + 8, 1, cl.minG, cl.maxG));
            if (!trial) continue;
            const newTotals = totalsFromItems(trial);
            if (deviationScore(newTotals, targets) < deviationScore(totals, targets)) {
              items = trial;
              totals = newTotals;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (!improved) break;
      }
    }
  }

  if (!withinTolerance(totals, targets, tolerance) && enableFinishing) {
    const diff2 = macroDiff(totals, targets);
    const maxDiff = Math.max(
      diff2.kcal.abs().toNumber() / 5,
      diff2.protein_g.abs().toNumber(),
      diff2.fat_g.abs().toNumber(),
      diff2.carbs_g.abs().toNumber(),
    );
    if (maxDiff <= 8) {
      const levers = collectLevers(items, ctx).slice(0, 18);
      for (let pass = 0; pass < 120; pass++) {
        if (withinTolerance(totals, targets, tolerance)) break;
        let improved = false;
        for (const li of levers) {
          for (const di of [-4, -2, -1, 1, 2, 4]) {
            const gi = d(items[li.itemIdx]!.ingredients[li.ingIdx]!.grams).toNumber();
            const trial = applyGrams(items, ctx, li, snapToStep(gi + di, 1, li.minG, li.maxG));
            if (!trial) continue;
            const newTotals = totalsFromItems(trial);
            if (deviationScore(newTotals, targets) < deviationScore(totals, targets)) {
              items = trial;
              totals = newTotals;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (!improved) break;
      }
    }
  }

  const snap = snapshotMacro(totals);
  return {
    items,
    totals: {
      kcal: d(snap.kcal),
      protein_g: d(snap.protein_g),
      fat_g: d(snap.fat_g),
      carbs_g: d(snap.carbs_g),
      fiber_g: d(snap.fiber_g),
    },
    valid: withinTolerance(totals, targets, tolerance),
  };
}

export function analyzeMacroFailure(
  totals: MacroBreakdown,
  targets: MacroBreakdown,
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number },
): string {
  const diff = macroDiff(totals, targets);
  const parts: string[] = [];
  if (Math.abs(diff.kcal.toNumber()) > tolerance.kcal) {
    parts.push(
      diff.kcal.toNumber() > 0
        ? `избыток калорий (+${diff.kcal.toFixed(0)} ккал)`
        : `недобор калорий (${diff.kcal.toFixed(0)} ккал)`,
    );
  }
  if (Math.abs(diff.protein_g.toNumber()) > tolerance.protein_g) {
    parts.push(
      diff.protein_g.toNumber() > 0
        ? `избыток белка (+${diff.protein_g.toFixed(1)} г)`
        : `недобор белка (${diff.protein_g.toFixed(1)} г)`,
    );
  }
  if (Math.abs(diff.fat_g.toNumber()) > tolerance.fat_g) {
    parts.push(
      diff.fat_g.toNumber() > 0
        ? `избыток жиров (+${diff.fat_g.toFixed(1)} г)`
        : `недобор жиров (${diff.fat_g.toFixed(1)} г)`,
    );
  }
  if (Math.abs(diff.carbs_g.toNumber()) > tolerance.carbs_g) {
    parts.push(
      diff.carbs_g.toNumber() > 0
        ? `избыток углеводов (+${diff.carbs_g.toFixed(1)} г)`
        : `недобор углеводов (${diff.carbs_g.toFixed(1)} г)`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : "достигнуты границы порций";
}
