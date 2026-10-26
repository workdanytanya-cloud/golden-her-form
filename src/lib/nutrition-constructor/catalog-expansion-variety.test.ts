import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import {
  evaluateStrictWeekVariety,
  formatInsufficientVarietyMessage,
} from "@/lib/nutrition-constructor/recipe-variety";
import {
  EXPANSION_PRODUCT_COUNT,
  EXPANSION_RECIPE_COUNT,
  SEED_PRODUCTS,
  SEED_RECIPES,
} from "@/lib/nutrition-constructor/seed-data";
import { EXPANSION_RECIPES } from "@/lib/nutrition-constructor/seed-catalog-expansion";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

describe("catalog expansion + variety", () => {
  it("adds at least 20 products and 48 recipes without slug duplicates", () => {
    expect(EXPANSION_PRODUCT_COUNT).toBeGreaterThanOrEqual(20);
    expect(EXPANSION_RECIPE_COUNT).toBeGreaterThanOrEqual(48);
    const productSlugs = SEED_PRODUCTS.map((p) => p.slug);
    expect(new Set(productSlugs).size).toBe(productSlugs.length);
    const recipeSlugs = SEED_RECIPES.map((r) => r.slug);
    expect(new Set(recipeSlugs).size).toBe(recipeSlugs.length);
  });

  it("distributes new recipes across meal roles", () => {
    const breakfast = EXPANSION_RECIPES.filter((r) => r.meal_types.includes("breakfast")).length;
    const lunch = EXPANSION_RECIPES.filter((r) => r.meal_types.includes("lunch")).length;
    const dinner = EXPANSION_RECIPES.filter((r) => r.meal_types.includes("dinner")).length;
    const snack = EXPANSION_RECIPES.filter((r) => r.meal_types.includes("snack")).length;
    expect(breakfast).toBeGreaterThanOrEqual(12);
    expect(lunch).toBeGreaterThanOrEqual(14);
    expect(dinner).toBeGreaterThanOrEqual(12);
    expect(snack).toBeGreaterThanOrEqual(10);
  });

  it("marks required ingredients as non-optional with min_g > 0", () => {
    const ctx = buildInMemoryCatalog();
    for (const recipe of ctx.recipes.filter((r) => r.slug.startsWith("breakfast-") || r.slug.startsWith("lunch-"))) {
      const ings = ctx.recipeIngredients.get(recipe.id) ?? [];
      const required = ings.filter((ing) => !ing.optional);
      expect(required.length).toBeGreaterThan(0);
      for (const ing of required) {
        expect(ing.min_g).toBeGreaterThan(0);
      }
    }
  });

  it("fills variety metadata for all recipes", () => {
    const ctx = buildInMemoryCatalog();
    for (const recipe of ctx.recipes) {
      expect(recipe.variant_group).toBeTruthy();
      expect(recipe.ingredient_signature).toBeTruthy();
      expect(recipe.primary_protein).toBeTruthy();
      expect(recipe.primary_carb).toBeTruthy();
      expect(recipe.cooking_method).toBeTruthy();
      expect((recipe.meal_types ?? []).length).toBeGreaterThan(0);
    }
  });

  it("builds a synthetic 7-day week without recipe/variant repeats when possible", () => {
    const ctx = buildInMemoryCatalog();
    const gen = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1800),
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      allow_repeats: false,
      seed: 42,
      search_timeout_ms: 45_000,
    });

    if (!gen.is_valid) {
      expect(gen.reason_code).toBe("INSUFFICIENT_VARIETY");
      expect(gen.message ?? "").toContain("INSUFFICIENT_VARIETY");
      return;
    }

    expect(gen.days).toHaveLength(7);
    const meals = gen.days.flatMap((day) => day.items.filter((item) => item.slot.startsWith("main")));
    expect(meals).toHaveLength(21);
    const recipeIds = meals.map((item) => item.recipe_id);
    expect(new Set(recipeIds).size).toBe(recipeIds.length);
    const recipeById = new Map(ctx.recipes.map((recipe) => [recipe.id, recipe]));
    const groups = meals
      .map((item) => recipeById.get(item.recipe_id)?.variant_group)
      .filter(Boolean) as string[];
    expect(new Set(groups).size).toBe(groups.length);
    const violation = evaluateStrictWeekVariety(gen.days, recipeById, { allowRepeats: false });
    expect(violation).toBeNull();
  }, 60_000);

  it("returns INSUFFICIENT_VARIETY for artificially tiny catalog", () => {
    const base = buildInMemoryCatalog();
    const tinyMains = base.mainRecipes.slice(0, 3);
    const tiny: typeof base = {
      ...base,
      recipes: [...tinyMains, ...base.snackRecipes.slice(0, 2)],
      mainRecipes: tinyMains,
      snackRecipes: base.snackRecipes.slice(0, 2),
    };
    const gen = generateConstructorPlan(tiny, {
      targets: consistentTargetsForKcal(1800),
      days_count: 7,
      excluded_product_ids: ["chicken-breast-raw"],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      allow_repeats: false,
      seed: 7,
      search_timeout_ms: 8_000,
    });
    expect(gen.is_valid).toBe(false);
    expect([
      "INSUFFICIENT_VARIETY",
      "INFEASIBLE",
      "NO_ALLOWED_PRODUCTS",
      "TIMEOUT",
    ]).toContain(gen.reason_code);
    if (gen.reason_code === "INSUFFICIENT_VARIETY") {
      expect(formatInsufficientVarietyMessage({
        code: "INSUFFICIENT_VARIETY",
        unique_days: gen.diagnostics?.unique_week_days ?? 0,
        limiting_meal_type: "week",
        missing: ["тест"],
        detail: "тест",
      })).toContain("INSUFFICIENT_VARIETY");
    }
  });

  it("does not allow dropping required ingredients below min", () => {
    const ctx = buildInMemoryCatalog();
    const recipe = ctx.recipes.find((row) => row.slug === "lunch-chicken-bulgur-broccoli");
    expect(recipe).toBeTruthy();
    const ings = ctx.recipeIngredients.get(recipe!.id) ?? [];
    const chicken = ings.find((ing) => ing.product_id === "chicken-breast-raw");
    expect(chicken).toBeTruthy();
    expect(chicken!.optional).toBe(false);
    expect(chicken!.min_g).toBeGreaterThan(0);
  });

  it("keeps all expansion recipes in the verified autogen catalog", () => {
    const ctx = buildInMemoryCatalog();
    const missing = EXPANSION_RECIPES.filter(
      (recipe) => !ctx.recipes.some((row) => row.slug === recipe.slug),
    ).map((recipe) => recipe.slug);
    expect(missing).toEqual([]);
  });
});

