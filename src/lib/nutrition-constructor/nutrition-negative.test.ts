import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { PROTEIN_MAIN_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";

describe("nutrition negative reason codes", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("INVALID_TARGET when kcal contradicts macros", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(2000),
        protein_g: d(10),
        fat_g: d(10),
        carbs_g: d(10),
        fiber_g: d(0),
      },
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.reason_code).toBe("INVALID_TARGET");
    expect(gen.is_valid).toBe(false);
    expect(gen.days).toHaveLength(0);
    expect(gen.diagnostics?.timed_out).toBe(false);
    expect(gen.diagnostics?.infeasible).toBe(false);
  });

  it("NO_ALLOWED_PRODUCTS when all protein products excluded", () => {
    const proteinIds = [...ctx.products.values()]
      .filter(
        (p) =>
          PROTEIN_MAIN_PRODUCT_SLUGS.has(p.slug) ||
          p.category === "meat" ||
          p.category === "fish" ||
          p.category === "dairy",
      )
      .map((p) => p.id);
    const gen = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1800),
      days_count: 1,
      excluded_product_ids: proteinIds,
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(gen.reason_code).toBe("NO_ALLOWED_PRODUCTS");
    expect(gen.days).toHaveLength(0);
  });

  it("TIMEOUT is not reported as INFEASIBLE", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1726),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      search_timeout_ms: 1,
      force_top_n: 1,
    });
    expect(gen.is_valid).toBe(false);
    expect(gen.reason_code).toBe("TIMEOUT");
    expect(gen.diagnostics?.timed_out).toBe(true);
    expect(gen.diagnostics?.infeasible).toBe(false);
    expect(gen.message ?? "").toMatch(/TIMEOUT/);
    expect(gen.message ?? "").not.toMatch(/INFEASIBLE/);
  });

  it("INTERNAL_ERROR from forced throw", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1500),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
      force_internal_error: true,
    });
    expect(gen.reason_code).toBe("INTERNAL_ERROR");
    expect(gen.days).toHaveLength(0);
  });

  it("near-miss is not returned as ready days", () => {
    const gen = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(1800),
        protein_g: d(250),
        fat_g: d(20),
        carbs_g: d(20),
        fiber_g: d(0),
      },
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    // Либо INVALID_TARGET (энергия), либо fail без дней.
    expect(gen.is_valid).toBe(false);
    expect(gen.days).toHaveLength(0);
  });
});

describe("exact fallback beyond Top-N", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("finds PASS via fallback when force_top_n is tiny", { timeout: 180_000 }, () => {
    const gen = generateConstructorPlan(ctx, {
      targets: consistentTargetsForKcal(1726),
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      force_top_n: 3,
      seed: 99,
    });
    expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
    expect(gen.reason_code).toBe("PASS");
    // При урезанном Top-N ожидаем, что сработал fallback (если fast не угадал).
    if (gen.diagnostics?.used_fallback) {
      expect(gen.diagnostics.search_stage).toMatch(/exact|expand/);
      expect((gen.diagnostics.fallback_elapsed_ms ?? 0) >= 0).toBe(true);
    }
  });
});
