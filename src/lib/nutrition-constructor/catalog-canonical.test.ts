import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import {
  ARCHIVED_DUPLICATE_SLUGS,
  formatTrainerVarietyLine,
} from "@/lib/nutrition-constructor/catalog-policy";
import { macroFromPer100 } from "@/lib/nutrition-constructor/decimal-math";
import { isAutoGenerationEligible } from "@/lib/nutrition-constructor/recipe-selection";
import {
  suggestSwaps,
  swapMovesBeyondTolerance,
} from "@/lib/nutrition-constructor/ingredient-swap";
import {
  replaceIngredientInMeal,
  SWAP_ROLE_MESSAGE,
  SWAP_TOLERANCE_MESSAGE,
} from "@/lib/nutrition-constructor/manual-meals";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import {
  consistentTargetsForKcal,
  validateMacroTargets,
} from "@/lib/nutrition-constructor/target-validation";
import { SAFE_KCAL } from "@/lib/nutrition-constructor/config";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";

describe("canonical catalog calculations", () => {
  const ctx = buildInMemoryCatalog();

  it("uses client names and keeps unverified products out of autogen", () => {
    expect(ctx.products.get("rice-white-dry")?.name).toBe("Рис сухой");
    expect(ctx.products.get("chicken-breast-raw")?.name).toBe("Филе куриной грудки");
    expect(ctx.products.get("egg-whole")?.name).toBe("Яйцо куриное");
    expect(ctx.products.get("egg-white-raw")?.name).toBe("Яичный белок");
    expect(ctx.products.get("canned-tuna")?.is_verified).toBe(true);
    expect(ctx.products.get("canned-corn")?.is_verified).toBe(true);
    expect(ctx.products.has("hard-cheese")).toBe(false);
    for (const product of ctx.products.values()) {
      expect(product.name.toLowerCase()).not.toContain("съедобн");
      for (const value of [
        product.kcal_per_100g,
        product.protein_per_100g,
        product.fat_per_100g,
        product.carbs_per_100g,
      ]) {
        const n = new Decimal(value);
        expect(n.isFinite()).toBe(true);
        expect(n.isNeg()).toBe(false);
      }
    }
  });

  it("sums recipe KBJU from ingredients without dropping a required product", () => {
    for (const recipe of ctx.recipes.filter((item) => item.is_active)) {
      const ings = ctx.recipeIngredients.get(recipe.id) ?? [];
      expect(ings.length).toBeGreaterThan(0);
      expect(
        ings.every(
          (ing) =>
            (ing.optional || ing.min_g > 0) &&
            ing.max_g >= ing.min_g &&
            (ing.default_g ?? ing.max_g) >= 0,
        ),
      ).toBe(true);
      expect(ings.some((ing) => !ing.optional && (ing.default_g ?? ing.min_g) > 0)).toBe(true);
      let kcal = new Decimal(0);
      let protein = new Decimal(0);
      let fat = new Decimal(0);
      let carbs = new Decimal(0);
      for (const ing of ings) {
        const product = ctx.products.get(ing.product_id);
        expect(product?.is_verified).toBe(true);
        const grams = ing.default_g ?? ing.min_g;
        expect(grams).toBeGreaterThan(0);
        const macros = macroFromPer100(
          {
            kcal: product!.kcal_per_100g,
            protein: product!.protein_per_100g,
            fat: product!.fat_per_100g,
            carbs: product!.carbs_per_100g,
          },
          grams,
        );
        kcal = kcal.plus(macros.kcal);
        protein = protein.plus(macros.protein_g);
        fat = fat.plus(macros.fat_g);
        carbs = carbs.plus(macros.carbs_g);
      }
      expect(kcal.isFinite() && protein.isFinite() && fat.isFinite() && carbs.isFinite()).toBe(
        true,
      );
      expect(kcal.gt(0)).toBe(true);
      const steps = recipe.steps.join(" ");
      if (!ings.some((ing) => ing.product_id === "hard-cheese")) {
        expect(steps.toLowerCase()).not.toContain("сыр");
      }
    }
  });

  it("archives the cheese-less omelette duplicate and keeps active recipes distinct", () => {
    const archived = ctx.recipes.find((recipe) => recipe.slug === "omelette-tomato-pepper-cheese");
    const canonical = ctx.recipes.find((recipe) => recipe.slug === "omelette-tomato-pepper");
    expect(archived?.is_active).toBe(false);
    expect(canonical?.is_active).toBe(true);
    expect(isAutoGenerationEligible(archived!)).toBe(false);
    expect(ARCHIVED_DUPLICATE_SLUGS.has("omelette-tomato-pepper-cheese")).toBe(true);
    const signatures = new Map<string, string[]>();
    for (const recipe of ctx.recipes.filter(
      (item) => item.is_active && isAutoGenerationEligible(item),
    )) {
      const key = (ctx.recipeIngredients.get(recipe.id) ?? [])
        .map((ing) => ing.product_id)
        .sort()
        .join("+");
      signatures.set(key, [...(signatures.get(key) ?? []), recipe.slug]);
      expect(
        (recipe.steps.length >= 3 && recipe.steps.length <= 7) || recipe.meal_type === "snack",
      ).toBe(true);
      expect(recipe.core_ingredient_count ?? 0).toBeLessThanOrEqual(8);
    }
    const dupes = [...signatures.values()].filter((slugs) => slugs.length > 1);
    expect(dupes).toEqual([]);
  });
});

