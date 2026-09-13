import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOLERANCE,
  type MealScheduleMode,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { validateMenuRealism } from "@/lib/nutrition-constructor/menu-realism";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";

const PROFILE_1313 = {
  name: "1313 high-protein",
  targets: {
    kcal: d(1313),
    protein_g: d(112.1),
    fat_g: d(56.1),
    carbs_g: d(89.9),
    fiber_g: d(0),
  },
} as const;

const PROFILE_1800 = {
  name: "1800 standard",
  targets: {
    kcal: d(1800),
    protein_g: d(135),
    fat_g: d(60),
    carbs_g: d(180),
    fiber_g: d(0),
  },
} as const;

const MODES_ALL: MealScheduleMode[] = [
  "three_main_two_snacks",
  "two_main_two_snacks",
  "one_main_three_snacks",
  "three_mains_only",
];

const PRIMARY_SLOTS: PrimaryMealSlot[] = ["breakfast", "lunch", "dinner"];

function expectDayWithinTolerance(
  day: Pick<ConstructorDay, "kcal" | "protein_g" | "fat_g" | "carbs_g">,
  targets: typeof PROFILE_1313.targets,
) {
  const macro = {
    kcal: d(day.kcal),
    protein_g: d(day.protein_g),
    fat_g: d(day.fat_g),
    carbs_g: d(day.carbs_g),
    fiber_g: d(0),
  };
  expect(withinTolerance(macro, targets, DEFAULT_TOLERANCE)).toBe(true);
}

describe("acceptance: control KBJU profiles (test catalog)", () => {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });

  for (const profile of [PROFILE_1313, PROFILE_1800]) {
    for (const mode of MODES_ALL) {
      if (mode === "one_main_three_snacks") {
        for (const primary of PRIMARY_SLOTS) {
          it(`${profile.name} · ${mode} · ${primary}`, { timeout: 45_000 }, () => {
            const gen = generateConstructorPlan(ctx, {
              targets: profile.targets,
              days_count: 1,
              excluded_product_ids: [],
              tolerance: DEFAULT_TOLERANCE,
              meal_schedule_mode: mode,
              primary_meal_slot: primary,
            });
            expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
            expect(gen.days).toHaveLength(1);
            const day = gen.days[0]!;
            expectDayWithinTolerance(day, profile.targets);
            if (profile === PROFILE_1313) {
              expect(
                validateMenuRealism({
                  day,
                  products: ctx.products,
                  dayProteinTargetG: displayMacro(profile.targets).protein_g,
                }),
              ).toEqual([]);
            }
          });
        }
      } else {
        it(`${profile.name} · ${mode}`, { timeout: 45_000 }, () => {
          const gen = generateConstructorPlan(ctx, {
            targets: profile.targets,
            days_count: 1,
            excluded_product_ids: [],
            tolerance: DEFAULT_TOLERANCE,
            meal_schedule_mode: mode,
            primary_meal_slot: "lunch",
          });
          expect(gen.is_valid, gen.message ?? "invalid").toBe(true);
          expect(gen.days).toHaveLength(1);
          expectDayWithinTolerance(gen.days[0]!, profile.targets);
        });
      }
    }
  }

  it("is deterministic for 1313 / 3+2", { timeout: 80_000 }, () => {
    const input = {
      targets: PROFILE_1313.targets,
      days_count: 1 as const,
      excluded_product_ids: [] as string[],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks" as const,
      primary_meal_slot: "lunch" as const,
    };
    const a = generateConstructorPlan(ctx, input);
    const b = generateConstructorPlan(ctx, input);
    expect(a.days[0]!.protein_g).toBe(b.days[0]!.protein_g);
    expect(a.days[0]!.fat_g).toBe(b.days[0]!.fat_g);
    expect(a.days[0]!.kcal).toBe(b.days[0]!.kcal);
  });
});

describe("acceptance: verified-only catalog readiness", () => {
  it("reports infeasible or partial coverage without test packaging", { timeout: 35_000 }, () => {
    const ctx = buildInMemoryCatalog();
    const gen = generateConstructorPlan(ctx, {
      targets: PROFILE_1313.targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(typeof gen.is_valid).toBe("boolean");
    if (!gen.is_valid) {
      expect(gen.diagnostics?.infeasible ?? true).toBe(true);
      expect(gen.message).toBeTruthy();
    }
  });
});

describe("acceptance: infeasible profile", () => {
  it("returns infeasible with message for impossible targets", { timeout: 10_000 }, () => {
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
    const started = Date.now();
    const gen = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(1313),
        protein_g: d(300),
        fat_g: d(10),
        carbs_g: d(10),
        fiber_g: d(0),
      },
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "three_main_two_snacks",
      primary_meal_slot: "lunch",
    });
    expect(Date.now() - started).toBeLessThan(30000);
    expect(gen.is_valid).toBe(false);
    expect(gen.days).toHaveLength(0);
    expect(gen.message).toMatch(/не удалось|Невозмож|не удалось/i);
  });
});
