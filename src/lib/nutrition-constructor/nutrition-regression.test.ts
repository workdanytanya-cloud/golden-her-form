import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";

/** Профиль, на котором ранее фиксировался избыток белка и недобор жиров (high-protein, ~1313 kcal). */
const REGRESSION_TARGETS = {
  kcal: d(1313),
  protein_g: d(112.1),
  fat_g: d(56.1),
  carbs_g: d(89.9),
  fiber_g: d(0),
};

const MODES: MealScheduleMode[] = [
  "three_main_two_snacks",
  "three_mains_only",
  "one_main_three_snacks",
  "two_main_two_snacks",
];

describe("regression: former +38g protein / -16g fat case", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  for (const mode of MODES) {
    it(`passes strict tolerance on ${mode}`, () => {
      const gen = generateConstructorPlan(ctx, {
        targets: REGRESSION_TARGETS,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: mode,
        primary_meal_slot: "lunch",
      });
      expect(gen.days.length).toBe(1);
      expect(gen.is_valid, gen.message ?? "not valid").toBe(true);
      const macro = {
        kcal: d(gen.days[0]!.kcal),
        protein_g: d(gen.days[0]!.protein_g),
        fat_g: d(gen.days[0]!.fat_g),
        carbs_g: d(gen.days[0]!.carbs_g),
        fiber_g: d(0),
      };
      expect(withinTolerance(macro, REGRESSION_TARGETS, DEFAULT_TOLERANCE)).toBe(true);
    });
  }

  it("is deterministic for identical inputs", () => {
    const input = {
      targets: REGRESSION_TARGETS,
      days_count: 1 as const,
      excluded_product_ids: [] as string[],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks" as const,
      primary_meal_slot: "lunch" as const,
    };
    const a = generateConstructorPlan(ctx, input);
    const b = generateConstructorPlan(ctx, input);
    expect(a.days[0]!.protein_g).toBe(b.days[0]!.protein_g);
    expect(a.days[0]!.fat_g).toBe(b.days[0]!.fat_g);
    expect(a.days[0]!.kcal).toBe(b.days[0]!.kcal);
  });

  it("never marks structurally valid but macro-invalid plan as assignable", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(1800),
        protein_g: d(250),
        fat_g: d(20),
        carbs_g: d(20),
        fiber_g: d(0),
      },
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    if (!gen.is_valid) {
      expect(gen.kbju_acceptable).toBe(false);
    }
  });
});
