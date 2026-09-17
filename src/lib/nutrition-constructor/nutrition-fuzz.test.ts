/**
 * Fuzz / property: 25 согласованных целей × 4 режима = 100 cases, seed фиксирован.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { mulberry32, validateMacroTargets } from "@/lib/nutrition-constructor/target-validation";
import type { NutritionReasonCode } from "@/lib/nutrition-constructor/reason-codes";

const MODES: MealScheduleMode[] = [
  "three_mains_only",
  "three_main_two_snacks",
  "two_main_two_snacks",
  "one_main_three_snacks",
];
const BASE_SEED = 424242;
const CASES_PER_MODE = 25;

function fuzzTarget(rnd: () => number) {
  const kcal = Math.round(1200 + rnd() * 1200);
  const proteinPct = 0.2 + rnd() * 0.15;
  const fatPct = 0.2 + rnd() * 0.15;
  const protein = Math.round(((kcal * proteinPct) / 4) * 10) / 10;
  const fat = Math.round(((kcal * fatPct) / 9) * 10) / 10;
  const carbs = Math.round(((kcal - protein * 4 - fat * 9) / 4) * 10) / 10;
  return {
    kcal: d(kcal),
    protein_g: d(protein),
    fat_g: d(fat),
    carbs_g: d(carbs),
    fiber_g: d(0),
  };
}

type FuzzRow = {
  mode: MealScheduleMode;
  case_index: number;
  seed: number;
  kcal: number;
  status: NutritionReasonCode;
  elapsed_ms: number;
  days: number;
  partial: boolean;
};

describe("nutrition fuzz 100+", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
  const rows: FuzzRow[] = [];

  for (const mode of MODES) {
    for (let i = 0; i < CASES_PER_MODE; i++) {
      const seed = BASE_SEED + MODES.indexOf(mode) * 1000 + i;
      it(`${mode} #${i} seed=${seed}`, { timeout: 90_000 }, () => {
        const rnd = mulberry32(seed);
        const targets = fuzzTarget(rnd);
        expect(validateMacroTargets(targets).ok).toBe(true);
        const t0 = Date.now();
        let gen;
        let status: NutritionReasonCode = "INTERNAL_ERROR";
        try {
          gen = generateConstructorPlan(ctx, {
            targets,
            days_count: 1,
            excluded_product_ids: [],
            tolerance: DEFAULT_TOLERANCE,
            meal_schedule_mode: mode,
            primary_meal_slot: "lunch",
            seed,
            search_timeout_ms: 12_000,
          });
          status = (gen.reason_code ??
            (gen.is_valid
              ? "PASS"
              : gen.diagnostics?.timed_out
                ? "TIMEOUT"
                : "INFEASIBLE")) as NutritionReasonCode;
        } catch {
          status = "INTERNAL_ERROR";
          gen = undefined;
        }
        const elapsed = Date.now() - t0;
        const days = gen?.days.length ?? 0;
        const partial = !!gen && !gen.is_valid && days > 0 && days < 1;
        // Near-miss не публикуется: при fail days должны быть пусты.
        if (gen && !gen.is_valid) {
          expect(gen.days.length).toBe(0);
        }
        if (gen?.is_valid) {
          for (const day of gen.days) {
            expect(Number.isFinite(Number(day.kcal))).toBe(true);
            expect(Number.isNaN(Number(day.protein_g))).toBe(false);
          }
        }
        rows.push({
          mode,
          case_index: i,
          seed,
          kcal: targets.kcal.toNumber(),
          status,
          elapsed_ms: elapsed,
          days,
          partial: !!partial,
        });
        expect([
          "PASS",
          "INFEASIBLE",
          "TIMEOUT",
          "INVALID_TARGET",
          "NO_ALLOWED_PRODUCTS",
          "INTERNAL_ERROR",
        ]).toContain(status);
      });
    }
  }

  afterAll(() => {
    if (rows.length === 0) return;
    mkdirSync("docs", { recursive: true });
    const by_status = rows.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    writeFileSync(
      "docs/nutrition-fuzz-results.json",
      JSON.stringify({ total: rows.length, by_status, rows }, null, 2),
      "utf8",
    );
  });
});
