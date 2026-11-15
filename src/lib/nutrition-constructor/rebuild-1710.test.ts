import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { checkDayStructure } from "@/lib/nutrition-constructor/types";

describe("rebuild 1710 kcal, 3 mains + 2 snacks, 7 days", () => {
  it("returns seven days inside the strict KBJU tolerance", () => {
    expect(DEFAULT_TOLERANCE).toEqual({ kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 });
    expect(150 * 4 + 70 * 9 + 120 * 4).toBe(1710);
    const generated = generateConstructorPlan(buildInMemoryCatalog(), {
      targets: {
        kcal: d(1710),
        protein_g: d(150),
        fat_g: d(70),
        carbs_g: d(120),
        fiber_g: d(0),
      },
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
      seed: 1710,
      search_timeout_ms: 45_000,
    });
    expect(generated.is_valid, generated.message ?? generated.reason_code ?? "invalid").toBe(true);
    expect(generated.days).toHaveLength(7);
    for (const day of generated.days) {
      const structure = checkDayStructure(day, "three_main_two_snacks");
      expect(structure.mains.actual).toBe(3);
      expect(structure.snacks.actual).toBe(2);
    }
  }, 70_000);
});
