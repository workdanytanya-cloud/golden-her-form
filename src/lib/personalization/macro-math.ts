import type { MacroTargets } from "@/lib/personalization/types";

/** kcal из макросов: 4×белки + 4×углеводы + 9×жиры. */
export function kcalFromMacros(targets: Pick<MacroTargets, "protein_g" | "fat_g" | "carbs_g">): number {
  return targets.protein_g * 4 + targets.carbs_g * 4 + targets.fat_g * 9;
}

/** Согласованность целевых kcal и макросов (допуск ±5%). */
export function validateMacroConsistency(
  targets: MacroTargets,
  tolerancePct = 0.05,
): { ok: boolean; computed_kcal: number; delta_pct: number } {
  const computed = kcalFromMacros(targets);
  const delta = Math.abs(computed - targets.kcal);
  const delta_pct = targets.kcal > 0 ? delta / targets.kcal : 0;
  return { ok: delta_pct <= tolerancePct, computed_kcal: computed, delta_pct };
}

/** Подогнать kcal под макросы (источник истины — P/F/C). */
export function syncKcalToMacros(targets: MacroTargets): MacroTargets {
  return { ...targets, kcal: kcalFromMacros(targets) };
}
