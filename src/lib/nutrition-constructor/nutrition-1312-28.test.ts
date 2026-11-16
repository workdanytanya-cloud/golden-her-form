import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { dayMenuKey, mealDifferenceRatio } from "@/lib/nutrition-constructor/month-plan";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { checkDayStructure } from "@/lib/nutrition-constructor/types";

describe("target gate", () => {
  it("rejects calories and macro splits that cannot be cooked before search", () => {
    const ctx = buildInMemoryCatalog();
    const outside = generateConstructorPlan(ctx, {
      targets: { kcal: d(3500), protein_g: d(200), fat_g: d(100), carbs_g: d(450), fiber_g: d(0) },
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      seed: 1,
    });
    expect(outside.reason_code).toBe("INVALID_TARGET");
    expect(outside.days).toHaveLength(0);
    const skewed = generateConstructorPlan(ctx, {
      targets: { kcal: d(1500), protein_g: d(230), fat_g: d(40), carbs_g: d(55), fiber_g: d(0) },
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "legacy_two_main_two_snacks" as "two_main_two_snacks",
      primary_meal_slot: "lunch",
      seed: 1,
    });
    expect(skewed.reason_code).toBe("INVALID_TARGET");
    expect(skewed.message).toMatch(/нормальными порциями/);
  });
});

describe("1312 kcal, two mains and two snacks, 28 days", () => {
  it("builds four different weeks inside the KBJU tolerance", () => {
    expect(112 * 4 + 56 * 9 + 90 * 4).toBe(1312);
    const ctx = buildInMemoryCatalog();
    const generated = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(1312),
        protein_g: d(112),
        fat_g: d(56),
        carbs_g: d(90),
        fiber_g: d(0),
      },
      days_count: 28,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
      seed: 1312,
      search_timeout_ms: 80_000,
    });
    expect(generated.is_valid, generated.message ?? generated.reason_code ?? "invalid").toBe(true);
    expect(generated.days).toHaveLength(28);
    const recipes = new Map(ctx.recipes.map((recipe) => [recipe.id, recipe]));
    const uses = new Map<string, number>();
    const keys = new Set<string>();
    for (let week = 0; week < 4; week += 1) {
      const slice = generated.days.slice(week * 7, week * 7 + 7);
      expect(evaluateStrictWeekVariety(slice, recipes, { allowRepeats: false })).toBeNull();
      if (week > 0) {
        expect(mealDifferenceRatio(generated.days.slice((week - 1) * 7, week * 7), slice)).toBeGreaterThanOrEqual(0.75);
      }
      for (const day of slice) {
        expect(checkDayStructure(day, "two_main_two_snacks").mains.actual).toBe(2);
        expect(checkDayStructure(day, "two_main_two_snacks").snacks.actual).toBe(2);
        const key = dayMenuKey(day);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
        for (const item of day.items) uses.set(item.recipe_id, (uses.get(item.recipe_id) ?? 0) + 1);
      }
    }
    expect([...uses.values()].every((count) => count <= 2)).toBe(true);
  }, 100_000);
});
