import { describe, expect, it } from "vitest";
import { buildIngredientLine } from "@/lib/nutrition-constructor/calculator";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { replaceIngredientInMeal } from "@/lib/nutrition-constructor/manual-meals";
import { buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import {
  composeRecipeSteps,
  validateRecipeInstruction,
  type InstructionIngredient,
} from "@/lib/nutrition-constructor/recipe-instructions";
import { nutritionPdfBlocks } from "@/lib/pdf/snapshot-content";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";

function ingredient(
  slug: string,
  name: string,
  extra: Partial<InstructionIngredient> = {},
): InstructionIngredient {
  return { slug, name, required: true, ...extra };
}

describe("recipe instructions", () => {
  it("cooks oats that are actually in the recipe", () => {
    const ingredients = [
      ingredient("oats-dry", "Овсяные хлопья сухие", { category: "grain", requiresCooking: true }),
      ingredient("cod-raw", "Треска, филе", { category: "fish", state: "raw", requiresCooking: true }),
      ingredient("egg-whole", "Яйцо куриное", { requiresCooking: true }),
    ];
    const composed = composeRecipeSteps({
      name: "Треска с яйцом и овсянкой",
      requiresCooking: true,
      cookingMethod: "bake",
      ingredients,
    });
    const text = composed.steps.join(" ");
    expect(text.toLowerCase()).not.toContain("без крупы");
    expect(text.toLowerCase()).toMatch(/овсян/);
    expect(text.toLowerCase()).toMatch(/вар/);
    expect(validateRecipeInstruction({ name: "Треска с яйцом и овсянкой", requiresCooking: true, ingredients, steps: composed.steps })).toEqual([]);
  });

  it("cooks rice, buckwheat and oats", () => {
    for (const item of [
      ingredient("rice-white-dry", "Рис сухой", { category: "grain" }),
      ingredient("buckwheat-dry", "Гречка сухая", { category: "grain" }),
      ingredient("oats-dry", "Овсяные хлопья сухие", { category: "grain" }),
    ]) {
      const composed = composeRecipeSteps({
        name: item.name,
        requiresCooking: true,
        ingredients: [item, ingredient("cucumber", "Огурец", { requiresCooking: false, state: "ready" })],
      });
      expect(composed.steps.join(" ").toLowerCase()).toMatch(/вар|залей|готовност|мягкост/);
    }
  });

  it("cooks raw meat and fish", () => {
    const meat = composeRecipeSteps({
      name: "Курица",
      requiresCooking: true,
      cookingMethod: "bake",
      ingredients: [ingredient("chicken-breast-raw", "Филе куриной грудки", { category: "meat", state: "raw" })],
    });
    const fish = composeRecipeSteps({
      name: "Треска",
      requiresCooking: true,
      ingredients: [ingredient("cod-raw", "Треска, филе", { category: "fish", state: "raw" })],
    });
    expect(meat.steps.join(" ").toLowerCase()).toMatch(/запек|туш|готовност/);
    expect(fish.steps.join(" ").toLowerCase()).toMatch(/запек|отвар|готовност/);
  });

  it("keeps a no-cook snack free of raw meat", () => {
    const ingredients = [
      ingredient("cooked-chicken-breast", "Готовая курица", { state: "ready", requiresCooking: false, category: "meat" }),
      ingredient("cucumber", "Огурец", { state: "ready", requiresCooking: false }),
    ];
    const composed = composeRecipeSteps({
      name: "Курица с огурцом",
      requiresCooking: false,
      mealType: "snack",
      ingredients,
    });
    expect(composed.kind).toBe("no_cook_snack");
    expect(validateRecipeInstruction({
      name: "Курица с огурцом",
      requiresCooking: false,
      mealType: "snack",
      ingredients,
      steps: composed.steps,
    })).toEqual([]);
  });

  it("does not mention milk that is not in the recipe", () => {
    const ingredients = [ingredient("oats-dry", "Овсяные хлопья сухие", { category: "grain" })];
    const composed = composeRecipeSteps({ name: "Овсянка", requiresCooking: true, ingredients });
    expect(composed.steps.join(" ").toLowerCase()).not.toMatch(/молок/);
  });

  it("rewrites rice to buckwheat and chicken to turkey", () => {
    const ctx = buildInMemoryCatalog();
    const recipe = ctx.recipes.find((item) => item.slug === "chicken-rice-zucchini");
    expect(recipe).toBeTruthy();
    const rice = ctx.products.get("rice-white-dry")!;
    const buckwheat = ctx.products.get("buckwheat-dry")!;
    const chicken = ctx.products.get("chicken-breast-raw")!;
    const turkey = ctx.products.get("turkey-breast-raw")!;
    const ings = (ctx.recipeIngredients.get(recipe!.id) ?? []).map((ing, index) =>
      buildIngredientLine(ctx.products.get(ing.product_id)!, ing.default_g ?? ing.min_g, index),
    );
    const meal = buildMealPlanItem({ slot: "main1", recipe: recipe as Recipe, ingredients: ings });
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
    const withBuckwheat = replaceIngredientInMeal({
      day,
      slot: "main1",
      productId: rice.id,
      replacement: buckwheat,
      forbiddenIds: new Set(),
      products: ctx.products,
    });
    const grainText = withBuckwheat.items[0]!.steps.join(" ").toLowerCase();
    expect(grainText).toMatch(/греч/);
    expect(grainText).not.toMatch(/\bрис/);
    const withTurkey = replaceIngredientInMeal({
      day,
      slot: "main1",
      productId: chicken.id,
      replacement: turkey,
      forbiddenIds: new Set(),
      products: ctx.products,
    });
    const proteinText = withTurkey.items[0]!.steps.join(" ").toLowerCase();
    expect(proteinText).toMatch(/индей/);
    expect(proteinText).not.toMatch(/куриц/);
  });

  it("checks every active catalog recipe", () => {
    const ctx = buildInMemoryCatalog();
    const failures: string[] = [];
    let active = 0;
    let excluded = 0;
    for (const recipe of ctx.recipes) {
      if (!recipe.is_active) continue;
      active += 1;
      const ingredients = (ctx.recipeIngredients.get(recipe.id) ?? []).map((ing) => {
        const product = ctx.products.get(ing.product_id)!;
        return {
          slug: product.slug,
          name: product.name,
          required: true,
          category: product.category,
          state: product.state,
          requiresCooking: product.requires_cooking,
        };
      });
      const issues = validateRecipeInstruction({
        name: recipe.name,
        requiresCooking: recipe.requires_cooking,
        cookingMethod: recipe.cooking_method,
        mealType: recipe.meal_type,
        ingredients,
        steps: recipe.steps,
      });
      if (issues.length > 0 || recipe.dietitian_approved === false) {
        excluded += 1;
        failures.push(`${recipe.slug}: ${issues.join(",")}`);
      }
    }
    expect(failures, `${excluded} of ${active}`).toEqual([]);
  });

  it("labels ingredients and cooking in the pdf", () => {
    const blocks = nutritionPdfBlocks(
      {
        kind: "constructor",
        notes: "",
        constructor_days: [
          {
            day_index: 0,
            day_note: null,
            kcal: "1800",
            protein_g: "120",
            fat_g: "60",
            carbs_g: "180",
            items: [
              {
                slot: "main1",
                recipe_id: "oats",
                recipe_name: "Овсянка",
                requires_cooking: true,
                prep_time_min: 10,
                steps: ["Отмерьте овсяные хлопья и варите.", "Соберите блюдо и сразу подайте.", "Готово к подаче."],
                weighing_note: null,
                ingredients: [
                  {
                    product_id: "oats-dry",
                    product_name: "Овсяные хлопья сухие",
                    grams: "50",
                    weighing_note: "сухой вес",
                    kcal_per_100g: "379",
                    protein_per_100g: "13",
                    fat_per_100g: "7",
                    carbs_per_100g: "60",
                    fiber_per_100g: null,
                    kcal: "190",
                    protein_g: "6",
                    fat_g: "3",
                    carbs_g: "30",
                    fiber_g: "0",
                    sort_order: 0,
                  },
                ],
                kcal: "190",
                protein_g: "6",
                fat_g: "3",
                carbs_g: "30",
                fiber_g: "0",
                is_valid: true,
              },
            ],
          },
        ],
      } as never,
      { clientName: "Тест", courseTitle: "Курс", courseStart: "2026-11-15", courseEnd: "2026-12-12", issuedAt: "2026-11-15" },
    );
    const text = blocks.flatMap((block) => block.lines).join("\n");
    expect(text).toContain("Ингредиенты:");
    expect(text).toContain("Как приготовить:");
    expect(text).toContain("Овсяные хлопья сухие");
  });
});

describe("one 1800 kcal week", () => {
  it("builds seven days from the corrected catalog", () => {
    const ctx = buildInMemoryCatalog();
    const generated = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1800),
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
      seed: 1800,
      search_timeout_ms: 45_000,
    });
    expect(generated.is_valid, generated.message ?? undefined).toBe(true);
    expect(generated.days).toHaveLength(7);
    const steps = generated.days.flatMap((day) => day.items.flatMap((item) => item.steps)).join(" ");
    expect(steps.toLowerCase()).not.toContain("без крупы");
  }, 60_000);
});
