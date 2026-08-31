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

  it("builds classic day closer to high-protein low-carb targets", () => {
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
    expect(
      mains.some(
        (m) => m.recipe_id.includes("chicken") || m.recipe_id.includes("omelette"),
      ),
    ).toBe(true);

    const actual = {
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(0),
    };
    const shown = displayMacro(actual);
    expect(shown.kcal).toBeGreaterThanOrEqual(1308);
    expect(shown.kcal).toBeLessThanOrEqual(1318);
    expect(shown.protein_g).toBeGreaterThan(100);
    expect(shown.protein_g).toBeLessThan(125);
    expect(shown.carbs_g).toBeGreaterThan(80);
    expect(shown.carbs_g).toBeLessThan(115);
    expect(Math.abs(shown.protein_g - 112.1)).toBeLessThan(5);
    expect(Math.abs(shown.carbs_g - 89.9)).toBeLessThan(25);
  });
});
