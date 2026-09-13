import { describe, expect, it } from "vitest";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { evaluatePlanKbjuStatus } from "@/lib/nutrition-constructor/plan-kbju-status";
import type { ConstructorDay, MealPlanItem } from "@/lib/nutrition-constructor/types";

function meal(slot: MealPlanItem["slot"], macros: { kcal: string; p: string; f: string; c: string }): MealPlanItem {
  return {
    slot,
    recipe_id: `r-${slot}`,
    recipe_name: slot,
    requires_cooking: slot.startsWith("main"),
    prep_time_min: null,
    steps: [],
    weighing_note: null,
    ingredients: [],
    kcal: macros.kcal,
    protein_g: macros.p,
    fat_g: macros.f,
    carbs_g: macros.c,
    fiber_g: "0",
    is_valid: false,
  };
}

function sampleDay(overrides: Partial<ConstructorDay> = {}): ConstructorDay {
  return {
    day_index: 0,
    day_note: null,
    items: [
      meal("main1", { kcal: "500", p: "30", f: "15", c: "50" }),
      meal("snack1", { kcal: "200", p: "10", f: "8", c: "20" }),
      meal("snack2", { kcal: "200", p: "10", f: "8", c: "20" }),
      meal("snack3", { kcal: "200", p: "10", f: "8", c: "20" }),
    ],
    kcal: "1100",
    protein_g: "60",
    fat_g: "39",
    carbs_g: "110",
    fiber_g: "11",
    is_valid: false,
    ...overrides,
  };
}

describe("plan-kbju-status", () => {
  it("rejects generation when structure ok but macros are off", () => {
    const target = {
      kcal: d(1800),
      protein_g: d(120),
      fat_g: d(60),
      carbs_g: d(180),
      fiber_g: d(0),
    };
    const comparison = [
      { label: "Калории", target: 1800, actual: 1100, diff: -700 },
      { label: "Белки", target: 120, actual: 105, diff: -15 },
      { label: "Жиры", target: 60, actual: 39, diff: -21 },
      { label: "Углеводы", target: 180, actual: 250, diff: 70 },
    ];
    const status = evaluatePlanKbjuStatus({
      days: [sampleDay()],
      targetMacro: target,
      scheduleMode: "one_main_three_snacks",
      comparison,
    });
    expect(status.generationOk).toBe(false);
    expect(status.acceptable).toBe(false);
    expect(status.precisionHint).toContain("−15 г белка");
    expect(status.precisionHint).toContain("+70 г углеводов");
  });

  it("marks acceptable when day within strict tolerance", () => {
    const target = {
      kcal: d(1800),
      protein_g: d(120),
      fat_g: d(60),
      carbs_g: d(180),
      fiber_g: d(0),
    };
    const comparison = [
      { label: "Калории", target: 1800, actual: 1803, diff: 3 },
      { label: "Белки", target: 120, actual: 119, diff: -1 },
      { label: "Жиры", target: 60, actual: 61, diff: 1 },
      { label: "Углеводы", target: 180, actual: 181, diff: 1 },
    ];
    const day = sampleDay({
      kcal: "1803",
      protein_g: "119",
      fat_g: "61",
      carbs_g: "181",
      is_valid: true,
    });
    const status = evaluatePlanKbjuStatus({
      days: [day],
      targetMacro: target,
      scheduleMode: "one_main_three_snacks",
      comparison,
    });
    expect(status.acceptable).toBe(true);
    expect(status.generationOk).toBe(true);
    expect(status.exact).toBe(true);
  });
});
