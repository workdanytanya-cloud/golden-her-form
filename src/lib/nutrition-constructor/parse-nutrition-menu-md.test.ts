import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import {
  assertDaysWithinTargets,
  buildConstructorDaysFromParsedMenu,
  parseNutritionMenuMarkdown,
} from "@/lib/nutrition-constructor/parse-nutrition-menu-md";

describe("parseNutritionMenuMarkdown", () => {
  it("parses the final 7-day menu with prep plan and shopping list", () => {
    const markdown = fs.readFileSync(
      path.resolve("docs/maria-menu-final.md"),
      "utf8",
    );
    const parsed = parseNutritionMenuMarkdown(markdown);
    expect(parsed.days).toHaveLength(7);
    expect(parsed.days.every((day) => day.meals.length === 3)).toBe(true);
    expect(parsed.prepPlan.length).toBeGreaterThan(3);
    expect(parsed.storage.length).toBeGreaterThan(0);
    expect(parsed.shoppingList.length).toBeGreaterThan(10);
    expect(parsed.days[0]!.meals[0]!.name).toMatch(/овсяное суфле/i);

    const catalog = buildInMemoryCatalog();
    const bySlug = new Map([...catalog.products.values()].map((p) => [p.slug, p]));
    const days = buildConstructorDaysFromParsedMenu(parsed, bySlug);
    expect(days).toHaveLength(7);
    assertDaysWithinTargets(days, parsed.targets);
    expect(days[0]!.items[0]!.ingredients.some((ing) => Number(ing.grams) === 41.9)).toBe(true);
    expect(
      days.some((day) =>
        day.items.some((item) =>
          item.ingredients.some((ing) => ing.product_name.includes("пастеризованный")),
        ),
      ),
    ).toBe(true);
  });
});
