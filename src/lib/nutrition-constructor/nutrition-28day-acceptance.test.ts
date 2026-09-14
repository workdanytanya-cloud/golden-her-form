/**
 * Отдельная приёмка 1313 / 1800 · two_main_two_snacks · 28 дней.
 * Не подменяет debug-тесты.
 *
 * npx vitest run src/lib/nutrition-constructor/nutrition-28day-acceptance.test.ts --pool=forks --maxWorkers=1
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";

const PROFILE_1313 = {
  name: "1313",
  targets: {
    kcal: d(1313),
    protein_g: d(112.1),
    fat_g: d(56.1),
    carbs_g: d(89.9),
    fiber_g: d(0),
  },
};

const PROFILE_1800 = {
  name: "1800",
  targets: {
    kcal: d(1800),
    protein_g: d(135),
    fat_g: d(60),
    carbs_g: d(180),
    fiber_g: d(0),
  },
};

function maxAbsDiff(
  days: Array<{ kcal: string; protein_g: string; fat_g: string; carbs_g: string }>,
  targets: (typeof PROFILE_1313)["targets"],
) {
  let maxKcal = 0;
  let maxP = 0;
  let maxF = 0;
  let maxC = 0;
  for (const day of days) {
    maxKcal = Math.max(maxKcal, Math.abs(Number(day.kcal) - targets.kcal.toNumber()));
    maxP = Math.max(maxP, Math.abs(Number(day.protein_g) - targets.protein_g.toNumber()));
    maxF = Math.max(maxF, Math.abs(Number(day.fat_g) - targets.fat_g.toNumber()));
    maxC = Math.max(maxC, Math.abs(Number(day.carbs_g) - targets.carbs_g.toNumber()));
  }
  return { maxKcal, maxP, maxF, maxC };
}

describe("28-day acceptance · two_main_two_snacks", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  it("1313 · two_main_two_snacks · 28 days", { timeout: 180_000 }, () => {
    const started = Date.now();
    const gen = generateConstructorPlan(ctx, {
      targets: PROFILE_1313.targets,
      days_count: 28,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const elapsedMs = Date.now() - started;
    expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
    expect(gen.days).toHaveLength(28);
    for (const day of gen.days) {
      const ok = withinTolerance(
        {
          kcal: d(day.kcal),
          protein_g: d(day.protein_g),
          fat_g: d(day.fat_g),
          carbs_g: d(day.carbs_g),
          fiber_g: d(0),
        },
        PROFILE_1313.targets,
        DEFAULT_TOLERANCE,
      );
      expect(ok, `day ${day.day_index}`).toBe(true);
    }
    const diffs = maxAbsDiff(gen.days, PROFILE_1313.targets);
    console.log(
      JSON.stringify({
        profile: "1313",
        elapsed_ms: elapsedMs,
        days: gen.days.length,
        is_valid: gen.is_valid,
        max_abs_diffs: diffs,
        sample_day0: displayMacro({
          kcal: d(gen.days[0]!.kcal),
          protein_g: d(gen.days[0]!.protein_g),
          fat_g: d(gen.days[0]!.fat_g),
          carbs_g: d(gen.days[0]!.carbs_g),
          fiber_g: d(0),
        }),
      }),
    );
  });

  it("1800 · two_main_two_snacks · 28 days", { timeout: 300_000 }, () => {
    const started = Date.now();
    const gen = generateConstructorPlan(ctx, {
      targets: PROFILE_1800.targets,
      days_count: 28,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    const elapsedMs = Date.now() - started;
    const diffs = gen.days.length
      ? maxAbsDiff(gen.days, PROFILE_1800.targets)
      : null;
    console.log(
      JSON.stringify({
        profile: "1800",
        elapsed_ms: elapsedMs,
        days: gen.days.length,
        is_valid: gen.is_valid,
        message: gen.message ?? null,
        infeasible: gen.diagnostics?.infeasible ?? null,
        max_abs_diffs: diffs,
      }),
    );
    // Честный статус: не ослабляем. Если генератор не собирает — тест падает.
    expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
    expect(gen.days).toHaveLength(28);
    for (const day of gen.days) {
      expect(
        withinTolerance(
          {
            kcal: d(day.kcal),
            protein_g: d(day.protein_g),
            fat_g: d(day.fat_g),
            carbs_g: d(day.carbs_g),
            fiber_g: d(0),
          },
          PROFILE_1800.targets,
          DEFAULT_TOLERANCE,
        ),
        `day ${day.day_index}`,
      ).toBe(true);
    }
  });
});