describe("variety helper unit", () => {
  it("detects repeated recipe_id", () => {
    const recipeById = new Map<string, Recipe>([
      [
        "a",
        {
          id: "a",
          slug: "a",
          name: "A",
          meal_type: "main",
          steps: [],
          prep_time_min: 10,
          requires_cooking: true,
          is_active: true,
          weighing_note: null,
          is_nutrient_dense: true,
          contains_protein_source: true,
          contains_fruit_or_vegetable: true,
          is_treat: false,
          allowed_schedule_modes: ["three_mains_only"],
          snack_action: null,
          variant_group: "chicken|rice|boil",
          ingredient_signature: "boil|chicken+rice",
          primary_protein: "chicken",
          primary_carb: "rice",
          meal_types: ["lunch"],
        },
      ],
    ]);
    const day = (id: string): ConstructorDay => ({
      day_index: 0,
      day_note: null,
      is_valid: true,
      kcal: "1",
      protein_g: "1",
      fat_g: "1",
      carbs_g: "1",
      fiber_g: "0",
      items: [
        {
          slot: "main1",
          recipe_id: id,
          recipe_name: "A",
          requires_cooking: true,
          prep_time_min: 10,
          steps: [],
          weighing_note: null,
          snack_action: null,
          is_valid: true,
          kcal: "1",
          protein_g: "1",
          fat_g: "1",
          carbs_g: "1",
          fiber_g: "0",
          ingredients: [],
        },
      ],
    });
    const violation = evaluateStrictWeekVariety([day("a"), day("a")], recipeById, {
      allowRepeats: false,
    });
    expect(violation?.code).toBe("INSUFFICIENT_VARIETY");
  });
});
