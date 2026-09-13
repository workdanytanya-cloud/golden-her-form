/**
 * Подбор замен ингредиентов в рационе.
 *
 * Для каждого продукта определяем «доминирующий макро» (белок / жир / углеводы / овощ)
 * и предлагаем продукты из той же группы с пересчитанной граммовкой так, чтобы
 * количество доминирующего макронутриента совпадало.
 */

export type MacroRole = "protein" | "fat" | "carb" | "vegetable" | "other";

export type ProductMacros = {
  id: string;
  name: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
};

export type SwapSuggestion = {
  product: ProductMacros;
  /** Граммовка для замены (чтобы доминирующий макро совпадал). */
  grams: number;
  /** Итоговые ккал при данной граммовке. */
  kcal: number;
  /** Итоговые белки при данной граммовке. */
  protein_g: number;
  /** Итоговые жиры при данной граммовке. */
  fat_g: number;
  /** Итоговые углеводы при данной граммовке. */
  carbs_g: number;
};

/** Определяем «роль» продукта по доминирующему макронутриенту. */
export function macroRole(p: ProductMacros): MacroRole {
  const { protein_per_100g: pr, fat_per_100g: f, carbs_per_100g: c, kcal_per_100g: k } = p;

  // Нулевые макросы — не можем классифицировать
  if (k === 0 && pr === 0 && f === 0 && c === 0) return "other";

  // Овощи: калорийность ≤ 50 ккал/100г и углеводы < 15г
  if (k <= 50 && c < 15 && pr < 5) return "vegetable";

  // По калорийному вкладу каждого макро
  const proteinCal = pr * 4;
  const fatCal = f * 9;
  const carbCal = c * 4;
  const total = proteinCal + fatCal + carbCal;
  if (total === 0) return "other";

  const proteinShare = proteinCal / total;
  const fatShare = fatCal / total;
  const carbShare = carbCal / total;

  if (proteinShare >= 0.4) return "protein";
  if (fatShare >= 0.5) return "fat";
  if (carbShare >= 0.5) return "carb";

  // Смешанный — определяем по максимальной доле
  if (proteinShare >= fatShare && proteinShare >= carbShare) return "protein";
  if (fatShare >= proteinShare && fatShare >= carbShare) return "fat";
  return "carb";
}

/**
 * Подобрать замены для ингредиента.
 *
 * @param sourceProduct - исходный продукт
 * @param sourceGrams - текущая граммовка
 * @param catalog - все доступные продукты
 * @param limit - максимальное количество замен
 */
export function suggestSwaps(
  sourceProduct: ProductMacros,
  sourceGrams: number,
  catalog: ProductMacros[],
  limit = 3,
): SwapSuggestion[] {
  const role = macroRole(sourceProduct);
  if (role === "other") return [];

  // Количество доминирующего макро в исходной порции
  const sourceMacroPer100 = dominantMacroPer100(sourceProduct, role);
  const sourceAmount = (sourceMacroPer100 * sourceGrams) / 100;
  if (sourceAmount <= 0) return [];

  const candidates = catalog
    .filter((p) => {
      if (p.id === sourceProduct.id) return false;
      if (macroRole(p) !== role) return false;
      // Не предлагать продукты с нулевыми макросами
      const dm = dominantMacroPer100(p, role);
      return dm > 0;
    })
    .map((p) => {
      const dm = dominantMacroPer100(p, role);
      const grams = Math.round((sourceAmount / dm) * 100);
      // Ограничиваем разумной порцией
      if (grams < 5 || grams > 800) return null;
      return {
        product: p,
        grams,
        kcal: Math.round((p.kcal_per_100g * grams) / 100),
        protein_g: round1((p.protein_per_100g * grams) / 100),
        fat_g: round1((p.fat_per_100g * grams) / 100),
        carbs_g: round1((p.carbs_per_100g * grams) / 100),
      };
    })
    .filter((s): s is SwapSuggestion => s !== null)
    // Сортируем по близости ккал к исходным
    .sort((a, b) => {
      const sourceKcal = (sourceProduct.kcal_per_100g * sourceGrams) / 100;
      return Math.abs(a.kcal - sourceKcal) - Math.abs(b.kcal - sourceKcal);
    });

  return candidates.slice(0, limit);
}

function dominantMacroPer100(p: ProductMacros, role: MacroRole): number {
  switch (role) {
    case "protein":
      return p.protein_per_100g;
    case "fat":
      return p.fat_per_100g;
    case "carb":
      return p.carbs_per_100g;
    case "vegetable":
      return p.kcal_per_100g; // Для овощей выравниваем по калорийности
    default:
      return 0;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
