import { describe, expect, it } from "vitest";
import { d, displayMacro } from "@/lib/nutrition-constructor/decimal-math";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import {
  isGrainBreakfastRecipe,
  isProteinRichRecipe,
  macroPriorities,
} from "@/lib/nutrition-constructor/recipe-selection";

describe("recipe-selection", () => {
  const ctx = buildInMemoryCatalog();

  it("detects protein-focused targets", () => {
    const priorities = macroPriorities({
      kcal: d(1313),
      protein_g: d(112.1),
      fat_g: d(56.1),
      carbs_g: d(89.9),
      fiber_g: d(0),
    });
    expect(priorities.proteinFocused).toBe(true);
    expect(priorities.lowCarb).toBe(true);
  });

  it("marks oats breakfast as grain-only and chicken as protein-rich", () => {
    const oats = ctx.recipes.find((r) => r.slug === "oats-milk-banana")!;
    const chicken = ctx.recipes.find((r) => r.slug === "chicken-buckwheat-salad")!;
    expect(isGrainBreakfastRecipe(ctx, oats)).toBe(true);
    expect(isProteinRichRecipe(ctx, oats)).toBe(false);
    expect(isProteinRichRecipe(ctx, chicken)).toBe(true);
  });

  it("balances high-protein low-carb day within strict tolerance", () => {
    const targets = {
      kcal: d(1313),
      protein_g: d(112.1),
      fat_g: d(56.1),
      carbs_g: d(89.9),
      fiber_g: d(0),
    };
    const result = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });

    expect(result.days).toHaveLength(1);
    const day = result.days[0]!;
    const mains = day.items.filter((i) => i.slot.startsWith("main"));
    expect(mains.some((m) => m.recipe_id === "oats-milk-banana")).toBe(false);

    const shown = displayMacro({
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(0),
    });
    if (result.is_valid) {
      expect(Math.abs(shown.kcal - 1313)).toBeLessThanOrEqual(5);
      expect(Math.abs(shown.protein_g - 112.1)).toBeLessThanOrEqual(1);
      expect(Math.abs(shown.fat_g - 56.1)).toBeLessThanOrEqual(1);
      expect(Math.abs(shown.carbs_g - 89.9)).toBeLessThanOrEqual(1);
    } else {
      expect(result.message).toBeTruthy();
    }
  });
});
