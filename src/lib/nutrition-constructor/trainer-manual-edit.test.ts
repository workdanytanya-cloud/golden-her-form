import { describe, expect, it } from "vitest";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import {
  comparisonRows,
  formatUsedTargetsLine,
} from "@/lib/nutrition-constructor/calculator";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { analyzeCatalogForGeneration } from "@/lib/nutrition-constructor/catalog-diagnostics";
import { d, displayMacro } from "@/lib/nutrition-constructor/decimal-math";
import { proposeDayCorrections } from "@/lib/nutrition-constructor/deviation-suggestions";
import { shoppingListFromDays } from "@/lib/nutrition-constructor/ingredient-normalize";
import {
  ALLERGEN_BLOCKED_MESSAGE,
  addMealToDay,
  mealItemFromProducts,
  replaceDaysDay,
  setIngredientGrams,
  ZERO_GRAMS_FORBIDDEN_MESSAGE,
} from "@/lib/nutrition-constructor/manual-meals";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { kbjuStatusLabel, planStructureValid } from "@/lib/nutrition-constructor/plan-kbju-status";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";
import { checkDayStructure, type ConstructorDay } from "@/lib/nutrition-constructor/types";
import { assertUnchangedHash } from "@/lib/published-programs/hash";
import { buildConstructorNutritionSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import {
  clientVisibleNutrition,
  createEmptyStore,
  publishNutritionVersion,
  saveNutritionDraft,
  startNutritionRevisionFromPublished,
} from "@/lib/published-programs/store";

const MANUAL_1313 = {
  kcal: 1313,
  protein_g: 112,
  fat_g: 56,
  carbs_g: 90,
};

const TARGETS_1313 = {
  kcal: d(1313),
  protein_g: d(112),
  fat_g: d(56),
  carbs_g: d(90),
  fiber_g: d(0),
};

function autoProfile() {
  return {
    gender: "female" as const,
    weight_kg: 58,
    height_cm: 162,
    birth_date: "1993-01-01",
    activity_level: "medium",
    goal_primary: "weight_loss",
  };
}

function sampleDay(items: ConstructorDay["items"]): ConstructorDay {
  return {
    day_index: 0,
    day_note: null,
    items,
    kcal: "0",
    protein_g: "0",
    fat_g: "0",
    carbs_g: "0",
    fiber_g: "0",
    is_valid: false,
  };
}

describe("manual 1313 vs auto-calc", () => {
  it("uses trainer fields 1313, not questionnaire auto-calc", () => {
    const auto = displayMacro(calcMacroTargets(autoProfile()).targets);
    const manual = displayMacro(
      calcMacroTargets({
        ...autoProfile(),
        manual_kcal: MANUAL_1313.kcal,
        manual_protein_g: MANUAL_1313.protein_g,
        manual_fat_g: MANUAL_1313.fat_g,
        manual_carbs_g: MANUAL_1313.carbs_g,
      }).targets,
    );
    expect(manual.kcal).toBe(1313);
    expect(manual.protein_g).toBe(112);
    expect(manual.fat_g).toBe(56);
    expect(manual.carbs_g).toBe(90);
    expect(auto.kcal).not.toBe(1313);
    expect(formatUsedTargetsLine(manual)).toBe("Расчёт выполнен для: 1313 ккал · Б112 · Ж56 · У90");
    expect(formatUsedTargetsLine(auto)).not.toContain("1313 ккал · Б112");
  });

  it("generator comparison target is 1313 when given manual macros", () => {
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
    const gen = generateConstructorPlan(ctx, {
      targets: TARGETS_1313,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const kcalRow = gen.comparison.find((row) => row.label === "Калории");
    expect(kcalRow?.target).toBe(1313);
    if (gen.days[0]) {
      const rows = comparisonRows(TARGETS_1313, {
        kcal: d(gen.days[0].kcal),
        protein_g: d(gen.days[0].protein_g),
        fat_g: d(gen.days[0].fat_g),
        carbs_g: d(gen.days[0].carbs_g),
        fiber_g: d(0),
      });
      expect(rows[0]!.target).toBe(1313);
    }
  });
});

describe("mode switch 2+2 → 1+3", () => {
  it("does not treat a 2+2 day as a valid 1+3 result", () => {
    const twoPlusTwo: ConstructorDay = {
      day_index: 0,
      day_note: null,
      items: [
        { slot: "main1" } as ConstructorDay["items"][number],
        { slot: "snack1" } as ConstructorDay["items"][number],
        { slot: "main2" } as ConstructorDay["items"][number],
        { slot: "snack2" } as ConstructorDay["items"][number],
      ],
      kcal: "1313",
      protein_g: "112",
      fat_g: "56",
      carbs_g: "90",
      fiber_g: "0",
      is_valid: true,
    };
    expect(planStructureValid([twoPlusTwo], "two_main_two_snacks")).toBe(true);
    expect(planStructureValid([twoPlusTwo], "one_main_three_snacks")).toBe(false);
    const check = checkDayStructure(twoPlusTwo, "one_main_three_snacks");
    expect(check.mains.actual).toBe(2);
    expect(check.mains.expected).toBe(1);
    expect(check.snacks.actual).toBe(2);
    expect(check.snacks.expected).toBe(3);
  });

  it("1+3 creates one main, three no-cook snacks and snack3", { timeout: 45_000 }, () => {
    const one = generateConstructorPlan(buildInMemoryCatalog({ includeTestPackaging: true }), {
      targets: TARGETS_1313,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(one.days.length).toBe(1);
    const day = one.days[0]!;
    expect(day.items.filter((i) => i.slot.startsWith("main"))).toHaveLength(1);
    expect(day.items.filter((i) => i.slot.startsWith("snack"))).toHaveLength(3);
    expect(day.items.some((i) => i.slot === "main2")).toBe(false);
    expect(day.items.some((i) => i.slot === "snack3")).toBe(true);
    expect(day.items.filter((i) => i.slot.startsWith("snack")).every((i) => !i.requires_cooking)).toBe(
      true,
    );
    const frozen = buildConstructorNutritionSnapshot({
      days: [day],
      targets: MANUAL_1313,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    expect(frozen.constructor_days[0]!.items.some((item) => item.slot === "snack3")).toBe(true);
  });
});

describe("manual meal editing", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
  const chicken = ctx.products.get("chicken-breast-raw")!;
  const cucumber = ctx.products.get("cucumber")!;
  const oil = ctx.products.get("olive-oil")!;

  it("adds a meal into day KBJU totals", () => {
    const empty = sampleDay([]);
    const item = mealItemFromProducts({
      slot: "snack3",
      name: "Огурец",
      mealKind: "snack",
      lines: [{ product: cucumber, grams: 120 }],
      forbiddenIds: new Set(),
    });
    const next = addMealToDay({ day: empty, item, products: ctx.products });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.slot).toBe("snack3");
    expect(Number(next.kcal)).toBeGreaterThan(0);
    expect(Number(next.kcal)).toBe(Number(item.kcal));
  });

  it("recalculates the day immediately after gram change", () => {
    const item = mealItemFromProducts({
      slot: "main1",
      name: "Курица",
      mealKind: "main",
      lines: [{ product: chicken, grams: 100 }],
      forbiddenIds: new Set(),
    });
    const day = addMealToDay({ day: sampleDay([]), item, products: ctx.products });
    const before = Number(day.protein_g);
    const next = setIngredientGrams({
      day,
      slot: "main1",
      productId: chicken.id,
      grams: 200,
      products: ctx.products,
    });
    expect(Number(next.protein_g)).toBeGreaterThan(before);
    expect(Number(next.items[0]!.ingredients[0]!.grams)).toBe(200);
  });

  it("proposal shows result before apply and does not mutate until chosen", () => {
    const item = mealItemFromProducts({
      slot: "main1",
      name: "Курица с маслом",
      mealKind: "main",
      lines: [
        { product: chicken, grams: 80 },
        { product: oil, grams: 8 },
        { product: ctx.products.get("rice-white-dry")!, grams: 80 },
      ],
      forbiddenIds: new Set(),
    });
    const day = addMealToDay({ day: sampleDay([]), item, products: ctx.products });
    const originalKcal = day.kcal;
    const proposals = proposeDayCorrections({
      day,
      targets: TARGETS_1313,
      products: ctx.products,
    });
    expect(proposals.length).toBeGreaterThan(0);
    const first = proposals[0]!;
    expect(first.whatChanges.length).toBeGreaterThan(0);
    expect(first.newGrams.length).toBeGreaterThan(0);
    expect(first.dayTotals.kcal).toBeGreaterThan(0);
    expect(first.deviation.length).toBe(4);
    expect(day.kcal).toBe(originalKcal);
    const applied = replaceDaysDay([day], first.nextDay, ctx.products)[0]!;
    expect(applied.kcal).not.toBe(originalKcal);
  });

  it("excludes allergen products from manual add", () => {
    const tuna = ctx.products.get("canned-tuna")!;
    const { forbiddenIds } = buildForbiddenProductIds([...ctx.products.values()], {
      allergies: "рыба",
    });
    expect(() =>
      mealItemFromProducts({
        slot: "snack1",
        name: "Тунец",
        mealKind: "snack",
        lines: [{ product: tuna, grams: 80 }],
        forbiddenIds,
      }),
    ).toThrow(ALLERGEN_BLOCKED_MESSAGE);
  });

  it("forbids zero grams", () => {
    expect(() =>
      mealItemFromProducts({
        slot: "main1",
        name: "Курица",
        mealKind: "main",
        lines: [{ product: chicken, grams: 0 }],
        forbiddenIds: new Set(),
      }),
    ).toThrow(ZERO_GRAMS_FORBIDDEN_MESSAGE);
  });

  it("does not persist zero oil and keeps positive oil", () => {
    const withOil = mealItemFromProducts({
      slot: "main1",
      name: "Курица с маслом",
      mealKind: "main",
      lines: [
        { product: chicken, grams: 150 },
        { product: oil, grams: 5 },
      ],
      forbiddenIds: new Set(),
    });
    expect(withOil.ingredients.some((ing) => ing.product_id === oil.id)).toBe(true);
    const list = shoppingListFromDays([
      addMealToDay({ day: sampleDay([]), item: withOil, products: ctx.products }),
    ]);
    expect(list.some((entry) => entry.product_id === oil.id && entry.grams > 0)).toBe(true);
  });
});

describe("published snapshot immutability", () => {
  it("clone-on-write draft edits do not mutate the assigned snapshot", () => {
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
    const cucumber = ctx.products.get("cucumber")!;
    const item = mealItemFromProducts({
      slot: "main1",
      name: "Оригинал",
      mealKind: "main",
      lines: [{ product: cucumber, grams: 100 }],
      forbiddenIds: new Set(),
    });
    const day = addMealToDay({ day: sampleDay([]), item, products: ctx.products });
    const snapshot = buildConstructorNutritionSnapshot({
      days: [day],
      targets: MANUAL_1313,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot,
    });
    const publishedHash = store.nutritionVersions[0]!.content_hash;
    const visibleBefore = clientVisibleNutrition(store, "c1")!;

    store = startNutritionRevisionFromPublished(store, "c1");
    const draft = store.nutritionDrafts[0]!;
    draft.snapshot.constructor_days[0]!.items[0]!.recipe_name = "Черновик изменён";
    store = saveNutritionDraft(store, "c1", draft.snapshot, draft.parent_version_id);

    expect(clientVisibleNutrition(store, "c1")).toEqual(visibleBefore);
    expect(assertUnchangedHash(store.nutritionVersions[0]!.snapshot, publishedHash)).toBe(true);
    expect(store.nutritionVersions[0]!.snapshot.constructor_days[0]!.items[0]!.recipe_name).toBe(
      "Оригинал",
    );
  });
});

describe("production catalog diagnosis without personal data", () => {
  it("records production vs fixture eligibility for 1313 2+2 and 1+3", { timeout: 60_000 }, () => {
    const production = buildInMemoryCatalog();
    const fixture = buildInMemoryCatalog({ includeTestPackaging: true });
    const fixtureSlugs = [...fixture.products.values()].map((p) => p.slug);

    const prodTwo = analyzeCatalogForGeneration({
      ctx: production,
      mode: "two_main_two_snacks",
      catalogKind: "production_seed",
      fixtureProductSlugs: fixtureSlugs,
    });
    const prodOne = analyzeCatalogForGeneration({
      ctx: production,
      mode: "one_main_three_snacks",
      catalogKind: "production_seed",
      fixtureProductSlugs: fixtureSlugs,
    });
    const fixtureOne = analyzeCatalogForGeneration({
      ctx: fixture,
      mode: "one_main_three_snacks",
      catalogKind: "fixture_test_packaging",
      fixtureProductSlugs: fixtureSlugs,
    });

    expect(prodTwo.productCount).toBeGreaterThan(0);
    expect(prodTwo.recipeCount).toBeGreaterThan(0);
    expect(prodTwo.oil.find((o) => o.slug === "olive-oil")?.available).toBe(true);
    expect(prodTwo.oil.find((o) => o.slug === "butter")?.autogen).toBe(false);
    expect(prodTwo.matchesFixtureAcceptanceCatalog).toBe(false);
    expect(prodOne.eligibleSnacks).toBeGreaterThanOrEqual(3);
    expect(fixtureOne.eligibleSnacks).toBeGreaterThanOrEqual(prodOne.eligibleSnacks);

    const oneMain = generateConstructorPlan(production, {
      targets: TARGETS_1313,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
    });
    if (oneMain.days[0]) {
      expect(oneMain.days[0].items.filter((i) => i.slot.startsWith("main"))).toHaveLength(1);
      expect(oneMain.days[0].items.filter((i) => i.slot.startsWith("snack"))).toHaveLength(3);
      expect(oneMain.days[0].items.some((i) => i.slot === "snack3")).toBe(true);
    } else {
      expect(oneMain.message).toBeTruthy();
      expect(prodOne.excludedRecipes.length).toBeGreaterThan(0);
    }

    expect(kbjuStatusLabel({ acceptable: true } as never)).toContain("строгом допуске");
    expect(kbjuStatusLabel({ acceptable: false } as never)).toMatch(/подтверждением тренера/i);
  });
});
