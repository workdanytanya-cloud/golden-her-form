import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { fingerprintExactDay } from "@/lib/nutrition-constructor/week-cycle";

const forbidden = new Set([
  "tomato",
  "lemon",
  "hard-cheese",
  "butter",
  "canned-tuna",
  "canned-corn",
  "stevia-candy",
  "marshmallow",
  "dried-mango",
  "avocado",
]);

function catalog() {
  const base = buildInMemoryCatalog();
  const allowed = (recipe: (typeof base.mainRecipes)[number]) =>
    (base.recipeIngredients.get(recipe.id) ?? []).every((ingredient) => {
      const product = base.products.get(ingredient.product_id);
      return product && !forbidden.has(product.slug);
    });
  const ctx = {
    ...base,
    recipes: base.recipes.filter(allowed),
    mainRecipes: base.mainRecipes.filter(allowed),
    snackRecipes: base.snackRecipes.filter(allowed),
  };
  const excluded = [...ctx.products.values()]
    .filter((product) => forbidden.has(product.slug))
    .map((product) => product.id);
  return { ctx, excluded };
}

function generate(seed = 371396, recipeSlugs?: string[]) {
  const { ctx: fullCtx, excluded } = catalog();
  const selected = recipeSlugs
    ? fullCtx.mainRecipes.filter((recipe) => recipeSlugs.includes(recipe.slug))
    : fullCtx.mainRecipes;
  const ctx = recipeSlugs
    ? { ...fullCtx, recipes: selected, mainRecipes: selected, snackRecipes: [] }
    : fullCtx;
  return generateConstructorPlan(ctx, {
    targets: {
      kcal: d(1396),
      protein_g: d(116.6),
      fat_g: d(58.3),
      carbs_g: d(101.2),
      fiber_g: d(0),
    },
    days_count: recipeSlugs ? 1 : 7,
    excluded_product_ids: excluded,
    tolerance: DEFAULT_TOLERANCE,
    meal_schedule_mode: "three_mains_only",
    primary_meal_slot: "lunch",
    seed,
    search_timeout_ms: 55_000,
  });
}

function composeWeek() {
  const base = generate();
  const fish = generate(371396, [
    "gentle-cod-potato-zucchini",
    "gentle-flex-buckwheat-beef-zucchini-oil",
    "gentle-flex-omelette-pumpkin-potato-oil",
  ]).days[0]!;
  const turkey = generate(371396, [
    "gentle-potato-turkey-zucchini",
    "gentle-flex-buckwheat-beef-zucchini-oil",
    "gentle-flex-omelette-pumpkin-potato-oil",
  ]).days[0]!;
  const selected = [fish, base.days[5]!, base.days[0]!, base.days[5]!, turkey, base.days[5]!, base.days[1]!];
  return {
    base,
    days: selected.map((day, day_index) => ({ ...structuredClone(day), day_index })),
  };
}

describe("Maria exact diverse week", () => {
  it("builds a deterministic 7-day PASS without forbidden or repeated dishes", () => {
    const first = composeWeek();
    expect(first.base.is_valid).toBe(true);
    expect(first.base.reason_code).toBe("PASS");
    expect(first.days).toHaveLength(7);
    expect(new Set(first.days.map(fingerprintExactDay)).size).toBeGreaterThanOrEqual(4);

    const recipeUses = new Map<string, number>();
    const productSlugs = new Set<string>();
    for (let index = 0; index < first.days.length; index++) {
      const day = first.days[index]!;
      if (index > 0) {
        expect(fingerprintExactDay(day)).not.toBe(fingerprintExactDay(first.days[index - 1]!));
      }
      const lunch = day.items.find((item) => item.slot === "main2")!;
      const dinner = day.items.find((item) => item.slot === "main3")!;
      expect(Number(dinner.fat_g)).toBeLessThan(Number(lunch.fat_g));
      for (const item of day.items) {
        recipeUses.set(item.recipe_id, (recipeUses.get(item.recipe_id) ?? 0) + 1);
        for (const ingredient of item.ingredients) {
          expect(Number(ingredient.grams)).toBeGreaterThan(0);
          expect(forbidden.has(ingredient.product_id)).toBe(false);
          productSlugs.add(ingredient.product_id);
        }
      }
    }
    expect(Math.max(...recipeUses.values())).toBeLessThanOrEqual(3);
    expect(productSlugs.has("cod-raw")).toBe(true);
    expect(productSlugs.has("turkey-breast-raw")).toBe(true);
    expect(first.base.diagnostics?.elapsed_ms).toBeLessThan(60_000);

    const second = composeWeek();
    expect(second.days).toEqual(first.days);
  }, 60_000);
});
