import { describe, expect, it } from "vitest";
import { checkNutritionDraft } from "@/lib/nutrition-constructor/draft-check";
import type { ConstructorDay, FoodProduct } from "@/lib/nutrition-constructor/types";

function day(macros: { k: number; p: number; f: number; c: number }): ConstructorDay {
  return {
    day_index: 0,
    day_note: null,
    items: [
      {
        slot: "main1",
        recipe_id: "r1",
        recipe_name: "Курица с рисом",
        requires_cooking: true,
        prep_time_min: 20,
        steps: ["Обжарить", "Подать"],
        weighing_note: null,
        ingredients: [
          {
            product_id: "p1",
            product_name: "Курица",
            grams: "150",
            kcal: "165",
            protein_g: "31",
            fat_g: "3.6",
            carbs_g: "0",
            fiber_g: "0",
          },
        ],
        kcal: String(macros.k),
        protein_g: String(macros.p),
        fat_g: String(macros.f),
        carbs_g: String(macros.c),
        fiber_g: "0",
        is_valid: true,
      },
      {
        slot: "main2",
        recipe_id: "r2",
        recipe_name: "Индейка с овощами",
        requires_cooking: true,
        prep_time_min: 20,
        steps: ["Запечь", "Подать"],
        weighing_note: null,
        ingredients: [
          {
            product_id: "p2",
            product_name: "Индейка",
            grams: "150",
            kcal: "120",
            protein_g: "24",
            fat_g: "2",
            carbs_g: "0",
            fiber_g: "0",
          },
        ],
        kcal: "0",
        protein_g: "0",
        fat_g: "0",
        carbs_g: "0",
        fiber_g: "0",
        is_valid: true,
      },
      {
        slot: "main3",
        recipe_id: "r3",
        recipe_name: "Рыба с гречкой",
        requires_cooking: true,
        prep_time_min: 20,
        steps: ["Сварить", "Подать"],
        weighing_note: null,
        ingredients: [
          {
            product_id: "p3",
            product_name: "Рыба",
            grams: "150",
            kcal: "100",
            protein_g: "20",
            fat_g: "2",
            carbs_g: "0",
            fiber_g: "0",
          },
        ],
        kcal: "0",
        protein_g: "0",
        fat_g: "0",
        carbs_g: "0",
        fiber_g: "0",
        is_valid: true,
      },
    ],
    kcal: String(macros.k),
    protein_g: String(macros.p),
    fat_g: String(macros.f),
    carbs_g: String(macros.c),
    fiber_g: "0",
    is_valid: true,
  };
}

describe("checkNutritionDraft KBJU override", () => {
  it("blocks out-of-tolerance by default and allows with trainer override", () => {
    const products = new Map<string, FoodProduct>();
    const targets = { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 };
    const days = [day({ k: 900, p: 40, f: 20, c: 60 })];

    const blocked = checkNutritionDraft({
      days,
      targets,
      mode: "three_mains_only",
      products,
      expectedDays: 1,
    });
    expect(blocked.some((issue) => /КБЖУ/i.test(issue.message))).toBe(true);

    const allowed = checkNutritionDraft({
      days,
      targets,
      mode: "three_mains_only",
      products,
      expectedDays: 1,
      allowOutOfToleranceKbju: true,
    });
    expect(allowed.some((issue) => /КБЖУ/i.test(issue.message))).toBe(false);
  });
});
