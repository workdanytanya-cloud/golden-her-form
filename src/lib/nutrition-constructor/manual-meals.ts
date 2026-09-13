import {
  buildIngredientLine,
  buildMealPlanItem,
  dayMacroFromItems,
  recalculateConstructorDay,
  recalculateMealFromProducts,
} from "@/lib/nutrition-constructor/calculator";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import {
  InvalidIngredientGramsError,
  normalizeMealPlanItem,
  parseIngredientGrams,
  prepareConstructorDaysForSave,
  shoppingListFromDays,
} from "@/lib/nutrition-constructor/ingredient-normalize";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { snapshotMacro } from "@/lib/nutrition-constructor/decimal-math";
import { verifiedIngredients } from "@/lib/nutrition-constructor/recipe-selection";
import type {
  ConstructorDay,
  FoodProduct,
  IngredientLine,
  MealPlanItem,
  Recipe,
} from "@/lib/nutrition-constructor/types";
import type { TrainerMealKind } from "@/lib/nutrition-constructor/trainer-slots";

export const ZERO_GRAMS_FORBIDDEN_MESSAGE = "Граммовка должна быть больше 0.";
export const ALLERGEN_BLOCKED_MESSAGE = "Нельзя добавить продукт с запрещённым аллергеном.";
export const COOKING_IN_SNACK_MESSAGE =
  "Перекус без приготовления не может содержать ингредиент, требующий приготовления.";

export class ManualMealEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualMealEditError";
  }
}

function assertPositiveGrams(grams: number): void {
  if (!Number.isFinite(grams) || grams <= 0) {
    throw new ManualMealEditError(ZERO_GRAMS_FORBIDDEN_MESSAGE);
  }
}

export function allowedProductsForManualMeal(params: {
  ctx: OptimizerContext;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): FoodProduct[] {
  return [...params.ctx.products.values()].filter((product) => {
    if (!product.is_active || !product.is_verified) return false;
    if (params.forbiddenIds.has(product.id)) return false;
    if (params.mealKind === "snack" && product.requires_cooking) return false;
    return true;
  });
}

export function eligibleRecipesForManualPick(params: {
  ctx: OptimizerContext;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): Recipe[] {
  const pool = params.mealKind === "main" ? params.ctx.mainRecipes : params.ctx.snackRecipes;
  return pool.filter((recipe) => {
    if (!recipe.is_active) return false;
    if (params.mealKind === "snack" && recipe.requires_cooking) return false;
    const ings = verifiedIngredients(params.ctx, recipe, params.forbiddenIds);
    return ings.length > 0;
  });
}

function applyDayItems(day: ConstructorDay, items: MealPlanItem[], products: Map<string, FoodProduct>): ConstructorDay {
  const next: ConstructorDay = { ...day, items };
  return recalculateConstructorDay(next, products);
}

export function addMealToDay(params: {
  day: ConstructorDay;
  item: MealPlanItem;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const existing = params.day.items.find((item) => item.slot === params.item.slot);
  if (existing) {
    throw new ManualMealEditError(`Слот ${params.item.slot} уже занят — используйте замену.`);
  }
  return applyDayItems(params.day, [...params.day.items, params.item], params.products);
}

export function replaceMealInDay(params: {
  day: ConstructorDay;
  item: MealPlanItem;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const items = params.day.items.some((item) => item.slot === params.item.slot)
    ? params.day.items.map((item) => (item.slot === params.item.slot ? params.item : item))
    : [...params.day.items, params.item];
  return applyDayItems(params.day, items, params.products);
}

export function deleteMealFromDay(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  return applyDayItems(
    params.day,
    params.day.items.filter((item) => item.slot !== params.slot),
    params.products,
  );
}

export function setIngredientGrams(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  productId: string;
  grams: number;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  assertPositiveGrams(params.grams);
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    const newIngs = item.ingredients.map((ing) =>
      ing.product_id === params.productId ? { ...ing, grams: String(params.grams) } : ing,
    );
    return recalculateMealFromProducts({ ...item, ingredients: newIngs }, params.products);
  });
  return applyDayItems(params.day, items, params.products);
}

export function addIngredientToMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  product: FoodProduct;
  grams: number;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  assertPositiveGrams(params.grams);
  if (params.forbiddenIds.has(params.product.id)) {
    throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
  }
  if (params.mealKind === "snack" && params.product.requires_cooking) {
    throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
  }
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    const existing = item.ingredients.find((ing) => ing.product_id === params.product.id);
    if (existing) {
      throw new ManualMealEditError("Этот продукт уже есть в приёме — измените граммовку.");
    }
    const line = buildIngredientLine(params.product, params.grams, item.ingredients.length);
    return recalculateMealFromProducts(
      { ...item, ingredients: [...item.ingredients, line] },
      params.products,
    );
  });
  return applyDayItems(params.day, items, params.products);
}

