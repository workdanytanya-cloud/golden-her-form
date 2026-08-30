import {
  d,
  displayMacro,
  macroFromPer100,
  snapshotMacro,
  sumMacros,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import type {
  FoodProduct,
  IngredientLine,
  MealPlanItem,
  Recipe,
} from "@/lib/nutrition-constructor/types";
import type { ConstructorSlot } from "@/lib/nutrition-constructor/config";

export function productPer100(p: FoodProduct) {
  return {
    kcal: p.kcal_per_100g,
    protein: p.protein_per_100g,
    fat: p.fat_per_100g,
    carbs: p.carbs_per_100g,
    fiber: p.fiber_per_100g,
  };
}

export function buildIngredientLine(
  product: FoodProduct,
  grams: number | string,
  sort_order: number,
): IngredientLine {
  const macros = macroFromPer100(productPer100(product), grams);
  const snap = snapshotMacro(macros);
  return {
    product_id: product.id,
    product_name: product.name,
    grams: d(grams).toFixed(4),
    weighing_note: product.weighing_note,
    kcal_per_100g: product.kcal_per_100g,
    protein_per_100g: product.protein_per_100g,
    fat_per_100g: product.fat_per_100g,
    carbs_per_100g: product.carbs_per_100g,
    fiber_per_100g: product.fiber_per_100g,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
    sort_order,
  };
}

export function mealTotalsFromIngredients(ingredients: IngredientLine[]): MacroBreakdown {
  return sumMacros(
    ingredients.map((i) => ({
      kcal: d(i.kcal),
      protein_g: d(i.protein_g),
      fat_g: d(i.fat_g),
      carbs_g: d(i.carbs_g),
      fiber_g: d(i.fiber_g),
    })),
  );
}

export function buildMealPlanItem(params: {
  slot: ConstructorSlot;
  recipe: Recipe;
  ingredients: IngredientLine[];
}): MealPlanItem {
  const totals = mealTotalsFromIngredients(params.ingredients);
  const snap = snapshotMacro(totals);
  return {
    slot: params.slot,
    recipe_id: params.recipe.id,
    recipe_name: params.recipe.name,
    requires_cooking: params.recipe.requires_cooking,
    prep_time_min: params.recipe.prep_time_min,
    steps: params.recipe.steps,
    weighing_note: params.recipe.weighing_note,
    snack_action: params.recipe.snack_action,
    ingredients: params.ingredients,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
    is_valid: true,
  };
}

export function comparisonRows(
  target: MacroBreakdown,
  actual: MacroBreakdown,
): Array<{ label: string; target: number; actual: number; diff: number }> {
  const t = displayMacro(target);
  const a = displayMacro(actual);
  return [
    { label: "Калории", target: t.kcal, actual: a.kcal, diff: a.kcal - t.kcal },
    { label: "Белки", target: t.protein_g, actual: a.protein_g, diff: a.protein_g - t.protein_g },
    { label: "Жиры", target: t.fat_g, actual: a.fat_g, diff: a.fat_g - t.fat_g },
    { label: "Углеводы", target: t.carbs_g, actual: a.carbs_g, diff: a.carbs_g - t.carbs_g },
  ];
}
