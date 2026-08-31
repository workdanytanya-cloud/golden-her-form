import Decimal from "decimal.js";
import {
  ACTIVITY_FACTORS,
  ADJUSTMENT_PCT_MAX,
  ADJUSTMENT_PCT_MIN,
  DEFAULT_GOAL_ADJUSTMENT,
  FAT_G_PER_KG,
  MIN_AUTO_AGE,
  PROTEIN_G_PER_KG,
  SAFE_KCAL,
} from "@/lib/nutrition-constructor/config";
import { d, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";

export type GoalKind = "weight_loss" | "maintain" | "muscle_gain";

export type TargetProfileInput = {
  gender?: "female" | "male" | null;
  birth_date?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_level?: string | null;
  goal_primary?: string | null;
  /** Ручная коррекция % (тренер). */
  calorie_adjustment_pct?: number | null;
  /** Ручные целевые значения (если заданы — приоритет). */
  manual_kcal?: number | null;
  manual_protein_g?: number | null;
  manual_fat_g?: number | null;
  manual_carbs_g?: number | null;
};

export type TargetCalculation = {
  bmr: Decimal;
  tdee: Decimal;
  adjustment_pct: number;
  targets: MacroBreakdown;
  protein_g_per_kg: number;
  fat_g_per_kg: number;
};

export type SafetyCheckInput = {
  birth_date?: string | null;
  pregnancy_status?: string | null;
  health_conditions?: string | null;
  has_injuries?: boolean | null;
  breastfeeding?: boolean | null;
  profile_complete: boolean;
};

export type SafetyCheckResult = {
  blocked: boolean;
  reasons: string[];
};

function ageFromBirthDate(birth_date: string | null | undefined): number | null {
  if (!birth_date) return null;
  const ms = Date.now() - new Date(birth_date).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 31557600000);
}

export function inferGoalKind(goal_primary: string | null | undefined): GoalKind {
  const g = (goal_primary ?? "").toLowerCase();
  if (/(похуд|снижен|жир|weight_loss|lose)/.test(g)) return "weight_loss";
  if (/(набор|мышц|gain|muscle)/.test(g)) return "muscle_gain";
  return "maintain";
}

export function activityFactor(level: string | null | undefined): number {
  if (!level) return ACTIVITY_FACTORS.medium;
  const key = level.toLowerCase() as keyof typeof ACTIVITY_FACTORS;
  return ACTIVITY_FACTORS[key] ?? ACTIVITY_FACTORS.medium;
}

/** BMR по Mifflin — St Jeor. */
export function calcBmr(p: TargetProfileInput): Decimal {
  const weight = p.weight_kg && p.weight_kg > 30 ? p.weight_kg : 65;
  const height = p.height_cm && p.height_cm > 120 ? p.height_cm : 165;
  const age = ageFromBirthDate(p.birth_date) ?? 30;
  const gender = p.gender ?? "female";
  const base = d(10).mul(weight).plus(d(6.25).mul(height)).minus(d(5).mul(age));
  return gender === "male" ? base.plus(5) : base.minus(161);
}

export function calcTdee(p: TargetProfileInput): Decimal {
  return calcBmr(p).mul(activityFactor(p.activity_level));
}

export function defaultAdjustmentPct(goal: GoalKind): number {
  return DEFAULT_GOAL_ADJUSTMENT[goal];
}

export function clampAdjustmentPct(pct: number): number {
  return Math.min(ADJUSTMENT_PCT_MAX, Math.max(ADJUSTMENT_PCT_MIN, pct));
}

/** Целевые KBJU с точной арифметикой. */
export function calcMacroTargets(p: TargetProfileInput): TargetCalculation {
  const bmr = calcBmr(p);
  const tdee = calcTdee(p);
  const goal = inferGoalKind(p.goal_primary);
  const adjustment_pct =
    p.calorie_adjustment_pct != null
      ? clampAdjustmentPct(p.calorie_adjustment_pct)
      : defaultAdjustmentPct(goal);

  const weight = p.weight_kg && p.weight_kg > 30 ? p.weight_kg : 65;

  if (
    p.manual_kcal != null &&
    p.manual_protein_g != null &&
    p.manual_fat_g != null &&
    p.manual_carbs_g != null
  ) {
    return {
      bmr,
      tdee,
      adjustment_pct,
      protein_g_per_kg: p.manual_protein_g / weight,
      fat_g_per_kg: p.manual_fat_g / weight,
      targets: {
        kcal: d(p.manual_kcal),
        protein_g: d(p.manual_protein_g),
        fat_g: d(p.manual_fat_g),
        carbs_g: d(p.manual_carbs_g),
        fiber_g: d(0),
      },
    };
  }

  const targetKcalRaw = tdee.mul(d(1).plus(d(adjustment_pct).div(100)));
  const protein_g_per_kg = PROTEIN_G_PER_KG.default;
  const fat_g_per_kg = FAT_G_PER_KG.default;
  const protein_g = d(weight).mul(protein_g_per_kg);
  const fat_g = d(weight).mul(fat_g_per_kg);
  const proteinKcal = protein_g.mul(4);
  const fatKcal = fat_g.mul(9);
  const carbs_g = targetKcalRaw.minus(proteinKcal).minus(fatKcal).div(4);
  const carbsClamped = Decimal.max(d(0), carbs_g);
  const syncedKcal = protein_g.mul(4).plus(carbsClamped.mul(4)).plus(fat_g.mul(9));

  return {
    bmr,
    tdee,
    adjustment_pct,
    protein_g_per_kg,
    fat_g_per_kg,
    targets: {
      kcal: syncedKcal,
      protein_g,
      fat_g,
      carbs_g: carbsClamped,
      fiber_g: d(0),
    },
  };
}

export function checkAutoGenerationSafety(input: SafetyCheckInput): SafetyCheckResult {
  const reasons: string[] = [];
  const age = ageFromBirthDate(input.birth_date);
  if (age != null && age < MIN_AUTO_AGE) {
    reasons.push("Клиент младше 18 лет — требуется проверка тренера.");
  }
  if (!input.profile_complete) {
    reasons.push("Анкета заполнена не полностью.");
  }
  const preg = (input.pregnancy_status ?? "").toLowerCase();
  if (preg && !/нет|no|none|не/i.test(preg)) {
    reasons.push("Указана беременность — автогенерация заблокирована.");
  }
  if (input.breastfeeding) {
    reasons.push("Указано грудное вскармливание — автогенерация заблокирована.");
  }
  const health = (input.health_conditions ?? "").toLowerCase();
  if (
    health &&
    /диабет|почеч|печен|онколог|гастрит|язв|панкреат|целиак|нефрит|гипертон|гипотир|щитовид/i.test(
      health,
    )
  ) {
    reasons.push("Есть медицинские ограничения — требуется проверка тренера.");
  }
  return { blocked: reasons.length > 0, reasons };
}

export function checkTargetSafety(targets: MacroBreakdown): string[] {
  const reasons: string[] = [];
  const kcal = targets.kcal.toNumber();
  if (kcal < SAFE_KCAL.min || kcal > SAFE_KCAL.max) {
    reasons.push(
      `Целевая калорийность ${Math.round(kcal)} ккал вне безопасного диапазона ${SAFE_KCAL.min}–${SAFE_KCAL.max}.`,
    );
  }
  return reasons;
}
