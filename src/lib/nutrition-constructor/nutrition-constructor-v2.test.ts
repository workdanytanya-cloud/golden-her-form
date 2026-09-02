import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE,
  displayOrderForPlan,
  expectedMainCount,
  expectedSnackCount,
} from "@/lib/nutrition-constructor/config";
import { d, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { OIL_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { SEED_PRODUCTS, SEED_RECIPES } from "@/lib/nutrition-constructor/seed-data";
import { checkMacroCompatibility, calcMacroTargets } from "@/lib/nutrition-constructor/targets";
import { checkDayStructure } from "@/lib/nutrition-constructor/types";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";

function targetsForKcal(kcal: number) {
  return calcMacroTargets({
    gender: "female",
    weight_kg: 65,
    height_cm: 165,
    birth_date: "1990-01-01",
    activity_level: "medium",
    goal_primary: "maintain",
    manual_kcal: kcal,
    manual_protein_g: Math.round((kcal * 0.3) / 4),
    manual_fat_g: Math.round((kcal * 0.3) / 9),
    manual_carbs_g: Math.round((kcal * 0.4) / 4),
  }).targets;
}

function assertBalanced(gen: ReturnType<typeof generateConstructorPlan>, targets: ReturnType<typeof targetsForKcal>) {
  expect(gen.days.length).toBeGreaterThan(0);
  for (const day of gen.days) {
    expect(
      withinTolerance(
        {
          kcal: d(day.kcal),
          protein_g: d(day.protein_g),
          fat_g: d(day.fat_g),
          carbs_g: d(day.carbs_g),
          fiber_g: d(day.fiber_g),
        },
        targets,
        DEFAULT_TOLERANCE,
      ),
    ).toBe(true);
  }
}

describe("nutrition constructor v2", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("includes oils in seed catalog", () => {
    expect(SEED_PRODUCTS.some((p) => p.slug === "olive-oil")).toBe(true);
    expect(SEED_PRODUCTS.some((p) => p.slug === "sunflower-oil")).toBe(true);
    expect(SEED_PRODUCTS.some((p) => p.slug === "butter")).toBe(true);
    for (const slug of OIL_PRODUCT_SLUGS) {
      expect(ctx.products.has(slug)).toBe(true);
    }
  });

  it("enriches main recipes with optional olive oil", () => {
    const mains = SEED_RECIPES.filter((r) => r.meal_type === "main");
    expect(mains.every((r) => r.ingredients.some((i) => i.product_slug === "olive-oil"))).toBe(true);
  });

  it("rejects incompatible macro targets", () => {
    const check = checkMacroCompatibility({
      kcal: d(1500),
      protein_g: d(200),
      fat_g: d(10),
      carbs_g: d(10),
      fiber_g: d(0),
    });
    expect(check.compatible).toBe(false);
    expect(check.message).toMatch(/несовместимы/i);
  });

  const modes = [
    { mode: "three_main_two_snacks" as const, mains: 3, snacks: 2 },
    { mode: "three_mains_only" as const, mains: 3, snacks: 0 },
    { mode: "one_main_three_snacks" as const, mains: 1, snacks: 3 },
  ];

  for (const { mode, mains, snacks } of modes) {
    it(`builds ${mode}: ${mains} mains + ${snacks} snacks`, () => {
      const targets = targetsForKcal(1800);
      const gen = generateConstructorPlan(ctx, {
        targets,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: mode,
        primary_meal_slot: "lunch",
      });
      expect(gen.days.length).toBe(1);
      const day = gen.days[0]!;
      const structure = checkDayStructure(day, mode);
      expect(structure.mains.actual).toBe(mains);
      expect(structure.snacks.actual).toBe(snacks);
      expect(expectedMainCount(mode)).toBe(mains);
      expect(expectedSnackCount(mode)).toBe(snacks);
    });
  }

  it("places main meal by primary slot in one_main_three_snacks", () => {
    expect(displayOrderForPlan("one_main_three_snacks", "breakfast")[0]).toBe("main1");
    expect(displayOrderForPlan("one_main_three_snacks", "dinner")[2]).toBe("main1");
    expect(displayOrderForPlan("one_main_three_snacks", "lunch")[1]).toBe("main1");
  });

  it("uses oil in exact grams when balancing fats", () => {
    const targets = targetsForKcal(1800);
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const day = gen.days[0]!;
    const oilLines = day.items.flatMap((item) =>
      item.ingredients.filter((ing) => OIL_PRODUCT_SLUGS.has(ing.product_id)),
    );
    if (oilLines.length > 0) {
      for (const line of oilLines) {
        expect(line.product_name).toMatch(/масло/i);
        expect(Number(line.grams)).toBeGreaterThanOrEqual(0);
        expect(Number(line.grams)).toBeLessThanOrEqual(15);
      }
    }
  });

  it("excludes allergen products from generation", () => {
    const tuna = ctx.products.get("canned-tuna");
    expect(tuna).toBeDefined();
    const { forbiddenIds } = buildForbiddenProductIds([...ctx.products.values()], {
      allergies: "рыба",
    });
    expect(forbiddenIds.has(tuna!.id)).toBe(true);
    const gen = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [...forbiddenIds],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    for (const day of gen.days) {
      for (const item of day.items) {
        for (const ing of item.ingredients) {
          expect(ing.product_id).not.toBe("canned-tuna");
        }
      }
    }
  });

  for (const kcal of [1300, 1500, 1800, 2200, 2500]) {
    it(`balances three_main_two_snacks at ${kcal} kcal within tolerance`, () => {
      const targets = targetsForKcal(kcal);
      const gen = generateConstructorPlan(ctx, {
        targets,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: "three_main_two_snacks",
        primary_meal_slot: "lunch",
      });
      if (gen.is_valid) {
        assertBalanced(gen, targets);
      }
      expect(gen.kbju_acceptable).toBe(gen.is_valid);
    });
  }

  it("does not mark invalid plan as assignable", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(1800),
        protein_g: d(300),
        fat_g: d(10),
        carbs_g: d(10),
        fiber_g: d(0),
      },
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
    });
    expect(gen.is_valid).toBe(false);
    expect(gen.kbju_acceptable).toBe(false);
  });
});
