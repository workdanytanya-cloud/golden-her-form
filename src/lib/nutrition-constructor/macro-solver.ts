import {
  GRAM_STEP,
  GRAM_STEP_COARSE,
  OIL_DAILY_MAX_G,
  OIL_GRAM_MAX,
} from "@/lib/nutrition-constructor/config";
import {
  buildIngredientLine,
  buildMealPlanItem,
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  d,
  finiteMacroNumber,
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
    kcal: finiteMacroNumber(p.kcal_per_100g) / 100,
    protein_g: finiteMacroNumber(p.protein_per_100g) / 100,
    fat_g: finiteMacroNumber(p.fat_per_100g) / 100,
    carbs_g: finiteMacroNumber(p.carbs_per_100g) / 100,
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

/** Когда уже близко к допуску — штрафуем только выход за tolerance. */
function finishingViolationScore(
  totals: MacroBreakdown,
  targets: MacroBreakdown,
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number },
): number {
  const diff = macroDiff(totals, targets);
  const over = (v: number, tol: number) => Math.max(0, Math.abs(v) - tol);
  return (
    over(diff.kcal.toNumber(), tolerance.kcal) * 20 +
    over(diff.protein_g.toNumber(), tolerance.protein_g) * 100 +
    over(diff.fat_g.toNumber(), tolerance.fat_g) * 100 +
    over(diff.carbs_g.toNumber(), tolerance.carbs_g) * 100
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

function buildMacroMatrix(levers: LeverRef[], weights: Record<MacroKey, number>): number[][] {
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

function projectDayPortions(params: {
  ctx: DayBalanceContext;
  items: MealPlanItem[];
  targets: MacroBreakdown;
}): MealPlanItem[] | null {
  const levers = collectLevers(params.items, params.ctx);
  if (levers.length === 0) return null;
  const grams = levers.map((lever) =>
    d(params.items[lever.itemIdx]!.ingredients[lever.ingIdx]!.grams).toNumber(),
  );
  const current = totalsFromItems(params.items);
  const base = {
    kcal: current.kcal.toNumber(),
    protein_g: current.protein_g.toNumber(),
    fat_g: current.fat_g.toNumber(),
    carbs_g: current.carbs_g.toNumber(),
  };
  for (let i = 0; i < levers.length; i++) {
    const per = levers[i]!.perG;
    const amount = grams[i]!;
    base.kcal -= per.kcal * amount;
    base.protein_g -= per.protein_g * amount;
    base.fat_g -= per.fat_g * amount;
    base.carbs_g -= per.carbs_g * amount;
  }
  const goal = {
    kcal: params.targets.kcal.toNumber(),
    protein_g: params.targets.protein_g.toNumber(),
    fat_g: params.targets.fat_g.toNumber(),
    carbs_g: params.targets.carbs_g.toNumber(),
  };
  const next = grams.slice();
  for (let iter = 0; iter < 300; iter++) {
    const pred = { ...base };
    let oil = 0;
    for (let i = 0; i < levers.length; i++) {
      const per = levers[i]!.perG;
      const amount = next[i]!;
      pred.kcal += per.kcal * amount;
      pred.protein_g += per.protein_g * amount;
      pred.fat_g += per.fat_g * amount;
      pred.carbs_g += per.carbs_g * amount;
      if (isOil(levers[i]!.slug)) oil += amount;
    }
    const err = {
      kcal: pred.kcal - goal.kcal,
      protein_g: (pred.protein_g - goal.protein_g) * 8,
      fat_g: (pred.fat_g - goal.fat_g) * 8,
      carbs_g: (pred.carbs_g - goal.carbs_g) * 8,
    };
    if (
      Math.abs(pred.kcal - goal.kcal) <= 5 &&
      Math.abs(pred.protein_g - goal.protein_g) <= 1 &&
      Math.abs(pred.fat_g - goal.fat_g) <= 1 &&
      Math.abs(pred.carbs_g - goal.carbs_g) <= 1
    ) {
      break;
    }
    let magnitude = 0;
    const grad = next.map((_, i) => {
      const per = levers[i]!.perG;
      const value = per.kcal * err.kcal + per.protein_g * err.protein_g + per.fat_g * err.fat_g + per.carbs_g * err.carbs_g;
      magnitude = Math.max(magnitude, Math.abs(value));
      return value;
    });
    if (magnitude < 1e-8) break;
    const rate = 12 / magnitude;
    for (let i = 0; i < next.length; i++) {
      const lever = levers[i]!;
      next[i] = Math.min(lever.maxG, Math.max(lever.minG, next[i]! - rate * grad[i]!));
    }
    if (oil > OIL_DAILY_MAX_G) {
      const scale = OIL_DAILY_MAX_G / oil;
      for (let i = 0; i < next.length; i++) {
        if (isOil(levers[i]!.slug)) next[i] = Math.max(levers[i]!.minG, next[i]! * scale);
      }
    }
  }
  const predict = () => {
    const pred = { ...base };
    let oilGrams = 0;
    for (let i = 0; i < next.length; i++) {
      const per = levers[i]!.perG;
      const amount = next[i]!;
      pred.kcal += per.kcal * amount;
      pred.protein_g += per.protein_g * amount;
      pred.fat_g += per.fat_g * amount;
      pred.carbs_g += per.carbs_g * amount;
      if (isOil(levers[i]!.slug)) oilGrams += amount;
    }
    return { pred, oilGrams };
  };
  const violation = (pred: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }) => {
    const soft = (value: number, tol: number, weight: number) => {
      const abs = Math.abs(value);
      return abs <= tol ? abs * weight : tol * weight + (abs - tol) * weight * 25;
    };
    return (
      soft(pred.kcal - goal.kcal, 5, 1) +
      soft(pred.protein_g - goal.protein_g, 1, 8) +
      soft(pred.fat_g - goal.fat_g, 1, 8) +
      soft(pred.carbs_g - goal.carbs_g, 1, 8)
    );
  };
  const insideTol = (pred: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }) =>
    Math.abs(pred.kcal - goal.kcal) <= 5 &&
    Math.abs(pred.protein_g - goal.protein_g) <= 1 &&
    Math.abs(pred.fat_g - goal.fat_g) <= 1 &&
    Math.abs(pred.carbs_g - goal.carbs_g) <= 1;
  const rankLever = (key: "protein_g" | "fat_g" | "carbs_g") =>
    levers.map((_, index) => index).sort((a, b) => levers[b]!.perG[key] - levers[a]!.perG[key]);
  const byProtein = rankLever("protein_g");
  const byFat = rankLever("fat_g");
  const byCarb = rankLever("carbs_g");
  const oilIndex = levers.findIndex((lever) => isOil(lever.slug));
  const quartets = [
    [byProtein[0], byFat[0], byCarb[0], oilIndex],
    [byProtein[0], byProtein[1], byFat[0], byCarb[0]],
    [byProtein[0], byFat[0], byCarb[0], byCarb[1]],
    [byProtein[0], byFat[1], byCarb[0], oilIndex],
    [byProtein[1], byFat[0], byCarb[1], oilIndex],
  ];
  const saved = next.slice();
  let exactHit = insideTol(predict().pred);
  if (!exactHit) {
    const keys = ["kcal", "protein_g", "fat_g", "carbs_g"] as const;
    let fixed = new Set<number>();
    const guess = levers.map((lever) => (lever.minG + lever.maxG) / 2);
    for (let iter = 0; iter < 8; iter++) {
      const free = levers.map((_, index) => index).filter((index) => !fixed.has(index));
      if (free.length === 0) break;
      const locked = { ...base };
      for (const index of fixed) {
        const per = levers[index]!.perG;
        const amount = guess[index]!;
        locked.kcal += per.kcal * amount;
        locked.protein_g += per.protein_g * amount;
        locked.fat_g += per.fat_g * amount;
        locked.carbs_g += per.carbs_g * amount;
      }
      const matrix = keys.map((key) => free.map((index) => levers[index]!.perG[key]));
      const solved = solveNormalEq(
        matrix,
        [
          goal.kcal - locked.kcal,
          goal.protein_g - locked.protein_g,
          goal.fat_g - locked.fat_g,
          goal.carbs_g - locked.carbs_g,
        ],
        1e-8,
      );
      if (!solved) break;
      let clamped = false;
      solved.forEach((value, key) => {
        const index = free[key]!;
        const lever = levers[index]!;
        if (value < lever.minG - 0.05) {
          guess[index] = lever.minG;
          fixed.add(index);
          clamped = true;
        } else if (value > lever.maxG + 0.05) {
          guess[index] = lever.maxG;
          fixed.add(index);
          clamped = true;
        } else {
          guess[index] = value;
        }
      });
      if (!clamped) break;
    }
    for (let i = 0; i < next.length; i++) next[i] = guess[i]!;
    const seen = predict();
    if (seen.oilGrams <= OIL_DAILY_MAX_G + 0.01 && insideTol(seen.pred)) exactHit = true;
    else if (seen.oilGrams <= OIL_DAILY_MAX_G + 0.01) {
      const lsScore = violation(seen.pred);
      const lsGrams = next.slice();
      for (let i = 0; i < next.length; i++) next[i] = saved[i]!;
      if (lsScore < violation(predict().pred)) {
        for (let i = 0; i < next.length; i++) {
          saved[i] = lsGrams[i]!;
          next[i] = lsGrams[i]!;
        }
      }
    }
  }
  if (!exactHit) {
    for (const raw of quartets) {
      const indices = [...new Set(raw.filter((index): index is number => index != null && index >= 0))];
      if (indices.length !== 4) continue;
      for (const baseline of [saved, levers.map((lever) => lever.minG)]) {
        for (let i = 0; i < next.length; i++) next[i] = baseline[i]!;
        const fixed = { ...base };
        for (let i = 0; i < next.length; i++) {
          if (indices.includes(i)) continue;
          const per = levers[i]!.perG;
          const amount = next[i]!;
          fixed.kcal += per.kcal * amount;
          fixed.protein_g += per.protein_g * amount;
          fixed.fat_g += per.fat_g * amount;
          fixed.carbs_g += per.carbs_g * amount;
        }
        const matrix = (["kcal", "protein_g", "fat_g", "carbs_g"] as const).map((key) =>
          indices.map((index) => levers[index]!.perG[key]),
        );
        const solved = gaussElim(matrix, [
          goal.kcal - fixed.kcal,
          goal.protein_g - fixed.protein_g,
          goal.fat_g - fixed.fat_g,
          goal.carbs_g - fixed.carbs_g,
        ]);
        if (!solved) continue;
        const inBounds = solved.every((value, key) => {
          const lever = levers[indices[key]!]!;
          return value >= lever.minG - 0.05 && value <= lever.maxG + 0.05;
        });
        if (!inBounds) continue;
        solved.forEach((value, key) => {
          const lever = levers[indices[key]!]!;
          next[indices[key]!] = Math.min(lever.maxG, Math.max(lever.minG, value));
        });
        const seen = predict();
        if (seen.oilGrams <= OIL_DAILY_MAX_G + 0.01 && insideTol(seen.pred)) {
          exactHit = true;
          break;
        }
      }
      if (exactHit) break;
    }
  }
  if (!exactHit) {
    for (let i = 0; i < next.length; i++) next[i] = saved[i]!;
  }
  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (let i = 0; i < next.length; i++) {
      const lever = levers[i]!;
      const current = next[i]!;
      const seenNow = predict().pred;
      if (
        Math.abs(seenNow.kcal - goal.kcal) <= 5 &&
        Math.abs(seenNow.protein_g - goal.protein_g) <= 1 &&
        Math.abs(seenNow.fat_g - goal.fat_g) <= 1 &&
        Math.abs(seenNow.carbs_g - goal.carbs_g) <= 1
      ) {
        continue;
      }
      let best = current;
      let bestScore = violation(seenNow);
      for (const delta of [-8, -5, -3, -2, -1, 1, 2, 3, 5, 8]) {
        const trialG = Math.min(lever.maxG, Math.max(lever.minG, Math.round(current + delta)));
        next[i] = trialG;
        const seen = predict();
        if (seen.oilGrams > OIL_DAILY_MAX_G + 0.01) continue;
        const score = violation(seen.pred);
        if (score < bestScore) {
          bestScore = score;
          best = trialG;
          improved = true;
        }
      }
      next[i] = best;
    }
    if (!improved) break;
  }
  const seedTotals = predict().pred;
  const worthJoint =
    Math.abs(seedTotals.kcal - goal.kcal) < 90 &&
    Math.abs(seedTotals.protein_g - goal.protein_g) < 14 &&
    Math.abs(seedTotals.fat_g - goal.fat_g) < 14 &&
    Math.abs(seedTotals.carbs_g - goal.carbs_g) < 18;
  if (worthJoint) {
    for (let pass = 0; pass < 2; pass++) {
      const seenNow = predict().pred;
      if (
        Math.abs(seenNow.kcal - goal.kcal) <= 5 &&
        Math.abs(seenNow.protein_g - goal.protein_g) <= 1 &&
        Math.abs(seenNow.fat_g - goal.fat_g) <= 1 &&
        Math.abs(seenNow.carbs_g - goal.carbs_g) <= 1
      ) {
        break;
      }
      let improved = false;
      let bestScore = violation(seenNow);
      for (let i = 0; i < next.length; i++) {
        for (let j = 0; j < next.length; j++) {
          if (i === j) continue;
          const left = levers[i]!;
          const right = levers[j]!;
          if (left.perG.kcal < 0.2 || right.perG.kcal < 0.2) continue;
          for (const cut of [2, 4, 6, 8]) {
            const add = (left.perG.kcal * cut) / right.perG.kcal;
            const prevLeft = next[i]!;
            const prevRight = next[j]!;
            next[i] = Math.min(left.maxG, Math.max(left.minG, Math.round(prevLeft - cut)));
            next[j] = Math.min(right.maxG, Math.max(right.minG, Math.round(prevRight + add)));
            const seen = predict();
            const score = seen.oilGrams > OIL_DAILY_MAX_G + 0.01 ? Number.POSITIVE_INFINITY : violation(seen.pred);
            if (score < bestScore) {
              bestScore = score;
              improved = true;
            } else {
              next[i] = prevLeft;
              next[j] = prevRight;
            }
          }
        }
      }
      if (!improved) break;
    }
  }
  let applied = params.items;
  for (let i = 0; i < levers.length; i++) {
    const lever = levers[i]!;
    const rounded = snapToStep(next[i]!, 1, lever.minG, lever.maxG);
    const trial = applyGrams(applied, params.ctx, lever, rounded);
    if (trial) applied = trial;
  }
  return applied;
}

