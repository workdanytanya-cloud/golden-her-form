import {
  DEFAULT_TOLERANCE,
  toleranceForMode,
  type MealScheduleMode,
} from "@/lib/nutrition-constructor/config";
import { d, sumMacros, withinTolerance, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";
import type { ConstructorDay, MacroComparisonRow } from "@/lib/nutrition-constructor/types";
import {
  formatMacroPrecisionHint,
  macroDeviationsOutsideTolerance,
} from "@/lib/nutrition-constructor/validation-messages";

export function dayHasRequiredSlots(day: ConstructorDay, mode: MealScheduleMode): boolean {
  const mains = day.items.filter((i) => i.slot.startsWith("main")).length;
  const snacks = day.items.filter((i) => i.slot.startsWith("snack")).length;
  switch (mode) {
    case "three_main_two_snacks":
      return mains === 3 && snacks === 2;
    case "three_mains_only":
      return mains === 3 && snacks === 0;
    case "one_main_three_snacks":
      return mains === 1 && snacks === 3;
    default:
      return mains === 2 && snacks === 2;
  }
}

export function planStructureValid(days: ConstructorDay[], mode: MealScheduleMode): boolean {
  return days.length > 0 && days.every((day) => dayHasRequiredSlots(day, mode));
}

export type PlanKbjuStatus = {
  /** Среднее и дни в допуске режима (можно назначить клиенту). */
  acceptable: boolean;
  /** Попадание в строгий допуск ±1 г / ±5 ккал. */
  exact: boolean;
  /** Текст «+N г белка…» для ручной доводки до точного целевого KBJU. */
  precisionHint: string;
  /** Рацион собран: структура ок или KBJU в допуске режима. */
  generationOk: boolean;
  invalidDayCount: number;
};

export function evaluatePlanKbjuStatus(params: {
  days: ConstructorDay[];
  targetMacro: MacroBreakdown;
  scheduleMode: MealScheduleMode;
  comparison: MacroComparisonRow[];
}): PlanKbjuStatus {
  const { days, targetMacro, scheduleMode, comparison } = params;
  const tolerance = toleranceForMode(scheduleMode);
  const structureOk = planStructureValid(days, scheduleMode);

  if (days.length === 0) {
    return {
      acceptable: false,
      exact: false,
      precisionHint: "",
      generationOk: false,
      invalidDayCount: 0,
    };
  }

  const invalidDayCount = days.filter(
    (day) =>
      !withinTolerance(
        {
          kcal: d(day.kcal),
          protein_g: d(day.protein_g),
          fat_g: d(day.fat_g),
          carbs_g: d(day.carbs_g),
          fiber_g: d(day.fiber_g),
        },
        targetMacro,
        tolerance,
      ),
  ).length;

  const avgTotals = sumMacros(
    days.map((day) => ({
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(day.fiber_g),
    })),
  );
  const avgMacro = {
    kcal: avgTotals.kcal.div(days.length),
    protein_g: avgTotals.protein_g.div(days.length),
    fat_g: avgTotals.fat_g.div(days.length),
    carbs_g: avgTotals.carbs_g.div(days.length),
    fiber_g: avgTotals.fiber_g.div(days.length),
  };

  const avgValid = withinTolerance(avgMacro, targetMacro, tolerance);
  const allDaysValid = invalidDayCount === 0;

  const acceptable = allDaysValid && avgValid && structureOk;

  const exact = macroDeviationsOutsideTolerance(comparison, DEFAULT_TOLERANCE).length === 0;
  const precisionHint = formatMacroPrecisionHint(comparison, DEFAULT_TOLERANCE);
  const generationOk = acceptable;

  return {
    acceptable,
    exact,
    precisionHint,
    generationOk,
    invalidDayCount,
  };
}
