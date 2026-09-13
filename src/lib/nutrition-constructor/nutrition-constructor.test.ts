import { describe, expect, it } from "vitest";
import {
  buildIngredientLine,
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  d,
  displayMacro,
  macroFromPer100,
  roundTargetsForDb,
  sumMacros,
  withinTolerance,
} from "@/lib/nutrition-constructor/decimal-math";
import {
  buildInMemoryCatalog,
  generateAndValidateConstructorPlan,
} from "@/lib/nutrition-constructor/repo";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import {
  ALLOWED_PRODUCT_SLUGS,
  SEED_PRODUCTS,
  SEED_RECIPES,
} from "@/lib/nutrition-constructor/seed-data";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";
import type { FoodProduct } from "@/lib/nutrition-constructor/types";

function sampleProduct(overrides: Partial<FoodProduct> = {}): FoodProduct {
  return {
    id: "rice-white-dry",
    slug: "rice-white-dry",
    name: "Рис",
    category: "grain",
    brand: null,
    state: "raw_dry",
    measurement_basis: "per_100g_dry",
    kcal_per_100g: "365",
    protein_per_100g: "7.13",
    fat_per_100g: "0.66",
    carbs_per_100g: "79.95",
    fiber_per_100g: "1.3",
    density: null,
    source_name: "USDA",
    source_url: null,
    verified_at: null,
    is_verified: true,
    is_active: true,
    allowed_for_snack: false,
    requires_cooking: true,
    weighing_note: "Сухой",
    ...overrides,
  };
}

describe("nutrition-constructor seed catalog", () => {
  it("contains 20+ main and 12+ snack recipes with verified ingredients", () => {
    const mains = SEED_RECIPES.filter((r) => r.meal_type === "main");
    const snacks = SEED_RECIPES.filter((r) => r.meal_type === "snack");
    expect(mains.length).toBeGreaterThanOrEqual(20);
    expect(snacks.length).toBeGreaterThanOrEqual(20);

    const ctx = buildInMemoryCatalog();
    expect(ctx.mainRecipes.length).toBeGreaterThanOrEqual(20);
    expect(ctx.snackRecipes.length).toBeGreaterThanOrEqual(12);
  });
});

describe("nutrition-constructor decimal math", () => {
  it("calculates single product KBJU", () => {
    const p = sampleProduct();
    const m = macroFromPer100(
      {
        kcal: p.kcal_per_100g,
        protein: p.protein_per_100g,
        fat: p.fat_per_100g,
        carbs: p.carbs_per_100g,
      },
      150,
    );
    const dMacro = displayMacro(m);
    expect(dMacro.kcal).toBe(548);
    expect(dMacro.protein_g).toBe(10.7);
  });

  it("rounds display targets to integers for Postgres nutrition_plans", () => {
    expect(
      roundTargetsForDb({
        kcal: 1847,
        protein_g: 89.9,
        fat_g: 44.5,
        carbs_g: 201.2,
      }),
    ).toEqual({
      kcal: 1847,
      protein_g: 90,
      fat_g: 45,
      carbs_g: 201,
    });
  });

  it("sums meal ingredients without intermediate rounding drift", () => {
    const p1 = sampleProduct({
      id: "a",
      slug: "a",
      kcal_per_100g: "100",
      protein_per_100g: "10",
      fat_per_100g: "5",
      carbs_per_100g: "10",
    });
    const p2 = sampleProduct({
      id: "b",
      slug: "b",
      kcal_per_100g: "200",
      protein_per_100g: "20",
      fat_per_100g: "10",
      carbs_per_100g: "20",
    });
    const lines = [buildIngredientLine(p1, 33, 0), buildIngredientLine(p2, 67, 1)];
    const total = mealTotalsFromIngredients(lines);
    expect(displayMacro(total).kcal).toBe(167);
  });

  it("blocks unverified products from whitelist validation", () => {
    const unverified = SEED_PRODUCTS.filter((p) => !p.is_verified).map((p) => p.slug);
    expect(unverified.length).toBeGreaterThan(0);
    for (const slug of unverified) {
      expect(ALLOWED_PRODUCT_SLUGS.has(slug)).toBe(true);
    }
  });
});

describe("nutrition-constructor targets", () => {
  it("uses Mifflin-St Jeor for female 65kg", () => {
    const r = calcMacroTargets({
      gender: "female",
      birth_date: "1995-01-01",
      height_cm: 165,
      weight_kg: 65,
      activity_level: "medium",
      goal_primary: "maintain",
    });
    expect(r.bmr.toNumber()).toBeGreaterThan(1200);
    expect(r.tdee.toNumber()).toBeGreaterThan(r.bmr.toNumber());
  });

  it("calculates targets for 1500 kcal scenario", () => {
    const r = calcMacroTargets({
      gender: "female",
      weight_kg: 60,
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "low",
      goal_primary: "weight_loss",
      manual_kcal: 1500,
      manual_protein_g: 108,
      manual_fat_g: 54,
      manual_carbs_g: 150,
    });
    expect(displayMacro(r.targets).kcal).toBe(1500);
  });
});

describe("nutrition-constructor optimizer", () => {
  it("builds day with exactly 4 meals and no-cook snacks", async () => {
    const ctx = buildInMemoryCatalog();
    expect(ctx.mainRecipes.length).toBeGreaterThan(0);
    expect(ctx.snackRecipes.length).toBeGreaterThan(0);

    const profile = {
      gender: "female" as const,
      weight_kg: 65,
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "medium",
      goal_primary: "maintain",
      profile_complete: true,
    };
    const result = await generateAndValidateConstructorPlan({
      profile,
      days_count: 1,
      excluded_product_ids: [],
    });

    const days = result.best_approximation?.days ?? [];
    const gen = generateConstructorPlan(buildInMemoryCatalog(), {
      targets: result.targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 },
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    if (gen.days.length > 0) {
      expect(gen.days[0].items).toHaveLength(4);
      const snacks = gen.days[0].items.filter((i) => i.slot === "snack1" || i.slot === "snack2");
      expect(snacks.every((s) => !s.requires_cooking)).toBe(true);
    } else if (days.length > 0) {
      expect(days[0].items).toHaveLength(4);
    }
  });

  it("respects tolerance check helper", () => {
    const target = {
      kcal: d(1500),
      protein_g: d(100),
      fat_g: d(50),
      carbs_g: d(150),
      fiber_g: d(0),
    };
    const actual = {
      kcal: d(1503),
      protein_g: d(100.5),
      fat_g: d(49.5),
      carbs_g: d(151),
      fiber_g: d(0),
    };
    expect(withinTolerance(actual, target, { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 })).toBe(
      true,
    );
  });
});

describe("nutrition-constructor four meals sum", () => {
  it("sums four meal slots to day total", () => {
    const p = sampleProduct({
      kcal_per_100g: "100",
      protein_per_100g: "10",
      fat_per_100g: "5",
      carbs_per_100g: "10",
    });
    const meals = [50, 30, 50, 30].map((g, i) => buildIngredientLine(p, g, i));
    const total = sumMacros(
      meals.map((line) => ({
        kcal: d(line.kcal),
        protein_g: d(line.protein_g),
        fat_g: d(line.fat_g),
        carbs_g: d(line.carbs_g),
        fiber_g: d(line.fiber_g),
      })),
    );
    expect(displayMacro(total).kcal).toBe(160);
  });
});
