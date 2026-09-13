import { describe, expect, it } from "vitest";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import {
  InvalidIngredientGramsError,
  ingredientsForClientDisplay,
  normalizeMealPlanItem,
  prepareConstructorDaysForSave,
  shoppingListFromDays,
} from "@/lib/nutrition-constructor/ingredient-normalize";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import type { ConstructorDay, IngredientLine, MealPlanItem } from "@/lib/nutrition-constructor/types";
import {
  buildConstructorNutritionSnapshot,
  constructorDaysFromSnapshot,
} from "@/lib/published-programs/nutrition-snapshot";
import { createEmptyStore, saveNutritionDraft } from "@/lib/published-programs/store";

const catalog = buildInMemoryCatalog({ includeTestPackaging: true });
const oil = catalog.products.get("olive-oil")!;
const chicken = catalog.products.get("chicken-breast-raw")!;
const recipe = catalog.mainRecipes[0]!;

function line(product: typeof oil, grams: number, sort: number): IngredientLine {
  return buildIngredientLine(product, grams, sort);
}

function mealWith(ingredients: IngredientLine[]): MealPlanItem {
  return buildMealPlanItem({
    slot: "main1",
    recipe,
    ingredients,
  });
}

function dayFromItem(item: MealPlanItem): ConstructorDay {
  return {
    day_index: 0,
    day_note: null,
    items: [item],
    kcal: item.kcal,
    protein_g: item.protein_g,
    fat_g: item.fat_g,
    carbs_g: item.carbs_g,
    fiber_g: item.fiber_g,
    is_valid: true,
  };
}

function snapshotOf(item: MealPlanItem) {
  return buildConstructorNutritionSnapshot({
    days: [dayFromItem(item)],
    targets: { kcal: 1800, protein_g: 135, fat_g: 60, carbs_g: 180 },
    meal_schedule_mode: "three_main_two_snacks",
    primary_meal_slot: "lunch",
  });
}

function frozenOilGrams(item: MealPlanItem): number[] {
  return snapshotOf(item)
    .constructor_days[0]!.items[0]!.ingredients.filter((ing) => ing.product_id === oil.id || /масл/i.test(ing.product_name))
    .map((ing) => Number(ing.grams));
}

