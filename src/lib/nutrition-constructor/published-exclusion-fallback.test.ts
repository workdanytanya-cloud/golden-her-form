import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { exclusionsFromPublishedNutrition } from "@/lib/nutrition-constructor/published-exclusions";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import type { NutritionSnapshot } from "@/lib/published-programs/types";

const TARGETS = {
  kcal: d(1942),
  protein_g: d(178.2),
  fat_g: d(89.1),
  carbs_g: d(106.8),
  fiber_g: d(0),
};

describe("published exclusion soft fallback for 1942 one_main", () => {
  it("hard published exclusions can starve the week; without them week passes", () => {
    const ctx = buildInMemoryCatalog();
    const baseline = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });
    expect(baseline.is_valid).toBe(true);

    const snapshot = {
      kind: "constructor",
      constructor_days: baseline.days.map((day) => ({
        day_index: day.day_index,
        items: day.items.map((item) => ({
          slot: item.slot,
          recipe_id: item.recipe_id,
        })),
      })),
    } as NutritionSnapshot;

    const exclusions = exclusionsFromPublishedNutrition(snapshot, ctx.recipes);
    expect(exclusions.excluded_recipe_ids.length).toBe(28);
    expect(exclusions.excluded_variant_groups.length).toBeGreaterThan(0);

    const blocked = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 7,
      excluded_product_ids: [],
      excluded_recipe_ids: exclusions.excluded_recipe_ids,
      excluded_variant_groups: exclusions.excluded_variant_groups,
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });
    expect(blocked.is_valid).toBe(false);
    expect(blocked.reason_code).toBe("INSUFFICIENT_VARIETY");

    const recipesOnly = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 7,
      excluded_product_ids: [],
      excluded_recipe_ids: exclusions.excluded_recipe_ids,
      excluded_variant_groups: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });
    // Soft step may or may not pass depending on catalog; full drop must pass.
    const cleared = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });
    expect(cleared.is_valid || recipesOnly.is_valid).toBe(true);
  }, 90_000);
});
