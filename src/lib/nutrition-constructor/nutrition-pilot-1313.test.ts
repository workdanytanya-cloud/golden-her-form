import { describe, expect, it } from "vitest";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import { DEFAULT_TOLERANCE, MAIN_RECIPE_REPEAT_DAYS } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { parseIngredientGrams } from "@/lib/nutrition-constructor/ingredient-normalize";
import { validateMenuRealism } from "@/lib/nutrition-constructor/menu-realism";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import {
  AUTOGEN_OIL_PRODUCT_SLUGS,
  OIL_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { checkDayStructure, type ConstructorDay } from "@/lib/nutrition-constructor/types";
import {
  fingerprintDay,
  snackPairKeyFromDay,
  uniqueDayFingerprints,
  weekCycleVarietyOk,
} from "@/lib/nutrition-constructor/week-cycle";
import { assertUnchangedHash } from "@/lib/published-programs/hash";
import { buildConstructorNutritionSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import {
  applyProductCatalogChange,
  applyRecipeCatalogChange,
  clientVisibleNutrition,
  createEmptyStore,
  onMeasurementSaved,
  publishNutritionVersion,
  recordClientMealPreference,
  reseedCatalog,
  saveNutritionDraft,
  tryUpdatePublishedNutrition,
} from "@/lib/published-programs/store";
import {
  AUTO_ENABLE_CONSTRUCTOR_FOR_ALL_CLIENTS,
  CLIENT_CAN_MUTATE_PUBLISHED_NUTRITION,
  PUBLISHED_IMMUTABLE_ERROR,
} from "@/lib/published-programs/config";

const TARGETS = {
  kcal: d(1313),
  protein_g: d(112.1),
  fat_g: d(56.1),
  carbs_g: d(89.9),
  fiber_g: d(0),
};

function isOilLine(productId: string, productName: string): boolean {
  return (
    AUTOGEN_OIL_PRODUCT_SLUGS.has(productId) ||
    OIL_PRODUCT_SLUGS.has(productId) ||
    /масл/i.test(productName)
  );
}

function assertPilotDay(
  day: ConstructorDay,
  products: ReturnType<typeof buildInMemoryCatalog>["products"],
) {
  const structure = checkDayStructure(day, "two_main_two_snacks");
  expect(structure.mains.actual, `day ${day.day_index} mains`).toBe(2);
  expect(structure.snacks.actual, `day ${day.day_index} snacks`).toBe(2);
  expect(structure.noCookSnacks.actual, `day ${day.day_index} no-cook snacks`).toBe(2);
  expect(day.is_valid, `day ${day.day_index} valid`).toBe(true);

  const macro = {
    kcal: d(day.kcal),
    protein_g: d(day.protein_g),
    fat_g: d(day.fat_g),
    carbs_g: d(day.carbs_g),
    fiber_g: d(0),
  };
  expect(withinTolerance(macro, TARGETS, DEFAULT_TOLERANCE), `day ${day.day_index} KBJU`).toBe(
    true,
  );

  const mains = day.items.filter((item) => item.slot.startsWith("main"));
  expect(mains[0]!.recipe_id).not.toBe(mains[1]!.recipe_id);

  for (const item of day.items) {
    expect(item.ingredients.length, `${item.slot} has ingredients`).toBeGreaterThan(0);
    for (const ing of item.ingredients) {
      const grams = parseIngredientGrams(ing.grams);
      expect(grams, `${ing.product_name} grams`).toBeGreaterThan(0);
      const product = products.get(ing.product_id);
      expect(product, `known product ${ing.product_id}`).toBeTruthy();
      expect(product!.is_verified, `${ing.product_id} verified`).toBe(true);
    }
    const oils = item.ingredients.filter((ing) => isOilLine(ing.product_id, ing.product_name));
    expect(oils.every((ing) => parseIngredientGrams(ing.grams) > 0)).toBe(true);
  }

  expect(
    validateMenuRealism({
      day,
      products,
      dayProteinTargetG: displayMacro(TARGETS).protein_g,
    }),
  ).toEqual([]);
}

function mainRepeatGapOk(days: ConstructorDay[]): boolean {
  const uses = new Map<string, number[]>();
  for (const day of days) {
    for (const item of day.items) {
      if (!item.slot.startsWith("main")) continue;
      const arr = uses.get(item.recipe_id) ?? [];
      arr.push(day.day_index);
      uses.set(item.recipe_id, arr);
    }
  }
  for (const positions of uses.values()) {
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! < MAIN_RECIPE_REPEAT_DAYS) return false;
    }
  }
  return true;
}