describe("zero-gram ingredients", () => {
  it("optional 0 g oil is absent from the final meal", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    const finalized = normalizeMealPlanItem(item);
    expect(finalized.ingredients.some((ing) => ing.product_id === oil.id)).toBe(false);
    expect(finalized.ingredients.every((ing) => Number(ing.grams) > 0)).toBe(true);
  });

  it("3 g oil is kept for save and display", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 3, 1)]);
    const finalized = normalizeMealPlanItem(item);
    const oilLine = finalized.ingredients.find((ing) => ing.product_id === oil.id);
    expect(oilLine).toBeTruthy();
    expect(Number(oilLine!.grams)).toBe(3);
    expect(ingredientsForClientDisplay(finalized.ingredients).some((ing) => Number(ing.grams) === 3)).toBe(
      true,
    );
    expect(frozenOilGrams(finalized)).toEqual([3]);
    const saved = prepareConstructorDaysForSave([dayFromItem(finalized)]);
    expect(Number(saved[0]!.items[0]!.ingredients.find((ing) => ing.product_id === oil.id)!.grams)).toBe(3);
  });

  it("14 g oil is kept for save and display", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 14, 1)]);
    const finalized = normalizeMealPlanItem(item);
    const oilLine = finalized.ingredients.find((ing) => ing.product_id === oil.id);
    expect(Number(oilLine!.grams)).toBe(14);
    expect(ingredientsForClientDisplay(finalized.ingredients).some((ing) => Number(ing.grams) === 14)).toBe(
      true,
    );
    expect(frozenOilGrams(finalized)).toEqual([14]);
    const saved = prepareConstructorDaysForSave([dayFromItem(finalized)]);
    expect(Number(saved[0]!.items[0]!.ingredients.find((ing) => ing.product_id === oil.id)!.grams)).toBe(14);
  });

  it("zero-gram row does not enter the draft", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    const dirty = snapshotOf(item);
    expect(dirty.constructor_days[0]!.items[0]!.ingredients.some((ing) => Number(ing.grams) === 0)).toBe(
      false,
    );
    const injected = structuredClone(dirty);
    injected.constructor_days[0]!.items[0]!.ingredients.push({
      product_id: oil.id,
      product_name: "Оливковое масло",
      grams: "0.0000",
      weighing_note: null,
      measurement_state: null,
      kcal_per_100g: oil.kcal_per_100g,
      protein_per_100g: oil.protein_per_100g,
      fat_per_100g: oil.fat_per_100g,
      carbs_per_100g: oil.carbs_per_100g,
      fiber_per_100g: oil.fiber_per_100g,
      kcal: "0.0000",
      protein_g: "0.0000",
      fat_g: "0.0000",
      carbs_g: "0.0000",
      fiber_g: "0.0000",
      sort_order: 99,
    });
    const store = saveNutritionDraft(createEmptyStore(), "client-zero", injected);
    const draftIngs = store.nutritionDrafts[0]!.snapshot.constructor_days[0]!.items[0]!.ingredients;
    expect(draftIngs.some((ing) => Number(ing.grams) === 0)).toBe(false);
    expect(draftIngs.some((ing) => ing.product_name === "Оливковое масло")).toBe(false);
  });

  it("zero-gram row does not enter the snapshot", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    const snapshot = snapshotOf(item);
    const ings = snapshot.constructor_days[0]!.items[0]!.ingredients;
    expect(ings.some((ing) => Number(ing.grams) === 0)).toBe(false);
    expect(ings.some((ing) => /масл/i.test(ing.product_name))).toBe(false);
  });

  it("client helper hides a legacy zero-gram row", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    expect(ingredientsForClientDisplay(item.ingredients).some((ing) => ing.product_id === oil.id)).toBe(
      false,
    );
    const snapshot = snapshotOf(mealWith([line(chicken, 150, 0)]));
    snapshot.constructor_days[0]!.items[0]!.ingredients.push({
      product_id: oil.id,
      product_name: "Оливковое масло",
      grams: "0",
      weighing_note: null,
      measurement_state: null,
      kcal_per_100g: oil.kcal_per_100g,
      protein_per_100g: oil.protein_per_100g,
      fat_per_100g: oil.fat_per_100g,
      carbs_per_100g: oil.carbs_per_100g,
      fiber_per_100g: oil.fiber_per_100g,
      kcal: "0.0000",
      protein_g: "0.0000",
      fat_g: "0.0000",
      carbs_g: "0.0000",
      fiber_g: "0.0000",
      sort_order: 99,
    });
    const clientDay = constructorDaysFromSnapshot(snapshot)[0]!;
    expect(clientDay.items[0]!.ingredients.some((ing) => Number(ing.grams) === 0)).toBe(false);
  });

  it("shopping list excludes zero-gram ingredients", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    const list = shoppingListFromDays([dayFromItem(item)]);
    expect(list.some((row) => row.product_id === oil.id)).toBe(false);
    expect(list.every((row) => row.grams > 0)).toBe(true);
    const withOil = mealWith([line(chicken, 150, 0), line(oil, 3, 1)]);
    const listWithOil = shoppingListFromDays([dayFromItem(withOil)]);
    expect(listWithOil.some((row) => row.product_id === oil.id && row.grams === 3)).toBe(true);
  });

  it("filtering zero grams does not change meal or day KBJU", () => {
    const item = mealWith([line(chicken, 150, 0), line(oil, 0, 1)]);
    const before = {
      kcal: item.kcal,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carbs_g: item.carbs_g,
    };
    const after = normalizeMealPlanItem(item);
    expect(after.kcal).toBe(before.kcal);
    expect(after.protein_g).toBe(before.protein_g);
    expect(after.fat_g).toBe(before.fat_g);
    expect(after.carbs_g).toBe(before.carbs_g);
    const day = dayFromItem(item);
    const saved = prepareConstructorDaysForSave([day]);
    expect(saved[0]!.kcal).toBe(day.kcal);
    expect(saved[0]!.protein_g).toBe(day.protein_g);
    expect(saved[0]!.fat_g).toBe(day.fat_g);
    expect(saved[0]!.carbs_g).toBe(day.carbs_g);
  });

  it("negative and NaN grams block save", () => {
    const negative = mealWith([line(chicken, 150, 0)]);
    negative.ingredients[0] = { ...negative.ingredients[0]!, grams: "-1.0000" };
    expect(() => prepareConstructorDaysForSave([dayFromItem(negative)])).toThrow(
      InvalidIngredientGramsError,
    );

    const nanMeal = mealWith([line(chicken, 150, 0)]);
    nanMeal.ingredients[0] = { ...nanMeal.ingredients[0]!, grams: "NaN" };
    expect(() => prepareConstructorDaysForSave([dayFromItem(nanMeal)])).toThrow(
      InvalidIngredientGramsError,
    );

    const dirty = snapshotOf(mealWith([line(chicken, 150, 0)]));
    dirty.constructor_days[0]!.items[0]!.ingredients[0] = {
      ...dirty.constructor_days[0]!.items[0]!.ingredients[0]!,
      grams: "-3",
    };
    expect(() => saveNutritionDraft(createEmptyStore(), "client-bad", dirty)).toThrow(
      InvalidIngredientGramsError,
    );

    const nanSnap = snapshotOf(mealWith([line(chicken, 150, 0)]));
    nanSnap.constructor_days[0]!.items[0]!.ingredients[0] = {
      ...nanSnap.constructor_days[0]!.items[0]!.ingredients[0]!,
      grams: "NaN",
    };
    expect(() => saveNutritionDraft(createEmptyStore(), "client-nan", nanSnap)).toThrow(
      InvalidIngredientGramsError,
    );
  });
});
