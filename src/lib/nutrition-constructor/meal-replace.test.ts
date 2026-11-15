import { describe, expect, it } from "vitest";
import { buildMealPlanItem, buildIngredientLine } from "@/lib/nutrition-constructor/calculator";
import {
  CANNOT_FIT_RECIPE,
  LEGACY_REBUILD_SEED,
  countReplacedMeals,
  fitRecipeIntoDay,
  freshRebuildSeed,
  rebuildSaveDecision,
  recipeRepeatReason,
} from "@/lib/nutrition-constructor/meal-replace";
import { replaceMealInDay, ManualMealEditError } from "@/lib/nutrition-constructor/manual-meals";
import type {
  ConstructorDay,
  FoodProduct,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";

function product(
  id: string,
  name: string,
  kcal: string,
  protein: string,
  fat: string,
  carbs: string,
): FoodProduct {
  return {
    id,
    slug: id,
    name,
    category: "meat",
    brand: null,
    state: "raw",
    measurement_basis: "100g",
    kcal_per_100g: kcal,
    protein_per_100g: protein,
    fat_per_100g: fat,
    carbs_per_100g: carbs,
    fiber_per_100g: "0",
    density: null,
    source_name: "test",
    source_url: null,
    verified_at: null,
    is_verified: true,
    is_active: true,
    allowed_for_snack: false,
    requires_cooking: true,
    weighing_note: null,
  };
}

function recipe(id: string, name: string): Recipe {
  return {
    id,
    slug: id,
    name,
    meal_type: "main",
    steps: ["Подготовить.", "Довести до готовности.", "Подать."],
    prep_time_min: 20,
    requires_cooking: true,
    is_active: true,
    weighing_note: null,
    is_nutrient_dense: true,
    contains_protein_source: true,
    contains_fruit_or_vegetable: false,
    is_treat: false,
    allowed_schedule_modes: ["three_mains_only"],
    snack_action: null,
  };
}

function ingredient(
  recipeId: string,
  productId: string,
  grams: number,
  order: number,
): RecipeIngredient {
  return {
    id: `${recipeId}-${productId}`,
    recipe_id: recipeId,
    product_id: productId,
    min_g: 20,
    max_g: 400,
    default_g: grams,
    is_scalable: true,
    sort_order: order,
    optional: false,
  };
}

describe("meal replacement", () => {
  const chicken = product("chicken", "Курица", "110", "23", "1", "0");
  const rice = product("rice", "Рис", "130", "2.7", "0.3", "28");
  const turkey = product("turkey", "Индейка", "110", "23", "1", "0");
  const buckwheat = product("buckwheat", "Гречка", "130", "2.7", "0.3", "28");
  const products = new Map([chicken, rice, turkey, buckwheat].map((item) => [item.id, item]));
  const side = buildMealPlanItem({
    slot: "main2",
    recipe: recipe("side", "Овощи"),
    ingredients: [buildIngredientLine(product("veg", "Огурец", "15", "0.6", "0.1", "3"), 100, 0)],
  });
  const original = buildMealPlanItem({
    slot: "main1",
    recipe: recipe("rice-bowl", "Курица с рисом"),
    ingredients: [buildIngredientLine(chicken, 150, 0), buildIngredientLine(rice, 80, 1)],
  });
  const day: ConstructorDay = {
    day_index: 2,
    day_note: null,
    items: [original, side],
    kcal: String(Number(original.kcal) + Number(side.kcal)),
    protein_g: String(Number(original.protein_g) + Number(side.protein_g)),
    fat_g: String(Number(original.fat_g) + Number(side.fat_g)),
    carbs_g: String(Number(original.carbs_g) + Number(side.carbs_g)),
    fiber_g: "0",
    is_valid: true,
  };
  const targets = {
    kcal: Number(day.kcal),
    protein_g: Number(day.protein_g),
    fat_g: Number(day.fat_g),
    carbs_g: Number(day.carbs_g),
  };

  it("replaces only the selected slot and keeps the day inside tolerance", () => {
    const fitted = fitRecipeIntoDay({
      day,
      slot: "main1",
      recipe: recipe("buckwheat-bowl", "Индейка с гречкой"),
      ingredients: [
        ingredient("buckwheat-bowl", "turkey", 150, 0),
        ingredient("buckwheat-bowl", "buckwheat", 80, 1),
      ],
      products,
      targets,
    });
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    expect(fitted.preview.day.items.find((item) => item.slot === "main2")).toBe(side);
    expect(fitted.preview.day.items.find((item) => item.slot === "main1")?.recipe_id).toBe(
      "buckwheat-bowl",
    );
    expect(fitted.preview.day.items).toHaveLength(2);
    expect(Math.abs(fitted.preview.after.kcal - targets.kcal)).toBeLessThanOrEqual(5);
    expect(Math.abs(fitted.preview.after.protein_g - targets.protein_g)).toBeLessThanOrEqual(1);
    expect(Math.abs(fitted.preview.after.fat_g - targets.fat_g)).toBeLessThanOrEqual(1);
    expect(Math.abs(fitted.preview.after.carbs_g - targets.carbs_g)).toBeLessThanOrEqual(1);
  });

  it("does not save a recipe that cannot hit the remaining macros", () => {
    const fitted = fitRecipeIntoDay({
      day,
      slot: "main1",
      recipe: recipe("oil", "Масло"),
      ingredients: [
        {
          ...ingredient("oil", "oil", 10, 0),
          min_g: 10,
          max_g: 10,
        },
      ],
      products: new Map([["oil", product("oil", "Масло", "900", "0", "100", "0")]]),
      targets,
    });
    expect(fitted.ok).toBe(false);
    if (fitted.ok) return;
    expect(fitted.message).toBe(CANNOT_FIT_RECIPE);
  });

  it("refuses a missing slot instead of appending a meal", () => {
    expect(() =>
      replaceMealInDay({
        day,
        item: { ...original, slot: "snack3" },
        products,
      }),
    ).toThrow(ManualMealEditError);
  });

  it("counts a real recipe change and rejects an unchanged rebuild", () => {
    expect(
      countReplacedMeals(
        [{ day_index: 0, items: [{ slot: "main1", recipe_id: "rice" }] }],
        [{ day_index: 0, items: [{ slot: "main1", recipe_id: "buckwheat" }] }],
      ),
    ).toEqual({ changed: 1, total: 1 });
    expect(rebuildSaveDecision({ valid: true, changed: 0, total: 3, hadDraft: true }).success).toBe(
      false,
    );
    expect(rebuildSaveDecision({ valid: true, changed: 2, total: 3, hadDraft: true }).message).toBe(
      "Рацион пересобран: изменено 2 из 3 приёмов",
    );
    expect(freshRebuildSeed(LEGACY_REBUILD_SEED)).not.toBe(LEGACY_REBUILD_SEED);
  });

  it("blocks a recipe already used in the week", () => {
    const candidate = recipe("rice-bowl", "Курица с рисом");
    expect(
      recipeRepeatReason([day], [candidate], candidate, { dayIndex: 0, slot: "main2" }),
    ).toMatch(/уже используется/);
  });
});
