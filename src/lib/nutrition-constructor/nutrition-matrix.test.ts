/**
 * Полная матрица kcal × mode (1 день), последовательный прогон.
 * Результаты: docs/nutrition-matrix-results.json (merge по шардám).
 *
 * npx vitest run src/lib/nutrition-constructor/nutrition-matrix.test.ts --pool=forks --maxWorkers=1
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";
import type { NutritionReasonCode } from "@/lib/nutrition-constructor/reason-codes";

const KCALS = [1200, 1313, 1500, 1726, 1800, 2000, 2200] as const;
const MODES: MealScheduleMode[] = [
  "three_mains_only",
  "three_main_two_snacks",
  "two_main_two_snacks",
  "one_main_three_snacks",
];
const SEED = 17260917;
const OUT = "docs/nutrition-matrix-results.json";

type MatrixRow = {
  kcal: number;
  mode: MealScheduleMode;
  status: NutritionReasonCode;
  actual: { kcal: number; protein_g: number; fat_g: number; carbs_g: number } | null;
  diffs: { kcal: number; protein_g: number; fat_g: number; carbs_g: number } | null;
  elapsed_ms: number;
  fast_elapsed_ms?: number;
  fallback_elapsed_ms?: number;
  search_stage?: string;
  used_fallback?: boolean;
  days: number;
  seed: number;
  message?: string | null;
};

function mergeWrite(newRows: MatrixRow[]) {
  mkdirSync("docs", { recursive: true });
  let rows: MatrixRow[] = [];
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, "utf8")) as { rows?: MatrixRow[] };
      rows = prev.rows ?? [];
    } catch {
      rows = [];
    }
  }
  for (const row of newRows) {
    const idx = rows.findIndex((r) => r.kcal === row.kcal && r.mode === row.mode);
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
  }
  const by_status = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  writeFileSync(OUT, JSON.stringify({ total: rows.length, by_status, rows }, null, 2), "utf8");
}

const sessionRows: MatrixRow[] = [];

describe("nutrition matrix kcal × mode", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  for (const kcal of KCALS) {
    for (const mode of MODES) {
      it(`${kcal} · ${mode}`, { timeout: 120_000 }, () => {
        const targets = consistentTargetsForKcal(kcal);
        const t0 = Date.now();
        const gen = generateConstructorPlan(ctx, {
          targets,
          days_count: 1,
          excluded_product_ids: [],
          tolerance: DEFAULT_TOLERANCE,
          meal_schedule_mode: mode,
          primary_meal_slot: "lunch",
          seed: SEED,
        });
        const elapsed = Date.now() - t0;
        const status = (gen.reason_code ??
          (gen.is_valid
            ? "PASS"
            : gen.diagnostics?.timed_out
              ? "TIMEOUT"
              : gen.diagnostics?.infeasible
                ? "INFEASIBLE"
                : "INTERNAL_ERROR")) as NutritionReasonCode;

        let actual = null;
        let diffs = null;
        if (gen.is_valid && gen.days[0]) {
          const day = gen.days[0];
          const disp = displayMacro({
            kcal: d(day.kcal),
            protein_g: d(day.protein_g),
            fat_g: d(day.fat_g),
            carbs_g: d(day.carbs_g),
            fiber_g: d(0),
          });
          const tgt = displayMacro(targets);
          actual = disp;
          diffs = {
            kcal: disp.kcal - tgt.kcal,
            protein_g: Number((disp.protein_g - tgt.protein_g).toFixed(1)),
            fat_g: Number((disp.fat_g - tgt.fat_g).toFixed(1)),
            carbs_g: Number((disp.carbs_g - tgt.carbs_g).toFixed(1)),
          };
          expect(
            withinTolerance(
              {
                kcal: d(day.kcal),
                protein_g: d(day.protein_g),
                fat_g: d(day.fat_g),
                carbs_g: d(day.carbs_g),
                fiber_g: d(0),
              },
              targets,
              DEFAULT_TOLERANCE,
            ),
          ).toBe(true);
        }

        sessionRows.push({
          kcal,
          mode,
          status,
          actual,
          diffs,
          elapsed_ms: elapsed,
          fast_elapsed_ms: gen.diagnostics?.fast_elapsed_ms,
          fallback_elapsed_ms: gen.diagnostics?.fallback_elapsed_ms,
          search_stage: gen.diagnostics?.search_stage,
          used_fallback: gen.diagnostics?.used_fallback,
          days: gen.days.length,
          seed: SEED,
          message: gen.message,
        });

        expect([
          "PASS",
          "INFEASIBLE",
          "TIMEOUT",
          "INVALID_TARGET",
          "NO_ALLOWED_PRODUCTS",
          "INTERNAL_ERROR",
        ]).toContain(status);
        expect(Number.isFinite(elapsed)).toBe(true);
      });
    }
  }

  afterAll(() => {
    if (sessionRows.length > 0) mergeWrite(sessionRows);
  });
});
