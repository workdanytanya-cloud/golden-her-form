import type { MacroComparisonRow } from "@/lib/nutrition-constructor/types";

export type MacroTolerance = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

const TOLERANCE_KEY: Record<string, keyof MacroTolerance> = {
  Калории: "kcal",
  Белки: "protein_g",
  Жиры: "fat_g",
  Углеводы: "carbs_g",
};

/** Короткая фраза для toast/UI: «−8 г белка», «+45 ккал». */
export function formatMacroDeviationPhrase(row: MacroComparisonRow): string {
  const n = Math.abs(Math.round(row.diff));
  const sign = row.diff > 0 ? "+" : "−";
  switch (row.label) {
    case "Калории":
      return `${sign}${n} ккал`;
    case "Белки":
      return `${sign}${n} г белка`;
    case "Жиры":
      return `${sign}${n} г жиров`;
    case "Углеводы":
      return `${sign}${n} г углеводов`;
    default:
      return `${sign}${n}`;
  }
}

export function macroDeviationsOutsideTolerance(
  rows: MacroComparisonRow[],
  tolerance: MacroTolerance,
): MacroComparisonRow[] {
  return rows.filter((row) => {
    const key = TOLERANCE_KEY[row.label];
    if (!key) return false;
    return Math.abs(row.diff) > tolerance[key];
  });
}

export function formatMacroDeviationSummary(
  rows: MacroComparisonRow[],
  tolerance: MacroTolerance,
): string {
  return macroDeviationsOutsideTolerance(rows, tolerance).map(formatMacroDeviationPhrase).join(", ");
}

export function buildPlanValidationMessage(params: {
  comparison: MacroComparisonRow[];
  tolerance: MacroTolerance;
  hasDays: boolean;
  failMessage: string;
  invalidDayCount?: number;
  totalDays?: number;
}): string | null {
  const { comparison, tolerance, hasDays, failMessage, invalidDayCount, totalDays } = params;
  if (!hasDays) return failMessage;

  const summary = formatMacroDeviationSummary(comparison, tolerance);
  if (summary) {
    return `Отклонение от цели (среднее за период): ${summary}. Рацион собран — при необходимости подправьте граммовки.`;
  }

  if (invalidDayCount != null && totalDays != null && invalidDayCount > 0) {
    return `${invalidDayCount} из ${totalDays} дней вне допуска KBJU — проверьте граммовки по отдельным дням.`;
  }

  return "Рацион собран, но не прошёл проверку KBJU. Проверьте граммовки.";
}