export function fitDayItems(params: {
  ctx: DayBalanceContext;
  items: MealPlanItem[];
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  passes?: number;
}): { items: MealPlanItem[]; totals: MacroBreakdown; valid: boolean } {
  const projected = projectDayPortions(params) ?? params.items;
  let items = projected;
  let totals = totalsFromItems(items);
  const close =
    Math.abs(totals.kcal.toNumber() - params.targets.kcal.toNumber()) <= 18 &&
    Math.abs(totals.protein_g.toNumber() - params.targets.protein_g.toNumber()) <= 4 &&
    Math.abs(totals.fat_g.toNumber() - params.targets.fat_g.toNumber()) <= 4 &&
    Math.abs(totals.carbs_g.toNumber() - params.targets.carbs_g.toNumber()) <= 4;
  for (
    let pass = 0;
    pass < (close ? (params.passes ?? 2) : 0) &&
    !withinTolerance(totals, params.targets, params.tolerance);
    pass++
  ) {
    let best: { items: MealPlanItem[]; totals: MacroBreakdown; score: number } | null = null;
    const base = finishingViolationScore(totals, params.targets, params.tolerance);
    for (const lever of collectLevers(items, params.ctx)) {
      const grams = d(items[lever.itemIdx]!.ingredients[lever.ingIdx]!.grams).toNumber();
      for (const delta of [-4, -2, -1, 1, 2, 4]) {
        const trial = applyGrams(
          items,
          params.ctx,
          lever,
          snapToStep(grams + delta, 1, lever.minG, lever.maxG),
        );
        if (!trial) continue;
        const nextTotals = totalsFromItems(trial);
        const score = finishingViolationScore(nextTotals, params.targets, params.tolerance);
        if (score < base && (!best || score < best.score)) {
          best = { items: trial, totals: nextTotals, score };
        }
      }
    }
    if (!best) break;
    items = best.items;
    totals = best.totals;
  }
  return {
    items,
    totals,
    valid: withinTolerance(totals, params.targets, params.tolerance),
  };
}

