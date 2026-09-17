/** Коды исхода генератора рациона (не путать с UI-текстом). */
export type NutritionReasonCode =
  "PASS" | "INVALID_TARGET" | "NO_ALLOWED_PRODUCTS" | "INFEASIBLE" | "TIMEOUT" | "INTERNAL_ERROR";

export type NutritionSearchStage =
  "fast_topn" | "expand_candidates" | "exact_fallback" | "week_tile" | "validation" | "none";

export function reasonFromDiagnostics(input: {
  is_valid: boolean;
  timed_out?: boolean;
  infeasible?: boolean;
  reason_code?: NutritionReasonCode | null;
}): NutritionReasonCode {
  if (input.reason_code) return input.reason_code;
  if (input.is_valid) return "PASS";
  if (input.timed_out) return "TIMEOUT";
  if (input.infeasible) return "INFEASIBLE";
  return "INTERNAL_ERROR";
}

export function userMessageForReason(
  code: NutritionReasonCode,
  detail: string | null | undefined,
): string {
  const suffix = detail ? `: ${detail}` : "";
  switch (code) {
    case "PASS":
      return "Рацион собран в допусках.";
    case "INVALID_TARGET":
      return `Целевые КБЖУ математически противоречивы (INVALID_TARGET)${suffix}`;
    case "NO_ALLOWED_PRODUCTS":
      return `Нет подходящих продуктов после ограничений (NO_ALLOWED_PRODUCTS)${suffix}`;
    case "TIMEOUT":
      return `Поиск не завершён вовремя (TIMEOUT)${suffix}. Повторите генерацию.`;
    case "INFEASIBLE":
      return `Рацион доказанно недостижим (INFEASIBLE)${suffix}`;
    case "INTERNAL_ERROR":
      return `Внутренняя ошибка генератора (INTERNAL_ERROR)${suffix}`;
  }
}
