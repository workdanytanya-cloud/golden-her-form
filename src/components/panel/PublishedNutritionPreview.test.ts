import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublishedNutritionPreview } from "./PublishedNutritionPreview";
import type { NutritionSnapshot } from "@/lib/published-programs/types";

describe("PublishedNutritionPreview", () => {
  it("renders an existing immutable legacy nutrition snapshot", () => {
    const snapshot: NutritionSnapshot = {
      kind: "legacy",
      meal_schedule_mode: "three_meals",
      primary_meal_slot: "lunch",
      meals_per_day: 3,
      targets: { kcal: 1800, protein_g: 110, fat_g: 60, carbs_g: 205 },
      bmr: null,
      tdee: null,
      calorie_adjustment_pct: null,
      constructor_days: [],
      legacy_days: [
        {
          day_index: 1,
          day_note: null,
          meals: [
            {
              slot: "breakfast",
              portion_g: 250,
              note: null,
              dish: {
                id: "dish-1",
                slug: "published-breakfast",
                name: "Опубликованный завтрак",
                meal_type: "breakfast",
                calories_per_100g: 120,
                protein_per_100g: 8,
                fat_per_100g: 4,
                carbs_per_100g: 12,
                ingredients: [],
                steps: [],
                replacements: [],
                description: null,
              },
            },
          ],
        },
      ],
      notes: null,
      reason: null,
    };

    const before = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(createElement(PublishedNutritionPreview, { snapshot }));

    expect(html).toContain("Опубликованный завтрак");
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
