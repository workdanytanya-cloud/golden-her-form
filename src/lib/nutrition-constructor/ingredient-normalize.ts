import {
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  d,
  snapshotMacro,
  sumMacros,
} from "@/lib/nutrition-constructor/decimal-math";
import type {
  ConstructorDay,
  IngredientLine,
  MealPlanItem,
} from "@/lib/nutrition-constructor/types";

export const INVALID_INGREDIENT_GRAMS_MESSAGE =
  "Рацион содержит некорректную граммовку ингредиента и не может быть сохранён.";

export class InvalidIngredientGramsError extends Error {
  constructor(message = INVALID_INGREDIENT_GRAMS_MESSAGE) {
    super(message);
    this.name = "InvalidIngredientGramsError";
  }
}

export type IngredientGramsStatus = "positive" | "zero" | "invalid";

export function parseIngredientGrams(grams: unknown): number {
  if (grams === null || grams === undefined) return Number.NaN;
  if (typeof grams === "number") return grams;
  if (typeof grams === "string") {
    const trimmed = grams.trim();
    if (trimmed === "") return Number.NaN;
    return Number(trimmed.replace(",", "."));
  }
  return Number(grams);
}

export function ingredientGramsStatus(grams: unknown): IngredientGramsStatus {
  const n = parseIngredientGrams(grams);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  if (n === 0) return "zero";
  return "positive";
}

export function isPositiveIngredientGrams(grams: unknown): boolean {
  return ingredientGramsStatus(grams) === "positive";
}

/** Строки, которые можно показать клиенту/админу и сохранить. */
export function visibleIngredients<T extends { grams: unknown }>(ingredients: T[]): T[] {
  return ingredients.filter((ing) => isPositiveIngredientGrams(ing.grams));
}

export function ingredientsForClientDisplay<T extends { grams: unknown }>(
  ingredients: T[],
): T[] {
  return visibleIngredients(ingredients);
}

export function ingredientsHaveInvalidGrams(ingredients: { grams: unknown }[]): boolean {
  return ingredients.some((ing) => ingredientGramsStatus(ing.grams) === "invalid");
}

export function constructorDaysHaveInvalidGrams(days: ConstructorDay[]): boolean {
  return days.some((day) =>
    day.items.some((item) => ingredientsHaveInvalidGrams(item.ingredients)),
  );
}

export function assertSaveableIngredients(ingredients: { grams: unknown }[]): void {
  if (ingredientsHaveInvalidGrams(ingredients)) {
    throw new InvalidIngredientGramsError();
  }
}

export function assertSaveableConstructorDays(days: ConstructorDay[]): void {
  if (constructorDaysHaveInvalidGrams(days)) {
    throw new InvalidIngredientGramsError();
  }
}

export function normalizeMealPlanItem(item: MealPlanItem): MealPlanItem {
  if (ingredientsHaveInvalidGrams(item.ingredients)) return item;
  const ingredients = visibleIngredients(item.ingredients);
  if (ingredients.length === item.ingredients.length) return item;
  const totals = mealTotalsFromIngredients(ingredients);
  const snap = snapshotMacro(totals);
  return {
    ...item,
    ingredients,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
  };
}

export function normalizeConstructorDay(day: ConstructorDay): ConstructorDay {
  const items = day.items.map(normalizeMealPlanItem);
  const stripped = items.some(
    (item, idx) => item.ingredients.length !== day.items[idx]!.ingredients.length,
  );
  if (!stripped) return { ...day, items };
  const totals = sumMacros(
    items.map((item) => ({
      kcal: d(item.kcal),
      protein_g: d(item.protein_g),
      fat_g: d(item.fat_g),
      carbs_g: d(item.carbs_g),
      fiber_g: d(item.fiber_g),
    })),
  );
  const snap = snapshotMacro(totals);
  return {
    ...day,
    items,
    kcal: snap.kcal,
    protein_g: snap.protein_g,
    fat_g: snap.fat_g,
    carbs_g: snap.carbs_g,
    fiber_g: snap.fiber_g,
  };
}

export function normalizeConstructorDays(days: ConstructorDay[]): ConstructorDay[] {
  return days.map(normalizeConstructorDay);
}

/** Финальный результат: отбросить 0 г, пересчитать КБЖУ. Отрицательные/NaN не трогает. */
export function finalizeConstructorPlanDays(days: ConstructorDay[]): ConstructorDay[] {
  return normalizeConstructorDays(days);
}

export function prepareConstructorDaysForSave(days: ConstructorDay[]): ConstructorDay[] {
  assertSaveableConstructorDays(days);
  return normalizeConstructorDays(days);
}

export type ShoppingListEntry = {
  product_id: string;
  product_name: string;
  grams: number;
};

export function shoppingListFromDays(days: ConstructorDay[]): ShoppingListEntry[] {
  const map = new Map<string, ShoppingListEntry>();
  for (const day of days) {
    for (const item of day.items) {
      for (const ing of visibleIngredients(item.ingredients)) {
        const grams = parseIngredientGrams(ing.grams);
        const key = ing.product_id || ing.product_name;
        const prev = map.get(key);
        if (prev) {
          prev.grams += grams;
        } else {
          map.set(key, {
            product_id: ing.product_id,
            product_name: ing.product_name,
            grams,
          });
        }
      }
    }
  }
  return [...map.values()];
}

export function ingredientsForPdfExport(ingredients: IngredientLine[]): IngredientLine[] {
  return visibleIngredients(ingredients);
}