describe("ingredient swaps", () => {
  const ctx = buildInMemoryCatalog();

  it("does not swap chicken for rice and rejects a move outside tolerance", () => {
    const chicken = ctx.products.get("chicken-breast-raw")!;
    const rice = ctx.products.get("rice-white-dry")!;
    const turkey = ctx.products.get("turkey-breast-raw")!;
    const swaps = suggestSwaps(
      {
        id: chicken.id,
        name: chicken.name,
        kcal_per_100g: Number(chicken.kcal_per_100g),
        protein_per_100g: Number(chicken.protein_per_100g),
        fat_per_100g: Number(chicken.fat_per_100g),
        carbs_per_100g: Number(chicken.carbs_per_100g),
        category: chicken.category,
        state: chicken.state,
        verified: true,
      },
      150,
      [chicken, rice, turkey].map((product) => ({
        id: product.id,
        name: product.name,
        kcal_per_100g: Number(product.kcal_per_100g),
        protein_per_100g: Number(product.protein_per_100g),
        fat_per_100g: Number(product.fat_per_100g),
        carbs_per_100g: Number(product.carbs_per_100g),
        category: product.category,
        state: product.state,
        verified: true,
        autogen: true,
      })),
      5,
    );
    expect(swaps.map((item) => item.product.id)).toEqual(["turkey-breast-raw"]);
    expect(
      swapMovesBeyondTolerance(
        { kcal: 1800, protein_g: 100, fat_g: 60, carbs_g: 180 },
        { kcal: 1900, protein_g: 100, fat_g: 60, carbs_g: 180 },
      ),
    ).toBe(true);

    const recipe = ctx.recipes.find((item) => item.slug === "chicken-rice-zucchini")!;
    const ings = (ctx.recipeIngredients.get(recipe.id) ?? []).map((ing, index) =>
      buildIngredientLine(ctx.products.get(ing.product_id)!, ing.default_g ?? ing.min_g, index),
    );
    const meal = buildMealPlanItem({ slot: "main1", recipe, ingredients: ings });
    const day: ConstructorDay = {
      day_index: 0,
      day_note: null,
      items: [{ ...meal, is_valid: true }],
      kcal: meal.kcal,
      protein_g: meal.protein_g,
      fat_g: meal.fat_g,
      carbs_g: meal.carbs_g,
      fiber_g: meal.fiber_g,
      is_valid: true,
    };
    expect(() =>
      replaceIngredientInMeal({
        day,
        slot: "main1",
        productId: "chicken-breast-raw",
        replacement: rice,
        forbiddenIds: new Set(),
        products: ctx.products,
      }),
    ).toThrow(SWAP_ROLE_MESSAGE);
    const swapped = replaceIngredientInMeal({
      day,
      slot: "main1",
      productId: "chicken-breast-raw",
      replacement: turkey,
      forbiddenIds: new Set(),
      products: ctx.products,
    });
    expect(swapped.items[0]!.recipe_name).toContain(turkey.name);
    expect(swapped.items[0]!.ingredients.some((ing) => ing.product_id === turkey.id)).toBe(true);
    expect(
      swapMovesBeyondTolerance(
        {
          kcal: Number(day.kcal),
          protein_g: Number(day.protein_g),
          fat_g: Number(day.fat_g),
          carbs_g: Number(day.carbs_g),
        },
        {
          kcal: Number(swapped.kcal),
          protein_g: Number(swapped.protein_g),
          fat_g: Number(swapped.fat_g),
          carbs_g: Number(swapped.carbs_g),
        },
      ),
    ).toBe(false);
  });
});

describe("1200–3500 target math", () => {
  it("validates every integer goal without NaN", () => {
    expect(SAFE_KCAL.min).toBeLessThanOrEqual(1200);
    expect(SAFE_KCAL.max).toBeGreaterThanOrEqual(3500);
    for (let kcal = 1200; kcal <= 3500; kcal += 1) {
      const targets = consistentTargetsForKcal(kcal);
      expect(targets.kcal.isFinite()).toBe(true);
      expect(targets.protein_g.isFinite()).toBe(true);
      expect(targets.fat_g.isFinite()).toBe(true);
      expect(targets.carbs_g.isFinite()).toBe(true);
      expect(validateMacroTargets(targets).ok).toBe(true);
      const shown = targets.kcal.toDecimalPlaces(0);
      expect(shown.minus(kcal).abs().lte(0)).toBe(true);
      const portion = macroFromPer100(
        { kcal: "120", protein: "20", fat: "2", carbs: "5" },
        new Decimal(kcal).div(1800).mul(100).toFixed(4),
      );
      expect(portion.kcal.gt(0)).toBe(true);
      expect(portion.protein_g.gt(0)).toBe(true);
    }
  });
});

describe("trainer variety line", () => {
  it("says seven different days when the week has no repeated dish", () => {
    const days: ConstructorDay[] = Array.from({ length: 7 }, (_, day) => ({
      day_index: day,
      day_note: null,
      items: Array.from({ length: 3 }, (__, slot) => ({
        slot: `main${slot + 1}` as "main1",
        recipe_id: `r-${day}-${slot}`,
        recipe_name: "Блюдо",
        requires_cooking: true,
        prep_time_min: 10,
        steps: ["a", "b", "c"],
        weighing_note: null,
        ingredients: [],
        kcal: "600",
        protein_g: "40",
        fat_g: "20",
        carbs_g: "50",
        fiber_g: "0",
        is_valid: true,
      })),
      kcal: "1800",
      protein_g: "120",
      fat_g: "60",
      carbs_g: "150",
      fiber_g: "0",
      is_valid: true,
    }));
    expect(formatTrainerVarietyLine(days)).toBe(
      "7 разных дней · 21 уникальное блюдо · повторов нет",
    );
  });
});
