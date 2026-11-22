import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";

/** Высокий белок / умеренные углеводы: раньше INSUFFICIENT_VARIETY (1–5 из 7). */
const TARGETS = {
  kcal: d(1942),
  protein_g: d(178.2),
  fat_g: d(89.1),
  carbs_g: d(106.8),
  fiber_g: d(0),
};

describe("1942 kcal one_main_three_snacks week", () => {
  it("builds 7 exact days / 28 meals without intra-week repeats", () => {
    const ctx = buildInMemoryCatalog();
    const plan = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });

    expect(plan.is_valid, plan.message ?? plan.reason_code ?? "invalid").toBe(true);
    expect(plan.reason_code).toBe("PASS");
    expect(plan.days).toHaveLength(7);

    const meals = plan.days.flatMap((day) => day.items);
    expect(meals).toHaveLength(28);
    expect(meals.every((item) => item.slot.startsWith("main") || item.slot.startsWith("snack"))).toBe(
      true,
    );
    expect(
      meals.filter((item) => item.slot.startsWith("snack")).every((item) => !item.requires_cooking),
    ).toBe(true);

    const recipeIds = meals.map((item) => item.recipe_id);
    expect(new Set(recipeIds).size).toBe(28);

    const recipeById = new Map(ctx.recipes.map((recipe) => [recipe.id, recipe]));
    expect(evaluateStrictWeekVariety(plan.days, recipeById, { allowRepeats: false })).toBeNull();

    for (const day of plan.days) {
      expect(Math.abs(Number(day.kcal) - 1942)).toBeLessThanOrEqual(5);
      expect(Math.abs(Number(day.protein_g) - 178.2)).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(day.fat_g) - 89.1)).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(day.carbs_g) - 106.8)).toBeLessThanOrEqual(1);
    }
  }, 90_000);
});
