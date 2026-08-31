import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE,
  displayOrderForPlan,
  ONE_MAIN_UNACHIEVABLE_MESSAGE,
} from "@/lib/nutrition-constructor/config";
import { displayMacro } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { SEED_PRODUCTS, SEED_RECIPES } from "@/lib/nutrition-constructor/seed-data";
import { TREAT_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";

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

describe("meal schedule client labels", () => {
  it("brands one_main_three_snacks as На бегу with clear description", async () => {
    const {
      MEAL_SCHEDULE_CLIENT_LABELS,
      MEAL_SCHEDULE_DESCRIPTIONS,
      MEAL_SCHEDULE_TAGLINES,
      mealScheduleClientLabel,
      mealScheduleDescription,
    } = await import("@/lib/nutrition-constructor/config");

    expect(MEAL_SCHEDULE_CLIENT_LABELS.one_main_three_snacks).toBe("На бегу");
    expect(mealScheduleClientLabel("one_main_three_snacks")).toBe("На бегу");
    expect(MEAL_SCHEDULE_TAGLINES.one_main_three_snacks).toMatch(/без готовки/i);
    expect(MEAL_SCHEDULE_DESCRIPTIONS.one_main_three_snacks).toMatch(/полноценн/i);
    expect(MEAL_SCHEDULE_DESCRIPTIONS.one_main_three_snacks).toMatch(/перекус/i);
    expect(mealScheduleDescription("one_main_three_snacks")).toBe(
      MEAL_SCHEDULE_DESCRIPTIONS.one_main_three_snacks,
    );
    expect(ONE_MAIN_UNACHIEVABLE_MESSAGE).toMatch(/На бегу/);
  });
});

describe("seed catalog counts", () => {
  it("has 32 products, 22+ mains and 20+ snacks", () => {
    expect(SEED_PRODUCTS.length).toBe(32);
    const mains = SEED_RECIPES.filter((r) => r.meal_type === "main");
    const snacks = SEED_RECIPES.filter((r) => r.meal_type === "snack");
    expect(mains.length).toBeGreaterThanOrEqual(22);
    expect(snacks.length).toBeGreaterThanOrEqual(20);
  });

  it("marks unverified packaging products correctly", () => {
    const unverified = SEED_PRODUCTS.filter((p) => !p.is_verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const p of unverified) {
      expect(p.kcal).toBe(0);
    }
  });
});

describe("two_main_two_snacks mode", () => {
  const ctx = buildInMemoryCatalog();

  it("builds 4 meals with 2 mains and 2 no-cook snacks", () => {
    const targets = targetsForKcal(1800);
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.days.length).toBe(1);
    const day = gen.days[0]!;
    expect(day.items).toHaveLength(4);
    const mains = day.items.filter((i) => i.slot.startsWith("main"));
    const snacks = day.items.filter((i) => i.slot.startsWith("snack"));
    expect(mains).toHaveLength(2);
    expect(snacks).toHaveLength(2);
    expect(snacks.every((s) => !s.requires_cooking)).toBe(true);
  });

  it("generates plans for 1500/1800/2200 kcal", () => {
    for (const kcal of [1500, 1800, 2200]) {
      const targets = targetsForKcal(kcal);
      const gen = generateConstructorPlan(ctx, {
        targets,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: "two_main_two_snacks",
        primary_meal_slot: "lunch",
      });
      expect(gen.days.length).toBe(1);
      expect(gen.days[0]!.items).toHaveLength(4);
      expect(gen.comparison.length).toBe(4);
    }
  });

  it("returns comparison rows for 1800 kcal", () => {
    const targets = targetsForKcal(1800);
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.comparison.every((r) => Number.isFinite(r.target))).toBe(true);
    if (!gen.is_valid) {
      expect(gen.message).toBeTruthy();
    }
  });
});

