import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { d, displayMacro, withinTolerance } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { formatDayMenuReport, validateMenuRealism } from "@/lib/nutrition-constructor/menu-realism";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";

describe("pre-release nutrition check (report)", () => {
  it("prints mode comparison tables for regression and standard profiles", () => {
    const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
    const suites = [
      {
        name: "high-protein ~1313 kcal (бывший +38 Б / −16 Ж)",
        targets: {
          kcal: d(1313),
          protein_g: d(112.1),
          fat_g: d(56.1),
          carbs_g: d(89.9),
          fiber_g: d(0),
        },
      },
      {
        name: "стандарт 1800 kcal",
        targets: calcMacroTargets({
          gender: "female",
          weight_kg: 65,
          height_cm: 165,
          birth_date: "1990-01-01",
          activity_level: "medium",
          goal_primary: "maintain",
          manual_kcal: 1800,
          manual_protein_g: 135,
          manual_fat_g: 60,
          manual_carbs_g: 180,
        }).targets,
      },
    ];

    const modes: { mode: MealScheduleMode; label: string }[] = [
      { mode: "three_main_two_snacks", label: "3 основных + 2 перекуса" },
      { mode: "three_mains_only", label: "3 основных без перекусов" },
      { mode: "one_main_three_snacks", label: "1 основной + 3 перекуса" },
      { mode: "two_main_two_snacks", label: "legacy 2+2" },
    ];

    const report: string[] = [];
    for (const suite of suites) {
      const target = displayMacro(suite.targets);
      report.push(`\n=== ${suite.name} ===`);
      report.push(
        `Цель: ${target.kcal} kcal · Б${target.protein_g} · Ж${target.fat_g} · У${target.carbs_g}`,
      );
      report.push(
        "| Режим | Цель kcal | Факт kcal | Δ kcal | Δ белка | Δ жиров | Δ углеводов | Результат |",
      );
      report.push(
        "| ----- | --------: | --------: | -----: | ------: | ------: | ----------: | --------- |",
      );

      for (const { mode, label } of modes) {
        const gen = generateConstructorPlan(ctx, {
          targets: suite.targets,
          days_count: 1,
          excluded_product_ids: [],
          tolerance: DEFAULT_TOLERANCE,
          meal_schedule_mode: mode,
          primary_meal_slot: "lunch",
        });
        const day = gen.days[0];
        if (!day) {
          report.push(`| ${label} | ${target.kcal} | — | — | — | — | — | ❌ нет дня |`);
          continue;
        }
        const actual = displayMacro({
          kcal: d(day.kcal),
          protein_g: d(day.protein_g),
          fat_g: d(day.fat_g),
          carbs_g: d(day.carbs_g),
          fiber_g: d(day.fiber_g),
        });
        const ok =
          gen.is_valid &&
          withinTolerance(
            {
              kcal: d(day.kcal),
              protein_g: d(day.protein_g),
              fat_g: d(day.fat_g),
              carbs_g: d(day.carbs_g),
              fiber_g: d(0),
            },
            suite.targets,
            DEFAULT_TOLERANCE,
          );
        const realism = validateMenuRealism({
          day,
          products: ctx.products,
          dayProteinTargetG: target.protein_g,
        });
        const result =
          ok && realism.length === 0
            ? "✅ OK"
            : `❌ ${gen.message ?? realism[0]?.message ?? "не в допуске"}`;
        report.push(
          `| ${label} | ${target.kcal} | ${actual.kcal} | ${actual.kcal - target.kcal} | ${(actual.protein_g - target.protein_g).toFixed(1)} | ${(actual.fat_g - target.fat_g).toFixed(1)} | ${(actual.carbs_g - target.carbs_g).toFixed(1)} | ${result} |`,
        );
        if (ok && mode === "three_main_two_snacks" && suite.name.includes("1313")) {
          report.push("\n--- Меню дня ---");
          report.push(formatDayMenuReport(day));
        }
      }
    }

    writeFileSync(join(process.cwd(), "pre-release-nutrition-report.txt"), report.join("\n"), "utf8");
    expect(report.length).toBeGreaterThan(5);
  });
});
