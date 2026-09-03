import {
  GRAM_STEP,
  GRAM_STEP_COARSE,
  OIL_DAILY_MAX_G,
  OIL_GRAM_MAX,
  OIL_GRAM_MIN,
  type PlanSlot,
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
  AUTOGEN_OIL_PRODUCT_SLUGS,
  FAT_LEVER_SLUGS,
  OIL_PRODUCT_SLUGS,
  PROTEIN_MAIN_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import type { MacroPriorities } from "@/lib/nutrition-constructor/recipe-selection";
import type {
  ConstructorDay,
  FoodProduct,
  MealPlanItem,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";

export type DayBalanceContext = {
  products: Map<string, FoodProduct>;
  recipeIngredients: Map<string, RecipeIngredient[]>;
  recipes: Recipe[];
};

export function balancedMacroDeviationScore(
  actual: MacroBreakdown,
  target: MacroBreakdown,
  priorities?: MacroPriorities,
): number {
  const diff = macroDiff(actual, target);
  const proteinDiff = diff.protein_g.toNumber();
  const fatDiff = diff.fat_g.toNumber();
  const carbsDiff = diff.carbs_g.toNumber();
  const kcalDiff = diff.kcal.abs().toNumber();

  // 1800-style (proteinFocused, not strict HP, not lowCarb): нужен белок+углеводы, жир не раздувать.
  if (priorities?.proteinFocused && !priorities.strictHighProtein && !priorities.lowCarb) {
    const proteinPenalty = proteinDiff < 0 ? Math.abs(proteinDiff) * 16 : proteinDiff * 10;
    const fatPenalty = fatDiff > 0 ? fatDiff * 18 : Math.abs(fatDiff) * 10;
    const carbsPenalty = carbsDiff < 0 ? Math.abs(carbsDiff) * 16 : carbsDiff * 8;
    return kcalDiff * 10 + proteinPenalty + fatPenalty + carbsPenalty;
  }

  const proteinPenalty =
    proteinDiff > 0 ? proteinDiff * 18 : Math.abs(proteinDiff) * 8;
  const fatPenalty = fatDiff < 0 ? Math.abs(fatDiff) * 22 : Math.abs(fatDiff) * 10;
  const carbsPenalty = Math.abs(carbsDiff) * 8;

  return kcalDiff * 10 + proteinPenalty + fatPenalty + carbsPenalty;
}

function productSlug(ctx: DayBalanceContext, productId: string): string | null {
  return ctx.products.get(productId)?.slug ?? null;
}

function gramStepForProduct(slug: string | null): number {
  if (!slug) return GRAM_STEP_COARSE;
  if (OIL_PRODUCT_SLUGS.has(slug) || slug === "hard-cheese") return GRAM_STEP;
  if (PROTEIN_MAIN_PRODUCT_SLUGS.has(slug) || slug.includes("-dry")) return GRAM_STEP_COARSE;
  return GRAM_STEP_COARSE;
}

function isFatLever(slug: string | null): boolean {
  return !!slug && FAT_LEVER_SLUGS.has(slug);
}

function isProteinMain(slug: string | null): boolean {
  return !!slug && PROTEIN_MAIN_PRODUCT_SLUGS.has(slug);
}

function isOil(slug: string | null): boolean {
  return !!slug && OIL_PRODUCT_SLUGS.has(slug);
}

function isAutogenProduct(ctx: DayBalanceContext, productId: string): boolean {
  const p = ctx.products.get(productId);
  return !!p && p.is_active !== false && p.is_active_for_autogeneration !== false;
}

function pickAutogenOilProduct(
  ctx: DayBalanceContext,
  excluded: Set<string>,
): FoodProduct | undefined {
  for (const slug of AUTOGEN_OIL_PRODUCT_SLUGS) {
    const product = [...ctx.products.values()].find(
      (p) =>
        p.slug === slug &&
        p.is_active &&
        p.is_verified &&
        p.is_active_for_autogeneration !== false &&
        !excluded.has(p.id),
    );
    if (product) return product;
  }
  return undefined;
}

export function enrichMainIngredientsWithOil(
  ctx: DayBalanceContext,
  recipe: Recipe,
  ings: RecipeIngredient[],
  excluded: Set<string>,
): RecipeIngredient[] {
  const hasOil = ings.some((ri) => isOil(productSlug(ctx, ri.product_id)));
  if (hasOil) return ings;

  const oilProduct = pickAutogenOilProduct(ctx, excluded);
  if (!oilProduct) return ings;

  return [
    ...ings,
    {
      id: `optional-oil-${recipe.id}`,
      recipe_id: recipe.id,
      product_id: oilProduct.id,
      min_g: 0,
      max_g: OIL_GRAM_MAX,
      default_g: OIL_GRAM_MIN,
      is_scalable: true,
      sort_order: 999,
      optional: true,
    },
  ];
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

function rebuildItem(
  item: MealPlanItem,
  ctx: DayBalanceContext,
  newIngredients: typeof item.ingredients,
): MealPlanItem {
  const recipe = ctx.recipes.find((r) => r.id === item.recipe_id)!;
  return buildMealPlanItem({ slot: item.slot, recipe, ingredients: newIngredients });
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

export function tuneDayToTargets(params: {
  ctx: DayBalanceContext;
  items: MealPlanItem[];
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  maxSteps?: number;
  priorities?: MacroPriorities;
}): { items: MealPlanItem[]; totals: MacroBreakdown; valid: boolean } {
  const { ctx, targets, tolerance, priorities } = params;
  let items = params.items.map((i) => ({ ...i, ingredients: [...i.ingredients] }));
  let totals = totalsFromItems(items);
  const maxSteps = params.maxSteps ?? 1200;

  for (let pass = 0; pass < 2; pass++) {
    for (let step = 0; step < maxSteps; step++) {
      if (withinTolerance(totals, targets, tolerance)) break;

    const diff = macroDiff(totals, targets);
    const fatDeficit = diff.fat_g.toNumber() < -0.5;
    const fatSurplus = diff.fat_g.toNumber() > 0.5;
    const proteinDeficit = diff.protein_g.toNumber() < -0.5;
    const proteinSurplus = diff.protein_g.toNumber() > 0.5;
    const carbsDeficit = diff.carbs_g.toNumber() < -0.5;
    const carbsSurplus = diff.carbs_g.toNumber() > 0.5;

    const candidates: Array<{
      score: number;
      apply: () => MealPlanItem[];
    }> = [];

    for (const item of items) {
      if (!item.slot.startsWith("main") && !item.slot.startsWith("snack")) continue;

      for (let ingIdx = 0; ingIdx < item.ingredients.length; ingIdx++) {
        const ing = item.ingredients[ingIdx]!;
        const slug = productSlug(ctx, ing.product_id);
        if (slug === "butter") continue;
        if (isFatLever(slug) && !isAutogenProduct(ctx, ing.product_id)) continue;

        const bounds =
          ctx.recipeIngredients
            .get(item.recipe_id)
            ?.find((x) => x.product_id === ing.product_id) ??
          (isOil(slug)
            ? { min_g: 0, max_g: OIL_GRAM_MAX }
            : { min_g: 0, max_g: 600 });

        const stepSize = gramStepForProduct(slug);
        let deltas: number[];
        if (isFatLever(slug)) {
          if (fatDeficit) deltas = [stepSize];
          else if (fatSurplus) deltas = [-stepSize];
          else deltas = [stepSize, -stepSize];
        } else if (isProteinMain(slug)) {
          if (proteinSurplus) deltas = [-stepSize];
          else if (proteinDeficit) deltas = [stepSize];
          else deltas = [stepSize, -stepSize];
        } else if (slug?.includes("-dry") || slug === "crispbread" || slug === "lavash" || slug === "banana") {
          if (carbsDeficit) deltas = [stepSize];
          else if (carbsSurplus) deltas = [-stepSize];
          else deltas = [stepSize, -stepSize];
        } else {
          deltas = [stepSize, -stepSize];
        }

        for (const delta of deltas) {
          const prevG = d(ing.grams).toNumber();
          const nextG = prevG + delta;
          if (nextG < bounds.min_g || nextG > bounds.max_g) continue;
          if (isOil(slug) && nextG > 0 && nextG < OIL_GRAM_MIN) continue;
          if (isOil(slug) && delta > 0) {
            const projectedOil = dayOilTotalG(items, ctx) + delta;
            if (projectedOil > OIL_DAILY_MAX_G) continue;
          }

          const product = ctx.products.get(ing.product_id);
          if (!product) continue;
          const newLine = buildIngredientLine(product, nextG, ing.sort_order);
          const newItems = items.map((it) => {
            if (it.slot !== item.slot) return it;
            const newIngs = it.ingredients.map((x, idx) =>
              idx === ingIdx ? newLine : x,
            );
            return rebuildItem(it, ctx, newIngs);
          });
          const newTotals = totalsFromItems(newItems);
          const score = balancedMacroDeviationScore(newTotals, targets, priorities);
          candidates.push({ score, apply: () => newItems });
        }
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (!best || best.score >= balancedMacroDeviationScore(totals, targets, priorities)) break;
    items = best.apply();
    totals = totalsFromItems(items);
    }
    if (withinTolerance(totals, targets, tolerance)) break;
  }

  const snap = snapshotMacro(totals);
  return {
    items,
    totals,
    valid: withinTolerance(totals, targets, tolerance),
  };
}

export function finalizeConstructorDay(
  day: Omit<ConstructorDay, "day_index" | "day_note">,
): Omit<ConstructorDay, "day_index" | "day_note"> {
  const snap = snapshotMacro(
    sumMacros([
      {
        kcal: d(day.kcal),
        protein_g: d(day.protein_g),
        fat_g: d(day.fat_g),
        carbs_g: d(day.carbs_g),
        fiber_g: d(day.fiber_g),
      },
    ]),
  );
  return { ...day, ...snap, is_valid: day.is_valid };
}

export function mainSlotsForMode(mode: import("@/lib/nutrition-constructor/config").MealScheduleMode): PlanSlot[] {
  switch (mode) {
    case "three_main_two_snacks":
    case "three_mains_only":
      return ["main1", "main2", "main3"];
    case "one_main_three_snacks":
      return ["main1"];
    default:
      return ["main1", "main2"];
  }
}
