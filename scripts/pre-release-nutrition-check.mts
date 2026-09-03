/**
 * Предрелизная проверка конструктора (локально, без production).
 * Запуск: npx tsx scripts/pre-release-nutrition-check.mts
 */
import { DEFAULT_TOLERANCE, type MealScheduleMode } from "../src/lib/nutrition-constructor/config.ts";
import { d, displayMacro, withinTolerance } from "../src/lib/nutrition-constructor/decimal-math.ts";
import { generateConstructorPlan } from "../src/lib/nutrition-constructor/optimizer.ts";
import { formatDayMenuReport, validateMenuRealism } from "../src/lib/nutrition-constructor/menu-realism.ts";
import { buildInMemoryCatalog } from "../src/lib/nutrition-constructor/repo.ts";
import { calcMacroTargets } from "../src/lib/nutrition-constructor/targets.ts";

const REGRESSION = {
  kcal: 1313,
  protein_g: 112.1,
  fat_g: 56.1,
  carbs_g: 89.9,
  note: "high-protein ~1313 kcal (бывший кейс +38 Б / −16 Ж)",
};

const STANDARD = calcMacroTargets({
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
}).targets;

const MODES: { mode: MealScheduleMode; label: string }[] = [
  { mode: "three_main_two_snacks", label: "3 основных + 2 перекуса" },
  { mode: "three_mains_only", label: "3 основных без перекусов" },
  { mode: "one_main_three_snacks", label: "1 основной + 3 перекуса" },
  { mode: "two_main_two_snacks", label: "legacy 2+2" },
];

function runSuite(name: string, targets: ReturnType<typeof calcMacroTargets>["targets"]) {
  const ctx = buildInMemoryCatalog({ includeTestPackaging: true });
  const targetDisp = displayMacro(targets);
  console.log(`\n=== ${name} ===`);
  console.log(
    `Цель: ${targetDisp.kcal} kcal · Б${targetDisp.protein_g} · Ж${targetDisp.fat_g} · У${targetDisp.carbs_g}`,
  );
  console.log("| Режим | Цель kcal | Факт kcal | Δ kcal | Δ белка | Δ жиров | Δ углеводов | Результат |");
  console.log("| ----- | --------: | --------: | -----: | ------: | ------: | ----------: | --------- |");

  for (const { mode, label } of MODES) {
    const gen = generateConstructorPlan(ctx, {
      targets,
      days_count: 1,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: mode,
      primary_meal_slot: "lunch",
    });
    if (!gen.days[0]) {
      console.log(`| ${label} | ${targetDisp.kcal} | — | — | — | — | — | ❌ нет дня |`);
      continue;
    }
    const day = gen.days[0];
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
        { kcal: d(day.kcal), protein_g: d(day.protein_g), fat_g: d(day.fat_g), carbs_g: d(day.carbs_g), fiber_g: d(0) },
        targets,
        DEFAULT_TOLERANCE,
      );
    const realism = validateMenuRealism({
      day,
      products: ctx.products,
      dayProteinTargetG: targetDisp.protein_g,
    });
    const result = ok && realism.length === 0 ? "✅ OK" : `❌ ${gen.message ?? realism[0]?.message ?? "fail"}`;
    console.log(
      `| ${label} | ${targetDisp.kcal} | ${actual.kcal} | ${actual.kcal - targetDisp.kcal} | ${(actual.protein_g - targetDisp.protein_g).toFixed(1)} | ${(actual.fat_g - targetDisp.fat_g).toFixed(1)} | ${(actual.carbs_g - targetDisp.carbs_g).toFixed(1)} | ${result} |`,
    );
    if (ok && mode === "three_main_two_snacks") {
      console.log("\n--- Пример меню (three_main_two_snacks) ---");
      console.log(formatDayMenuReport(day));
    }
  }
}

runSuite(REGRESSION.note, {
  kcal: d(REGRESSION.kcal),
  protein_g: d(REGRESSION.protein_g),
  fat_g: d(REGRESSION.fat_g),
  carbs_g: d(REGRESSION.carbs_g),
  fiber_g: d(0),
});

runSuite("Стандарт 1800 kcal", STANDARD);
