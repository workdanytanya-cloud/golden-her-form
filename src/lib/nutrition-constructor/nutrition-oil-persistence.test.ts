import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import {
  AUTOGEN_OIL_PRODUCT_SLUGS,
  OIL_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";
import type { ConstructorDay, IngredientLine, MealPlanItem } from "@/lib/nutrition-constructor/types";
import {
  buildConstructorNutritionSnapshot,
  constructorDaysFromSnapshot,
} from "@/lib/published-programs/nutrition-snapshot";
import {
  clientVisibleNutrition,
  createEmptyStore,
  publishNutritionVersion,
  reseedCatalog,
  saveNutritionDraft,
} from "@/lib/published-programs/store";

/** Имитация записи/чтения meal_plan_item_ingredients (как saveConstructorPlan → loadConstructorPlanFor). */
function simulateDbIngredientRoundTrip(items: MealPlanItem[]): MealPlanItem[] {
  return items.map((item) => ({
    ...item,
    ingredients: item.ingredients.map(
      (ing): IngredientLine => ({
        product_id: ing.product_id,
        product_name: ing.product_name,
        grams: String(ing.grams),
        weighing_note: ing.weighing_note,
        kcal_per_100g: String(ing.kcal_per_100g),
        protein_per_100g: String(ing.protein_per_100g),
        fat_per_100g: String(ing.fat_per_100g),
        carbs_per_100g: String(ing.carbs_per_100g),
        fiber_per_100g: ing.fiber_per_100g != null ? String(ing.fiber_per_100g) : null,
        kcal: String(ing.kcal),
        protein_g: String(ing.protein_g),
        fat_g: String(ing.fat_g),
        carbs_g: String(ing.carbs_g),
        fiber_g: String(ing.fiber_g),
        sort_order: ing.sort_order,
      }),
    ),
  }));
}

function findOilLines(day: ConstructorDay) {
  return day.items.flatMap((item) =>
    item.ingredients
      .filter((ing) => AUTOGEN_OIL_PRODUCT_SLUGS.has(ing.product_id) || OIL_PRODUCT_SLUGS.has(ing.product_id))
      .filter((ing) => Number(ing.grams) > 0)
      .map((ing) => ({ slot: item.slot, ...ing })),
  );
}

describe("oil persistence integration", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
  const targets = calcMacroTargets({
    gender: "female",
    weight_kg: 65,
    height_cm: 165,
    birth_date: "1990-01-01",
    activity_level: "medium",
    goal_primary: "maintain",
    manual_kcal: 1500,
    manual_protein_g: Math.round((1500 * 0.3) / 4),
    manual_fat_g: Math.round((1500 * 0.3) / 9),
    manual_carbs_g: Math.round((1500 * 0.4) / 4),
  }).targets;

  function generateBalancedDay() {
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.days.length).toBe(1);
    return gen.days[0]!;
  }

  it("generates oil with real food_product_id in ingredient lines", () => {
    const day = generateBalancedDay();
    const oils = findOilLines(day).filter((o) => OIL_PRODUCT_SLUGS.has(o.product_id) || AUTOGEN_OIL_PRODUCT_SLUGS.has(o.product_id));
    expect(oils.length).toBeGreaterThan(0);
    for (const line of oils) {
      expect(ctx.products.has(line.product_id)).toBe(true);
      expect(line.product_id).not.toMatch(/^virtual-/);
      expect(line.product_name).toMatch(/масло/i);
      expect(Number(line.grams)).toBeGreaterThan(0);
    }
    expect(oils.some((o) => o.product_id === "butter")).toBe(false);
  });

  it("round-trips draft ingredients through DB-shaped serialization", () => {
    const day = generateBalancedDay();
    const beforeOils = findOilLines(day);
    expect(beforeOils.length).toBeGreaterThan(0);

    const reloaded: ConstructorDay = {
      ...day,
      items: simulateDbIngredientRoundTrip(day.items),
    };
    const afterOils = findOilLines(reloaded);
    expect(afterOils).toHaveLength(beforeOils.length);
    for (let i = 0; i < beforeOils.length; i++) {
      expect(afterOils[i]!.product_id).toBe(beforeOils[i]!.product_id);
      expect(afterOils[i]!.grams).toBe(beforeOils[i]!.grams);
      expect(afterOils[i]!.product_name).toBe(beforeOils[i]!.product_name);
    }
  });

  it("preserves oil and KBJU through draft save, publish and client reload", () => {
    const day = generateBalancedDay();
    const oilsBefore = findOilLines(day);

    const snapshot = buildConstructorNutritionSnapshot({
      days: [day],
      targets: {
        kcal: displayMacro(targets).kcal,
        protein_g: displayMacro(targets).protein_g,
        fat_g: displayMacro(targets).fat_g,
        carbs_g: displayMacro(targets).carbs_g,
      },
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });

    let store = createEmptyStore();
    store = saveNutritionDraft(store, "client-anon", snapshot);
    const draftLoaded = store.nutritionDrafts[0]!.snapshot;
    const draftDay = constructorDaysFromSnapshot(draftLoaded)[0]!;
    expect(findOilLines(draftDay)).toEqual(oilsBefore);

    store = publishNutritionVersion(store, {
      clientId: "client-anon",
      actorId: "trainer",
      snapshot: draftLoaded,
    });
    const clientSnap = clientVisibleNutrition(store, "client-anon")!;
    const clientDay = constructorDaysFromSnapshot(clientSnap)[0]!;
    const oilsClient = findOilLines(clientDay);
    expect(oilsClient).toEqual(oilsBefore);

    const clientMacro = {
      kcal: d(clientDay.kcal),
      protein_g: d(clientDay.protein_g),
      fat_g: d(clientDay.fat_g),
      carbs_g: d(clientDay.carbs_g),
      fiber_g: d(clientDay.fiber_g),
    };
    expect(clientDay.kcal).toBe(day.kcal);
    expect(clientDay.fat_g).toBe(day.fat_g);
    expect(withinTolerance(clientMacro, {
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(day.fiber_g),
    }, DEFAULT_TOLERANCE)).toBe(true);

    store = reseedCatalog(store, { "olive-oil": { kcal_per_100g: "9999" } });
    const afterReseed = clientVisibleNutrition(store, "client-anon")!;
    const afterReseedDay = constructorDaysFromSnapshot(afterReseed)[0]!;
    expect(findOilLines(afterReseedDay)).toEqual(oilsBefore);
    expect(afterReseedDay.kcal).toBe(clientDay.kcal);
  });
});