describe("1313 two_main_two_snacks 28-day pilot", () => {
  it("1313 · two_main_two_snacks · 28 days · pilot release", { timeout: 120_000 }, () => {
    expect(AUTO_ENABLE_CONSTRUCTOR_FOR_ALL_CLIENTS).toBe(false);
    expect(CLIENT_CAN_MUTATE_PUBLISHED_NUTRITION).toBe(false);

    const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
    const { forbiddenIds } = buildForbiddenProductIds([...ctx.products.values()], {});
    const started = Date.now();
    const gen = generateConstructorPlan(ctx, {
      targets: TARGETS,
      days_count: 28,
      excluded_product_ids: [...forbiddenIds],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const elapsedMs = Date.now() - started;

    expect(gen.is_valid, gen.message ?? "invalid plan").toBe(true);
    expect(gen.days).toHaveLength(28);
    expect(elapsedMs).toBeLessThanOrEqual(120_000);
    expect(gen.diagnostics?.week_tiled).toBe(true);

    const uniqueFingerprints = uniqueDayFingerprints(gen.days);
    const uniqueDays = uniqueFingerprints.map((fp) =>
      gen.days.find((day) => fingerprintDay(day) === fp)!,
    );
    expect(
      uniqueDays.length,
      `catalog unique days=${uniqueDays.length}; need 7 if possible`,
    ).toBeGreaterThanOrEqual(1);

    for (const day of gen.days) {
      assertPilotDay(day, ctx.products);
    }

    for (let i = 1; i < gen.days.length; i++) {
      expect(fingerprintDay(gen.days[i]!)).not.toBe(fingerprintDay(gen.days[i - 1]!));
      expect(snackPairKeyFromDay(gen.days[i]!)).not.toBe(snackPairKeyFromDay(gen.days[i - 1]!));
    }
    expect(mainRepeatGapOk(gen.days)).toBe(true);
    expect(weekCycleVarietyOk(uniqueDays)).toBe(true);

    const uniqueKbju = uniqueDays.map((day) => ({
      fingerprint: fingerprintDay(day),
      recipes: day.items.map((item) => item.recipe_name),
      kcal: displayMacro({
        kcal: d(day.kcal),
        protein_g: d(day.protein_g),
        fat_g: d(day.fat_g),
        carbs_g: d(day.carbs_g),
        fiber_g: d(0),
      }),
      protein_g: Number(day.protein_g),
      fat_g: Number(day.fat_g),
      carbs_g: Number(day.carbs_g),
    }));
    console.log(
      JSON.stringify(
        {
          unique_days: uniqueDays.length,
          elapsed_ms: elapsedMs,
          diagnostics_elapsed_ms: gen.diagnostics?.elapsed_ms,
          unique_kbju: uniqueKbju,
        },
        null,
        2,
      ),
    );

    const snapshot = buildConstructorNutritionSnapshot({
      days: gen.days,
      targets: { kcal: 1313, protein_g: 112.1, fat_g: 56.1, carbs_g: 89.9 },
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(snapshot.constructor_days).toHaveLength(28);

    let store = createEmptyStore();
    store = saveNutritionDraft(store, "pilot-client", snapshot);
    expect(store.nutritionDrafts[0]!.snapshot.constructor_days).toHaveLength(28);
    expect(clientVisibleNutrition(store, "pilot-client")).toBeNull();

    const reloaded = store.nutritionDrafts[0]!.snapshot;
    store = publishNutritionVersion(store, {
      clientId: "pilot-client",
      actorId: "trainer-1",
      snapshot: reloaded,
    });
    const assigned = clientVisibleNutrition(store, "pilot-client")!;
    expect(assigned.constructor_days).toHaveLength(28);
    expect(assigned.targets.kcal).toBe(1313);
    const publishedHash = store.nutritionVersions[0]!.content_hash;
    expect(assertUnchangedHash(store.nutritionVersions[0]!.snapshot, publishedHash)).toBe(true);
    const frozen = structuredClone(assigned);

    store = reseedCatalog(store, { "olive-oil": { kcal_per_100g: "1" } });
    store = applyProductCatalogChange(store, "chicken-breast-raw", "1");
    store = applyRecipeCatalogChange(
      store,
      assigned.constructor_days[0]!.items[0]!.recipe_id,
      "CHANGED",
    );
    const afterCatalog = clientVisibleNutrition(store, "pilot-client")!;
    expect(afterCatalog).toEqual(frozen);
    expect(store.nutritionVersions[0]!.content_hash).toBe(publishedHash);
    expect(assertUnchangedHash(store.nutritionVersions[0]!.snapshot, publishedHash)).toBe(true);

    store = onMeasurementSaved(store, {
      clientId: "pilot-client",
      measurementId: "m-new",
      newWeightKg: 80,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "medium",
      goal_primary: "maintain",
    });
    expect(store.recommendations).toHaveLength(1);
    expect(store.recommendations[0]!.status).toBe("pending_trainer_review");
    expect(clientVisibleNutrition(store, "pilot-client")).toEqual(frozen);
    expect(clientVisibleNutrition(store, "pilot-client")!.targets.kcal).toBe(1313);
    expect(store.nutritionVersions[0]!.content_hash).toBe(publishedHash);

    store = recordClientMealPreference(store, {
      clientId: "pilot-client",
      requestedMode: "three_main_two_snacks",
    });
    expect(clientVisibleNutrition(store, "pilot-client")).toEqual(frozen);
    expect(clientVisibleNutrition(store, "other-client")).toBeNull();

    expect(() =>
      tryUpdatePublishedNutrition(store, store.nutritionVersions[0]!.id, (snap) => ({
        ...snap,
        targets: { ...snap.targets, kcal: 1800 },
      })),
    ).toThrow(PUBLISHED_IMMUTABLE_ERROR);

    expect(uniqueDays.length).toBeGreaterThanOrEqual(3);
    if (uniqueDays.length < 7) {
      console.warn(
        `Catalog limitation: ${uniqueDays.length} unique valid 1313 two_main_two_snacks days (target 7). Publishing the largest variety-safe week cycle.`,
      );
    }
  });
});
