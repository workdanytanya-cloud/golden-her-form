import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MacroBreakdown = {
  kcal: Decimal;
  protein_g: Decimal;
  fat_g: Decimal;
  carbs_g: Decimal;
  fiber_g: Decimal;
};

export type MacroDisplay = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
};

export type MacroSnapshot = {
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
};

export function d(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Итог = значение_на_100г × масса_г / 100 */
export function macroFromPer100(
  per100: {
    kcal: string | number;
    protein: string | number;
    fat: string | number;
    carbs: string | number;
    fiber?: string | number | null;
  },
  grams: string | number,
): MacroBreakdown {
  const g = d(grams);
  const factor = g.div(100);
  return {
    kcal: d(per100.kcal).mul(factor),
    protein_g: d(per100.protein).mul(factor),
    fat_g: d(per100.fat).mul(factor),
    carbs_g: d(per100.carbs).mul(factor),
    fiber_g: d(per100.fiber ?? 0).mul(factor),
  };
}

export function sumMacros(items: MacroBreakdown[]): MacroBreakdown {
  return items.reduce(
    (acc, m) => ({
      kcal: acc.kcal.plus(m.kcal),
      protein_g: acc.protein_g.plus(m.protein_g),
      fat_g: acc.fat_g.plus(m.fat_g),
      carbs_g: acc.carbs_g.plus(m.carbs_g),
      fiber_g: acc.fiber_g.plus(m.fiber_g),
    }),
    {
      kcal: d(0),
      protein_g: d(0),
      fat_g: d(0),
      carbs_g: d(0),
      fiber_g: d(0),
    },
  );
}

export function macroDiff(
  actual: MacroBreakdown,
  target: Pick<MacroBreakdown, "kcal" | "protein_g" | "fat_g" | "carbs_g">,
): MacroBreakdown {
  return {
    kcal: actual.kcal.minus(target.kcal),
    protein_g: actual.protein_g.minus(target.protein_g),
    fat_g: actual.fat_g.minus(target.fat_g),
    carbs_g: actual.carbs_g.minus(target.carbs_g),
    fiber_g: actual.fiber_g,
  };
}

/** Округление только для отображения. */
export function displayMacro(m: MacroBreakdown): MacroDisplay {
  return {
    kcal: m.kcal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    protein_g: m.protein_g.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
    fat_g: m.fat_g.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
    carbs_g: m.carbs_g.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
    fiber_g: m.fiber_g.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
  };
}

export function displayGrams(grams: Decimal | number | string): number {
  return d(grams).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Сохранение в БД — 4 знака после запятой, без UI-округления. */
export function snapshotMacro(m: MacroBreakdown): MacroSnapshot {
  const fmt = (x: Decimal) => x.toFixed(4);
  return {
    kcal: fmt(m.kcal),
    protein_g: fmt(m.protein_g),
    fat_g: fmt(m.fat_g),
    carbs_g: fmt(m.carbs_g),
    fiber_g: fmt(m.fiber_g),
  };
}

export function snapshotFromStrings(s: MacroSnapshot): MacroBreakdown {
  return {
    kcal: d(s.kcal),
    protein_g: d(s.protein_g),
    fat_g: d(s.fat_g),
    carbs_g: d(s.carbs_g),
    fiber_g: d(s.fiber_g),
  };
}

export function withinTolerance(
  actual: MacroBreakdown,
  target: MacroBreakdown,
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number },
): boolean {
  return (
    actual.kcal.minus(target.kcal).abs().lte(tolerance.kcal) &&
    actual.protein_g.minus(target.protein_g).abs().lte(tolerance.protein_g) &&
    actual.fat_g.minus(target.fat_g).abs().lte(tolerance.fat_g) &&
    actual.carbs_g.minus(target.carbs_g).abs().lte(tolerance.carbs_g)
  );
}
