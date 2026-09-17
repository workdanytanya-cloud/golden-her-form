import { d, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";

/** Допуск согласованности kcal ↔ БЖУ (только округление, не пересчёт). */
export const TARGET_KCAL_IDENTITY_TOLERANCE = 5;

export function macroEnergyKcal(targets: Pick<MacroBreakdown, "protein_g" | "fat_g" | "carbs_g">) {
  return targets.protein_g.mul(4).plus(targets.fat_g.mul(9)).plus(targets.carbs_g.mul(4));
}

export function validateMacroTargets(targets: MacroBreakdown): {
  ok: boolean;
  detail: string | null;
  energy_kcal: number;
} {
  const p = targets.protein_g.toNumber();
  const f = targets.fat_g.toNumber();
  const c = targets.carbs_g.toNumber();
  const k = targets.kcal.toNumber();
  if (![p, f, c, k].every((x) => Number.isFinite(x))) {
    return { ok: false, detail: "NaN/нечисловые макросы", energy_kcal: NaN };
  }
  if (p < 0 || f < 0 || c < 0 || k <= 0) {
    return { ok: false, detail: "отрицательные или нулевые цели", energy_kcal: NaN };
  }
  const energy = macroEnergyKcal(targets);
  const energyN = energy.toNumber();
  const diff = Math.abs(energyN - k);
  if (diff > TARGET_KCAL_IDENTITY_TOLERANCE) {
    return {
      ok: false,
      detail: `P×4+F×9+C×4=${energyN.toFixed(1)} ≠ kcal=${k} (Δ${diff.toFixed(1)})`,
      energy_kcal: energyN,
    };
  }
  return { ok: true, detail: null, energy_kcal: energyN };
}

/** Согласованные цели для матрицы/fuzz: энергия совпадает с kcal. */
export function consistentTargetsForKcal(kcal: number): MacroBreakdown {
  if (kcal === 1313) {
    return {
      kcal: d(1313),
      protein_g: d(112.1),
      fat_g: d(56.1),
      carbs_g: d(89.9),
      fiber_g: d(0),
    };
  }
  if (kcal === 1726) {
    return {
      kcal: d(1726),
      protein_g: d(99),
      fat_g: d(49.5),
      carbs_g: d(221.2),
      fiber_g: d(0),
    };
  }
  if (kcal === 1800) {
    return {
      kcal: d(1800),
      protein_g: d(135),
      fat_g: d(60),
      carbs_g: d(180),
      fiber_g: d(0),
    };
  }
  // ~25% белок / ~25% жир / остаток углеводы; десятые доли.
  const protein = Math.round(((kcal * 0.25) / 4) * 10) / 10;
  const fat = Math.round(((kcal * 0.25) / 9) * 10) / 10;
  const carbs = Math.round(((kcal - protein * 4 - fat * 9) / 4) * 10) / 10;
  return {
    kcal: d(kcal),
    protein_g: d(protein),
    fat_g: d(fat),
    carbs_g: d(carbs),
    fiber_g: d(0),
  };
}

/** Детерминированный PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