describe("one_main_three_snacks mode", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("contains exactly 1 main and 3 snacks", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.days.length).toBe(1);
    const day = gen.days[0]!;
    expect(day.items.filter((i) => i.slot.startsWith("main"))).toHaveLength(1);
    expect(day.items.filter((i) => i.slot.startsWith("snack"))).toHaveLength(3);
  });

  it("uses only no-cook nutrient-dense snacks without treats", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "breakfast",
    });
    const day = gen.days[0]!;
    const snacks = day.items.filter((i) => i.slot.startsWith("snack"));
    expect(snacks.every((s) => !s.requires_cooking)).toBe(true);
    const recipeIds = new Set(snacks.map((s) => s.recipe_id));
    expect(recipeIds.size).toBe(3);

    for (const snack of snacks) {
      const recipe = ctx.recipes.find((r) => r.id === snack.recipe_id);
      expect(recipe?.is_treat).toBe(false);
      expect(recipe?.is_nutrient_dense).toBe(true);
      for (const ing of snack.ingredients) {
        const product = ctx.products.get(ing.product_id);
        expect(product && TREAT_PRODUCT_SLUGS.has(product.slug)).toBe(false);
      }
    }
  });

  it("includes protein and fruit/vegetable snacks", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "dinner",
    });
    const snacks = gen.days[0]!.items.filter((i) => i.slot.startsWith("snack"));
    const recipes = snacks.map((s) => ctx.recipes.find((r) => r.id === s.recipe_id)!);
    expect(recipes.some((r) => r.contains_protein_source)).toBe(true);
    expect(recipes.some((r) => r.contains_fruit_or_vegetable)).toBe(true);
  });

  it("orders meals by primary slot", () => {
    const breakfast = displayOrderForPlan("one_main_three_snacks", "breakfast");
    expect(breakfast[0]).toBe("main1");
    const dinner = displayOrderForPlan("one_main_three_snacks", "dinner");
    expect(dinner[2]).toBe("main1");
  });

  it("builds draft without packaging products (fruit/nut snacks)", () => {
    const bare = buildInMemoryCatalog();
    const gen = generateConstructorPlan(bare, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.days.length).toBe(1);
    expect(gen.days[0]!.items).toHaveLength(4);
    if (!gen.is_valid) {
      expect(gen.message).toContain("KBJU");
    }
  });

  it("generates plans for 1500/1800/2200 kcal with test packaging", () => {
    for (const kcal of [1500, 1800, 2200]) {
      const targets = targetsForKcal(kcal);
      const gen = generateConstructorPlan(ctx, {
        targets,
        days_count: 1,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: "one_main_three_snacks",
        primary_meal_slot: "lunch",
      });
      expect(gen.days.length).toBe(1);
      expect(gen.days[0]!.items).toHaveLength(4);
    }
  });

  it("returns comparison rows for 1800 kcal in 1+3 mode", () => {
    const targets = targetsForKcal(1800);
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.comparison.length).toBe(4);
    if (!gen.is_valid) {
      expect(gen.message).toBeTruthy();
    }
  });
});

describe("mode switching", () => {
  it("clears old structure when regenerating another mode", () => {
    const ctx = buildInMemoryCatalog();
    const twoMain = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(twoMain.days[0]!.items.some((i) => i.slot === "main2")).toBe(true);

    const oneMain = generateConstructorPlan(buildInMemoryCatalog({ includeTestPackaging: true }), {
      targets: targetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(oneMain.days[0]!.items.some((i) => i.slot === "main2")).toBe(false);
    expect(oneMain.days[0]!.items.some((i) => i.slot === "snack3")).toBe(true);
  });
});

describe("macro display smoke", () => {
  it("shows target vs actual comparison rows", () => {
    const ctx = buildInMemoryCatalog();
    const gen = generateConstructorPlan(ctx, {
      targets: targetsForKcal(1500),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.comparison.length).toBe(4);
    expect(gen.days[0]?.items.length).toBe(4);
    expect(displayMacro(targetsForKcal(1500)).kcal).toBe(1500);
  });
});