export function removeIngredientFromMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  productId: string;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    return recalculateMealFromProducts(
      { ...item, ingredients: item.ingredients.filter((ing) => ing.product_id !== params.productId) },
      params.products,
    );
  });
  return applyDayItems(params.day, items, params.products);
}

export function mealItemFromRecipe(params: {
  ctx: OptimizerContext;
  recipe: Recipe;
  slot: PlanSlot;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): MealPlanItem {
  if (params.mealKind === "snack" && params.recipe.requires_cooking) {
    throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
  }
  const ings = verifiedIngredients(params.ctx, params.recipe, params.forbiddenIds);
  if (ings.length === 0) {
    throw new ManualMealEditError("У рецепта нет допустимых ингредиентов.");
  }
  const lines: IngredientLine[] = [];
  for (const [idx, ing] of ings.entries()) {
    const product = params.ctx.products.get(ing.product_id);
    if (!product) continue;
    if (params.forbiddenIds.has(product.id)) {
      throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
    }
    if (params.mealKind === "snack" && product.requires_cooking) {
      throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
    }
    const grams = ing.default_g != null && ing.default_g > 0 ? ing.default_g : Math.max(ing.min_g, 1);
    assertPositiveGrams(grams);
    lines.push(buildIngredientLine(product, grams, idx));
  }
  return normalizeMealPlanItem(
    buildMealPlanItem({
      slot: params.slot,
      recipe: {
        ...params.recipe,
        requires_cooking: params.mealKind === "snack" ? false : params.recipe.requires_cooking,
      },
      ingredients: lines,
    }),
  );
}

export function mealItemFromProducts(params: {
  slot: PlanSlot;
  name: string;
  mealKind: TrainerMealKind;
  lines: Array<{ product: FoodProduct; grams: number }>;
  forbiddenIds: Set<string>;
}): MealPlanItem {
  if (params.lines.length === 0) {
    throw new ManualMealEditError("Добавьте хотя бы один продукт.");
  }
  const ingredients: IngredientLine[] = [];
  for (const [idx, line] of params.lines.entries()) {
    assertPositiveGrams(line.grams);
    if (params.forbiddenIds.has(line.product.id)) {
      throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
    }
    if (params.mealKind === "snack" && line.product.requires_cooking) {
      throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
    }
    ingredients.push(buildIngredientLine(line.product, line.grams, idx));
  }
  const recipe: Recipe = {
    id: `manual-${params.slot}`,
    slug: `manual-${params.slot}`,
    name: params.name.trim() || (params.mealKind === "snack" ? "Ручной перекус" : "Ручной приём"),
    meal_type: params.mealKind === "snack" ? "snack" : "main",
    steps: ["Собрано тренером вручную."],
    prep_time_min: params.mealKind === "snack" ? 1 : 10,
    requires_cooking: params.mealKind === "main",
    is_active: true,
    weighing_note: null,
    is_nutrient_dense: true,
    contains_protein_source: ingredients.some((ing) => {
      const p = Number(ing.protein_g);
      return p >= 5;
    }),
    contains_fruit_or_vegetable: false,
    is_treat: false,
    allowed_schedule_modes: [
      "three_main_two_snacks",
      "three_mains_only",
      "one_main_three_snacks",
      "two_main_two_snacks",
    ],
    snack_action: params.mealKind === "snack" ? "Собрать" : null,
  };
  return normalizeMealPlanItem(buildMealPlanItem({ slot: params.slot, recipe, ingredients }));
}

export function replaceDaysDay(
  days: ConstructorDay[],
  nextDay: ConstructorDay,
  products: Map<string, FoodProduct>,
): ConstructorDay[] {
  return days.map((day) =>
    day.day_index === nextDay.day_index ? recalculateConstructorDay(nextDay, products) : day,
  );
}

export function persistableEditedDays(days: ConstructorDay[]): ConstructorDay[] {
  try {
    return prepareConstructorDaysForSave(days);
  } catch (error) {
    if (error instanceof InvalidIngredientGramsError) throw error;
    throw error;
  }
}

export function shoppingListAfterEdit(days: ConstructorDay[]) {
  return shoppingListFromDays(days);
}

export function dayTotalsSnapshot(day: ConstructorDay) {
  return snapshotMacro(dayMacroFromItems(day.items));
}

export function parsePositiveGramsOrThrow(grams: unknown): number {
  const n = parseIngredientGrams(grams);
  assertPositiveGrams(n);
  return n;
}