function climbFromMinimum(params: {
  ctx: DayBalanceContext;
  items: MealPlanItem[];
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
}): { items: MealPlanItem[]; totals: MacroBreakdown } {
  let items = params.items;
  let levers = collectLevers(items, params.ctx);
  for (const lever of levers) {
    const next = applyGrams(items, params.ctx, lever, lever.minG);
    if (next) items = next;
  }
  let totals = totalsFromItems(items);
  for (let step = 0; step < 120; step++) {
    if (withinTolerance(totals, params.targets, params.tolerance)) break;
    levers = collectLevers(items, params.ctx);
    const gap = macroDiff(params.targets, totals);
    const need = {
      kcal: gap.kcal.toNumber() / 40,
      protein_g: gap.protein_g.toNumber() / 3,
      fat_g: gap.fat_g.toNumber() / 3,
      carbs_g: gap.carbs_g.toNumber() / 6,
    };
    let best: { lever: LeverRef; score: number; delta: number } | null = null;
    for (const lever of levers) {
      const grams = d(items[lever.itemIdx]!.ingredients[lever.ingIdx]!.grams).toNumber();
      const align =
        lever.perG.kcal * need.kcal +
        lever.perG.protein_g * need.protein_g +
        lever.perG.fat_g * need.fat_g +
        lever.perG.carbs_g * need.carbs_g;
      if (grams < lever.maxG - 0.01 && (!best || align > best.score)) {
        best = { lever, score: align, delta: lever.step };
      }
      if (grams > lever.minG + 0.01 && (!best || -align > best.score)) {
        best = { lever, score: -align, delta: -lever.step };
      }
    }
    if (!best || best.score <= 0) break;
    const grams = d(items[best.lever.itemIdx]!.ingredients[best.lever.ingIdx]!.grams).toNumber();
    const next = applyGrams(
      items,
      params.ctx,
      best.lever,
      snapToStep(grams + best.delta, best.lever.step, best.lever.minG, best.lever.maxG),
    );
    if (!next) break;
    items = next;
    totals = totalsFromItems(items);
  }
  return { items, totals };
}

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
  const seeded = params.items.map((i) => ({
    ...i,
    ingredients: i.ingredients.map((ing) => ({ ...ing })),
  }));
  const seededTotals = totalsFromItems(seeded);
  const climbed = climbFromMinimum({
    ctx,
    items: params.items.map((i) => ({
      ...i,
      ingredients: i.ingredients.map((ing) => ({ ...ing })),
    })),
    targets,
    tolerance,
  });
  const useClimb =
    deviationScore(climbed.totals, targets) < deviationScore(seededTotals, targets);
  let items = useClimb ? climbed.items : seeded;
  let totals = useClimb ? climbed.totals : seededTotals;
  const maxIter = params.maxIterations ?? 800;

  const weights = { kcal: 1.2, protein_g: 1, fat_g: 1, carbs_g: 0.85 };
  const projected = projectDayPortions({ ctx, items, targets });
  if (projected) {
    const projectedTotals = totalsFromItems(projected);
    if (
      withinTolerance(projectedTotals, targets, tolerance) ||
      deviationScore(projectedTotals, targets) < deviationScore(totals, targets)
    ) {
      items = projected;
      totals = projectedTotals;
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    if (withinTolerance(totals, targets, tolerance)) break;

    const levers = collectLevers(items, ctx);
    if (levers.length === 0) break;

    const currentGrams = levers.map((l) =>
      d(items[l.itemIdx]!.ingredients[l.ingIdx]!.grams).toNumber(),
    );
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
        (l) =>
          l.perG.fat_g >= 0.3 || isOil(l.slug) || l.slug === "hard-cheese" || l.slug === "avocado",
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

  // Обмен жир→белок при недоборе белка и избытке жира (типично для 1800).
  if (enableFinishing) {
    const d1 = macroDiff(totals, targets);
    if (d1.fat_g.toNumber() > 5 && d1.protein_g.toNumber() < -5) {
      const levers = collectLevers(items, ctx);
      const fatLevers = levers.filter(
        (l) =>
          l.perG.fat_g >= 0.25 ||
          isOil(l.slug) ||
          l.slug === "hard-cheese" ||
          l.slug === "avocado" ||
          l.slug === "beef-lean-raw",
      );
      const proteinLevers = levers.filter(
        (l) =>
          PROTEIN_MAIN_PRODUCT_SLUGS.has(l.slug ?? "") ||
          l.slug === "canned-tuna" ||
          l.slug === "chicken-breast-raw" ||
          l.slug === "pollock-raw",
      );
      for (let pass = 0; pass < 50; pass++) {
        if (withinTolerance(totals, targets, tolerance)) break;
        const diffNow = macroDiff(totals, targets);
        if (diffNow.protein_g.toNumber() >= -1 && diffNow.fat_g.toNumber() <= 1) break;
        let improved = false;
        for (const fl of fatLevers) {
          for (const pl of proteinLevers) {
            if (fl.itemIdx === pl.itemIdx && fl.ingIdx === pl.ingIdx) continue;
            const gf = d(items[fl.itemIdx]!.ingredients[fl.ingIdx]!.grams).toNumber();
            const gp = d(items[pl.itemIdx]!.ingredients[pl.ingIdx]!.grams).toNumber();
            let trial = applyGrams(items, ctx, fl, snapToStep(gf - 5, 1, fl.minG, fl.maxG));
            if (!trial) continue;
            trial = applyGrams(trial, ctx, pl, snapToStep(gp + 10, 1, pl.minG, pl.maxG));
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

  // Обмен белок→жир при избытке белка и недоборе жира (lean 1800 + масло).
  if (enableFinishing) {
    const d2 = macroDiff(totals, targets);
    if (d2.protein_g.toNumber() > 2 && d2.fat_g.toNumber() < -0.5) {
      const levers = collectLevers(items, ctx);
      const proteinLevers = levers.filter(
        (l) =>
          PROTEIN_MAIN_PRODUCT_SLUGS.has(l.slug ?? "") ||
          l.slug === "canned-tuna" ||
          l.slug === "chicken-breast-raw" ||
          l.slug === "pollock-raw",
      );
      const fatLevers = levers.filter(
        (l) =>
          isOil(l.slug) ||
          l.slug === "hard-cheese" ||
          l.slug === "avocado" ||
          l.slug === "egg-whole",
      );
      for (let pass = 0; pass < 80; pass++) {
        if (withinTolerance(totals, targets, tolerance)) break;
        const diffNow = macroDiff(totals, targets);
        if (diffNow.protein_g.toNumber() <= 1 && diffNow.fat_g.toNumber() >= -1) break;
        let improved = false;
        for (const pl of proteinLevers) {
          for (const fl of fatLevers) {
            const gp = d(items[pl.itemIdx]!.ingredients[pl.ingIdx]!.grams).toNumber();
            const gf = d(items[fl.itemIdx]!.ingredients[fl.ingIdx]!.grams).toNumber();
            for (const [dp, df] of [
              [-5, 2],
              [-10, 3],
              [-5, 1],
              [-5, 3],
            ] as const) {
              let trial = applyGrams(items, ctx, pl, snapToStep(gp + dp, 1, pl.minG, pl.maxG));
              if (!trial) continue;
              trial = applyGrams(trial, ctx, fl, snapToStep(gf + df, 1, fl.minG, fl.maxG));
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
          if (improved) break;
        }
        if (!improved) break;
      }
    }
  }

  // Подрезка избытка белка, когда жир/углеводы уже близко.
  if (enableFinishing) {
    const d3 = macroDiff(totals, targets);
    if (
      d3.protein_g.toNumber() > 1 &&
      Math.abs(d3.fat_g.toNumber()) <= 4 &&
      Math.abs(d3.carbs_g.toNumber()) <= 6 &&
      Math.abs(d3.kcal.toNumber()) <= 30
    ) {
      const levers = collectLevers(items, ctx);
      const proteinLevers = levers.filter(
        (l) =>
          l.slug === "canned-tuna" ||
          l.slug === "chicken-breast-raw" ||
          l.slug === "pollock-raw" ||
          l.slug === "egg-whole" ||
          l.slug === "hard-cheese",
      );
      const fillLevers = levers.filter(
        (l) =>
          isOil(l.slug) ||
          l.slug === "crispbread" ||
          l.slug === "lavash" ||
          l.slug?.includes("-dry") ||
          l.slug === "banana" ||
          l.slug === "avocado",
      );
      for (let pass = 0; pass < 80; pass++) {
        if (withinTolerance(totals, targets, tolerance)) break;
        const baseViolation = finishingViolationScore(totals, targets, tolerance);
        let improved = false;
        for (const pl of proteinLevers) {
          const gp = d(items[pl.itemIdx]!.ingredients[pl.ingIdx]!.grams).toNumber();
          for (const dp of [-1, -2, -5, -10]) {
            const trial = applyGrams(items, ctx, pl, snapToStep(gp + dp, 1, pl.minG, pl.maxG));
            if (!trial) continue;
            let newTotals = totalsFromItems(trial);
            if (finishingViolationScore(newTotals, targets, tolerance) < baseViolation) {
              items = trial;
              totals = newTotals;
              improved = true;
              break;
            }
            for (const fl of fillLevers) {
              if (fl.itemIdx === pl.itemIdx && fl.ingIdx === pl.ingIdx) continue;
              const gf = d(trial[fl.itemIdx]!.ingredients[fl.ingIdx]!.grams).toNumber();
              for (const df of [1, 2, 3, 5, 8]) {
                const trial2 = applyGrams(trial, ctx, fl, snapToStep(gf + df, 1, fl.minG, fl.maxG));
                if (!trial2) continue;
                newTotals = totalsFromItems(trial2);
                if (finishingViolationScore(newTotals, targets, tolerance) < baseViolation) {
                  items = trial2;
                  totals = newTotals;
                  improved = true;
                  break;
                }
              }
              if (improved) break;
            }
            if (improved) break;
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
    if (maxDiff <= 20) {
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

  if (enableFinishing && !withinTolerance(totals, targets, tolerance)) {
    const leversAll = collectLevers(items, ctx);
    const keys: MacroKey[] = ["carbs_g", "fat_g", "protein_g", "kcal"];
    for (let pass = 0; pass < 18; pass++) {
      if (withinTolerance(totals, targets, tolerance)) break;
      const diffNow = macroDiff(totals, targets);
      const over = (key: MacroKey) => {
        const tol = key === "kcal" ? tolerance.kcal : tolerance[key];
        return diffNow[key].toNumber() - tol;
      };
      const under = (key: MacroKey) => {
        const tol = key === "kcal" ? tolerance.kcal : tolerance[key];
        return -diffNow[key].toNumber() - tol;
      };
      if (keys.every((key) => over(key) <= 0 && under(key) <= 0)) break;
      if (
        Math.abs(diffNow.kcal.toNumber()) > 90 ||
        Math.abs(diffNow.protein_g.toNumber()) > 8 ||
        Math.abs(diffNow.fat_g.toNumber()) > 14 ||
        Math.abs(diffNow.carbs_g.toNumber()) > 32
      ) {
        break;
      }
      const excess = [...keys].sort((a, b) => over(b) - over(a))[0]!;
      const deficit = [...keys].sort((a, b) => under(b) - under(a))[0]!;
      const cuts =
        over(excess) > 0
          ? [...leversAll].sort((a, b) => b.perG[excess] - a.perG[excess]).slice(0, 4)
          : [];
      const adds =
        under(deficit) > 0
          ? [...leversAll].sort((a, b) => b.perG[deficit] - a.perG[deficit]).slice(0, 4)
          : [...leversAll]
              .sort(
                (a, b) =>
                  b.perG.kcal / (1 + b.perG[excess] * 12) - a.perG.kcal / (1 + a.perG[excess] * 12),
              )
              .slice(0, 4);
      const base = finishingViolationScore(totals, targets, tolerance);
      let best: { items: MealPlanItem[]; totals: MacroBreakdown; score: number } | null = null;
      const cutList: Array<LeverRef | null> = cuts.length > 0 ? cuts : [null];
      const addList: Array<LeverRef | null> = adds.length > 0 ? adds : [null];
      for (const cut of cutList) {
        for (const add of addList) {
          if (cut && add && cut.itemIdx === add.itemIdx && cut.ingIdx === add.ingIdx) continue;
          for (const dc of cut ? [-1, -2, -3, -5, -8] : [0]) {
            for (const da of add ? [1, 2, 3, 5, 8] : [0]) {
              if (dc === 0 && da === 0) continue;
              let trial = items;
              if (cut) {
                const grams = d(trial[cut.itemIdx]!.ingredients[cut.ingIdx]!.grams).toNumber();
                const next = applyGrams(
                  trial,
                  ctx,
                  cut,
                  snapToStep(grams + dc, 1, cut.minG, cut.maxG),
                );
                if (!next) continue;
                trial = next;
              }
              if (add) {
                const grams = d(trial[add.itemIdx]!.ingredients[add.ingIdx]!.grams).toNumber();
                const next = applyGrams(
                  trial,
                  ctx,
                  add,
                  snapToStep(grams + da, 1, add.minG, add.maxG),
                );
                if (!next) continue;
                trial = next;
              }
              const newTotals = totalsFromItems(trial);
              const score = finishingViolationScore(newTotals, targets, tolerance);
              if (score < base && (!best || score < best.score)) {
                best = { items: trial, totals: newTotals, score };
              }
            }
          }
        }
      }
      if (!best) break;
      items = best.items;
      totals = best.totals;
    }
  }

  if (!withinTolerance(totals, targets, tolerance)) {
    const gap = macroDiff(totals, targets);
    if (
      gap.fat_g.toNumber() < -0.8 &&
      gap.fat_g.toNumber() > -8 &&
      Math.abs(gap.protein_g.toNumber()) <= 5 &&
      Math.abs(gap.carbs_g.toNumber()) <= 5 &&
      Math.abs(gap.kcal.toNumber()) <= 20
    ) {
      const levers = collectLevers(items, ctx);
      const fatLevers = [...levers].sort((a, b) => b.perG.fat_g - a.perG.fat_g).slice(0, 4);
      const trimLevers = [...levers].sort((a, b) => b.perG.kcal / (1 + b.perG.fat_g * 8) - a.perG.kcal / (1 + a.perG.fat_g * 8)).slice(0, 6);
      for (const fatLever of fatLevers) {
        if (withinTolerance(totals, targets, tolerance)) break;
        for (const addG of [1, 2, 3, 4]) {
          const grams = d(items[fatLever.itemIdx]!.ingredients[fatLever.ingIdx]!.grams).toNumber();
          let trial = applyGrams(
            items,
            ctx,
            fatLever,
            snapToStep(grams + addG, 1, fatLever.minG, fatLever.maxG),
          );
          if (!trial) continue;
          let trialTotals = totalsFromItems(trial);
          for (let trim = 0; trim < 18 && !withinTolerance(trialTotals, targets, tolerance); trim++) {
            const now = macroDiff(trialTotals, targets);
            if (
              now.kcal.toNumber() <= tolerance.kcal &&
              now.protein_g.toNumber() <= tolerance.protein_g &&
              now.carbs_g.toNumber() <= tolerance.carbs_g
            ) {
              break;
            }
            let trimmed = false;
            for (const lever of trimLevers) {
              if (lever.itemIdx === fatLever.itemIdx && lever.ingIdx === fatLever.ingIdx) continue;
              const current = d(trial[lever.itemIdx]!.ingredients[lever.ingIdx]!.grams).toNumber();
              const next = applyGrams(
                trial,
                ctx,
                lever,
                snapToStep(current - 1, 1, lever.minG, lever.maxG),
              );
              if (!next) continue;
              const nextTotals = totalsFromItems(next);
              if (
                finishingViolationScore(nextTotals, targets, tolerance) <=
                finishingViolationScore(trialTotals, targets, tolerance)
              ) {
                trial = next;
                trialTotals = nextTotals;
                trimmed = true;
                break;
              }
            }
            if (!trimmed) break;
          }
          if (
            withinTolerance(trialTotals, targets, tolerance) ||
            finishingViolationScore(trialTotals, targets, tolerance) <
              finishingViolationScore(totals, targets, tolerance)
          ) {
            items = trial;
            totals = trialTotals;
          }
          if (withinTolerance(totals, targets, tolerance)) break;
        }
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
