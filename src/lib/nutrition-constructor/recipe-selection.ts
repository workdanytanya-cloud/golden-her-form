import { mealTotalsFromIngredients, buildIngredientLine } from "@/lib/nutrition-constructor/calculator";
import {
  MAX_ACTIVE_PREP_MINUTES,
  MAX_TOTAL_COOK_MINUTES,
} from "@/lib/nutrition-constructor/config";
import {
  d,
  macroDiff,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import { NUT_SEED_PRODUCT_SLUGS, PROTEIN_MAIN_PRODUCT_SLUGS, PROTEIN_SNACK_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import type { FoodProduct, Recipe, RecipeIngredient } from "@/lib/nutrition-constructor/types";

export type RecipeSelectionContext = {
  products: Map<string, FoodProduct>;
  recipeIngredients: Map<string, RecipeIngredient[]>;
};

const MAIN_PROTEIN_SLUGS = PROTEIN_MAIN_PRODUCT_SLUGS;

export type MacroPriorities = {
  proteinFocused: boolean;
  lowCarb: boolean;
  /** 1313/112 — жёсткий режим: только protein-rich mains + tuna/cheese snacks. */
  strictHighProtein: boolean;
};

export function macroPriorities(targets: MacroBreakdown): MacroPriorities {
  const kcal = targets.kcal.toNumber();
  if (kcal <= 0) return { proteinFocused: false, lowCarb: false, strictHighProtein: false };
  const proteinKcal = targets.protein_g.toNumber() * 4;
  const carbsKcal = targets.carbs_g.toNumber() * 4;
  const proteinPct = proteinKcal / kcal;
  const carbsPct = carbsKcal / kcal;
  return {
    proteinFocused:
      proteinPct >= 0.28 ||
      targets.protein_g.toNumber() >= targets.carbs_g.toNumber() * 0.85,
    lowCarb: carbsPct <= 0.35,
    strictHighProtein: isHighProteinTarget(targets),
  };
}

/** Жёсткий high-protein профиль (1313/112): tuna/cheese snacks + day-level solver. */
export function isHighProteinTarget(targets: MacroBreakdown): boolean {
  const kcal = targets.kcal.toNumber();
  if (kcal <= 0) return false;
  return (targets.protein_g.toNumber() * 4) / kcal >= 0.32;
}

export function slotMacroTargets(targets: MacroBreakdown, share: number): MacroBreakdown {
  return {
    kcal: targets.kcal.mul(share),
    protein_g: targets.protein_g.mul(share),
    fat_g: targets.fat_g.mul(share),
    carbs_g: targets.carbs_g.mul(share),
    fiber_g: targets.fiber_g.mul(share),
  };
}

function initialGrams(ri: RecipeIngredient): number {
  if (ri.default_g != null) return ri.default_g;
  return Math.round((ri.min_g + ri.max_g) / 2);
}

export function isAutoGenerationEligible(recipe: Recipe): boolean {
  if (!recipe.is_active) return false;
  if (recipe.dietitian_approved === false) return false;
  if (recipe.is_nutritionally_complete === false) return false;
  if (recipe.meal_type === "main") {
    const activePrep = recipe.active_prep_minutes ?? recipe.prep_time_min ?? 999;
    const totalCook = recipe.total_cook_minutes ?? recipe.prep_time_min ?? 999;
    if (activePrep > MAX_ACTIVE_PREP_MINUTES) return false;
    if (totalCook > MAX_TOTAL_COOK_MINUTES) return false;
  }
  return true;
}

export function verifiedIngredients(
  ctx: RecipeSelectionContext,
  recipe: Recipe,
  excluded: Set<string>,
): RecipeIngredient[] {
  return (ctx.recipeIngredients.get(recipe.id) ?? []).filter((ri) => {
    const p = ctx.products.get(ri.product_id);
    return p && p.is_active && p.is_verified && !excluded.has(p.id);
  });
}

export function estimateRecipeDefaultMacros(
  ctx: RecipeSelectionContext,
  recipe: Recipe,
  excluded: Set<string>,
): MacroBreakdown | null {
  const ings = verifiedIngredients(ctx, recipe, excluded);
  if (ings.length === 0) return null;
  const lines = ings.map((ri, idx) => {
    const p = ctx.products.get(ri.product_id)!;
    return buildIngredientLine(p, initialGrams(ri), idx);
  });
  return mealTotalsFromIngredients(lines);
}

export function isProteinRichRecipe(ctx: RecipeSelectionContext, recipe: Recipe): boolean {
  if (recipe.contains_protein_source) return true;
  const slugs = (ctx.recipeIngredients.get(recipe.id) ?? [])
    .map((ri) => ctx.products.get(ri.product_id)?.slug)
    .filter(Boolean) as string[];
  return slugs.some((s) => MAIN_PROTEIN_SLUGS.has(s) || PROTEIN_SNACK_PRODUCT_SLUGS.has(s));
}

export function isCarbDominantRecipe(macros: MacroBreakdown): boolean {
  const kcal = macros.kcal.toNumber();
  if (kcal <= 0) return false;
  const carbShare = (macros.carbs_g.toNumber() * 4) / kcal;
  const proteinShare = (macros.protein_g.toNumber() * 4) / kcal;
  return carbShare > 0.5 && proteinShare < 0.2;
}

export function isGrainBreakfastRecipe(ctx: RecipeSelectionContext, recipe: Recipe): boolean {
  const slugs = (ctx.recipeIngredients.get(recipe.id) ?? [])
    .map((ri) => ctx.products.get(ri.product_id)?.slug)
    .filter(Boolean) as string[];
  const hasGrain = slugs.some((s) =>
    ["oats-dry", "rice-white-dry", "buckwheat-dry"].includes(s),
  );
  const hasProtein = slugs.some((s) => MAIN_PROTEIN_SLUGS.has(s));
  return hasGrain && !hasProtein;
}

function scaledMacroEstimate(base: MacroBreakdown, targetKcal: number): MacroBreakdown {
  const baseKcal = base.kcal.toNumber();
  if (baseKcal <= 0) return base;
  const scale = targetKcal / baseKcal;
  return {
    kcal: d(targetKcal),
    protein_g: base.protein_g.mul(scale),
    fat_g: base.fat_g.mul(scale),
    carbs_g: base.carbs_g.mul(scale),
    fiber_g: base.fiber_g.mul(scale),
  };
}

export function macroDeviationScore(
  actual: MacroBreakdown,
  target: MacroBreakdown,
  priorities?: MacroPriorities,
): number {
  const diff = macroDiff(actual, target);
  const proteinWeight = priorities?.proteinFocused ? 14 : 8;
  const carbsWeight = priorities?.lowCarb ? 20 : 8;
  return (
    diff.kcal.abs().toNumber() * 10 +
    diff.protein_g.abs().toNumber() * proteinWeight +
    diff.fat_g.abs().toNumber() * 8 +
    diff.carbs_g.abs().toNumber() * carbsWeight
  );
}

export function scoreRecipeForSlot(
  ctx: RecipeSelectionContext,
  recipe: Recipe,
  slotTargets: MacroBreakdown,
  excluded: Set<string>,
  priorities: MacroPriorities,
  mealType: "main" | "snack",
): number {
  const base = estimateRecipeDefaultMacros(ctx, recipe, excluded);
  if (!base) return Number.POSITIVE_INFINITY;

  if (mealType === "main" && priorities.proteinFocused) {
    if (!isProteinRichRecipe(ctx, recipe)) return Number.POSITIVE_INFINITY;
    if (isGrainBreakfastRecipe(ctx, recipe)) return Number.POSITIVE_INFINITY;
    if (isCarbDominantRecipe(base) && !isProteinRichRecipe(ctx, recipe)) {
      return Number.POSITIVE_INFINITY;
    }
  }

  if (mealType === "snack" && priorities.lowCarb && base) {
    const carbShare = (base.carbs_g.toNumber() * 4) / Math.max(base.kcal.toNumber(), 1);
    if (carbShare > 0.4) return Number.POSITIVE_INFINITY;
  }

  const scaled = scaledMacroEstimate(base, slotTargets.kcal.toNumber());
  return macroDeviationScore(scaled, slotTargets, priorities);
}

export function pickBestRecipe(
  pool: Recipe[],
  ctx: RecipeSelectionContext,
  slotTargets: MacroBreakdown,
  excluded: Set<string>,
  priorities: MacroPriorities,
  mealType: "main" | "snack",
  dayIndex: number,
  avoidIds: Set<string> = new Set(),
): Recipe | null {
  const candidates = pool.filter((r) => !avoidIds.has(r.id));
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((recipe, idx) => {
      const base = estimateRecipeDefaultMacros(ctx, recipe, excluded);
      const proteinDensity =
        base && base.kcal.toNumber() > 0
          ? base.protein_g.toNumber() / base.kcal.toNumber()
          : 0;
      return {
        recipe,
        score: scoreRecipeForSlot(ctx, recipe, slotTargets, excluded, priorities, mealType),
        proteinDensity,
        tie: idx,
      };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (priorities.proteinFocused && mealType === "main") {
        return b.proteinDensity - a.proteinDensity;
      }
      return ((a.tie + dayIndex) % 3) - ((b.tie + dayIndex) % 3);
    });

  return scored[0]?.recipe ?? candidates[dayIndex % candidates.length] ?? null;
}

export function pickTopProteinMains(
  pool: Recipe[],
  ctx: RecipeSelectionContext,
  excluded: Set<string>,
  limit: number,
): Recipe[] {
  return pool
    .filter((r) => isProteinRichRecipe(ctx, r))
    .map((recipe) => {
      const base = estimateRecipeDefaultMacros(ctx, recipe, excluded);
      const density =
        base && base.kcal.toNumber() > 0
          ? base.protein_g.toNumber() / base.kcal.toNumber()
          : 0;
      return { recipe, density };
    })
    .sort((a, b) => b.density - a.density)
    .slice(0, limit)
    .map((x) => x.recipe);
}
