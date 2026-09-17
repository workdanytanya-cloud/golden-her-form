/**
 * Performance probe: sequential 1-CPU-like timings for key profiles.
 * Writes docs/nutrition-perf-results.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";

const PROBES: Array<{ kcal: number; mode: MealScheduleMode; days: 1 | 7 }> = [
  { kcal: 1313, mode: "two_main_two_snacks", days: 1 },
  { kcal: 1726, mode: "three_mains_only", days: 1 },
  { kcal: 1726, mode: "three_mains_only", days: 7 },
  { kcal: 1800, mode: "two_main_two_snacks", days: 1 },
  { kcal: 1500, mode: "three_main_two_snacks", days: 1 },
  { kcal: 2000, mode: "one_main_three_snacks", days: 1 },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

describe("nutrition performance sequential", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
  const samples: Array<{
    label: string;
    elapsed_ms: number;
    fast_elapsed_ms?: number;
    fallback_elapsed_ms?: number;
    used_fallback?: boolean;
    status: string;
  }> = [];

  for (const probe of PROBES) {
    it(`${probe.kcal} ${probe.mode} ${probe.days}d`, { timeout: 180_000 }, () => {
      const t0 = Date.now();
      const gen = generateConstructorPlan(ctx, {
        targets: consistentTargetsForKcal(probe.kcal),
        days_count: probe.days,
        excluded_product_ids: [],
        tolerance: DEFAULT_TOLERANCE,
        meal_schedule_mode: probe.mode,
        primary_meal_slot: "lunch",
        seed: 7,
      });
      const elapsed = Date.now() - t0;
      samples.push({
        label: `${probe.kcal}/${probe.mode}/${probe.days}d`,
        elapsed_ms: elapsed,
        fast_elapsed_ms: gen.diagnostics?.fast_elapsed_ms,
        fallback_elapsed_ms: gen.diagnostics?.fallback_elapsed_ms,
        used_fallback: gen.diagnostics?.used_fallback,
        status: gen.reason_code ?? (gen.is_valid ? "PASS" : "FAIL"),
      });
      expect(Number.isFinite(elapsed)).toBe(true);
    });
  }

  it("writes perf summary", () => {
    const times = samples.map((s) => s.elapsed_ms).sort((a, b) => a - b);
    const fast = samples
      .map((s) => s.fast_elapsed_ms)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    const fallback = samples
      .map((s) => s.fallback_elapsed_ms)
      .filter((x): x is number => typeof x === "number" && x > 0)
      .sort((a, b) => a - b);
    const summary = {
      n: samples.length,
      median_ms: percentile(times, 50),
      p95_ms: percentile(times, 95),
      max_ms: times[times.length - 1] ?? 0,
      fast_median_ms: percentile(fast, 50),
      fallback_median_ms: percentile(fallback, 50),
      samples,
    };
    mkdirSync("docs", { recursive: true });
    writeFileSync("docs/nutrition-perf-results.json", JSON.stringify(summary, null, 2), "utf8");
    expect(samples.length).toBe(PROBES.length);
  });
});
