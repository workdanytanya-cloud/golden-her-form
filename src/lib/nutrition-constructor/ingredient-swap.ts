/**
 * Подбор замен ингредиентов в рационе.
 * Замена только внутри той же кулинарной роли и того же состояния (сырой/готовый).
 * Граммы и КБЖУ считаются через Decimal. Похожей калорийности другой роли недостаточно.
 */
import Decimal from "decimal.js";

export type MacroRole = "protein" | "fat" | "carb" | "vegetable" | "other";

export type ProductMacros = {
  id: string;
  name: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  category?: string;
  state?: string;
  verified?: boolean;
  autogen?: boolean;
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
  const sourceAmount = sourceMacroPer100.mul(sourceGrams).div(100);
  if (sourceAmount.lte(0)) return [];

  const candidates = catalog
    .filter((p) => {
      if (p.id === sourceProduct.id) return false;
      if (p.verified === false || p.autogen === false) return false;
      if (macroRole(p) !== role) return false;
      if (sourceProduct.category && p.category && p.category !== sourceProduct.category)
        return false;
      if (sourceProduct.state && p.state && p.state !== sourceProduct.state) return false;
      const dm = dominantMacroPer100(p, role);
      return dm.gt(0);
    })
    .map((p) => {
      const dm = dominantMacroPer100(p, role);
      const grams = sourceAmount.div(dm).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      if (grams.lt(5) || grams.gt(800)) return null;
      const portion = grams.div(100);
      return {
        product: p,
        grams: grams.toNumber(),
        kcal: new Decimal(p.kcal_per_100g).mul(portion).toDecimalPlaces(1).toNumber(),
        protein_g: new Decimal(p.protein_per_100g).mul(portion).toDecimalPlaces(1).toNumber(),
        fat_g: new Decimal(p.fat_per_100g).mul(portion).toDecimalPlaces(1).toNumber(),
        carbs_g: new Decimal(p.carbs_per_100g).mul(portion).toDecimalPlaces(1).toNumber(),
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

function dominantMacroPer100(p: ProductMacros, role: MacroRole): Decimal {
  switch (role) {
    case "protein":
      return new Decimal(p.protein_per_100g);
    case "fat":
      return new Decimal(p.fat_per_100g);
    case "carb":
      return new Decimal(p.carbs_per_100g);
    case "vegetable":
      return new Decimal(p.kcal_per_100g);
    default:
      return new Decimal(0);
  }
}

export function swapMovesBeyondTolerance(
  before: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  },
  after: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  },
): boolean {
  const kcal = new Decimal(after.kcal).minus(before.kcal).abs();
  const protein = new Decimal(after.protein_g).minus(before.protein_g).abs();
  const fat = new Decimal(after.fat_g).minus(before.fat_g).abs();
  const carbs = new Decimal(after.carbs_g).minus(before.carbs_g).abs();
  return kcal.gt(5) || protein.gt(1) || fat.gt(1) || carbs.gt(1);
}
