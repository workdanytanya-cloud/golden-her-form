import type { MealScheduleMode, PrimaryMealSlot } from "@/lib/nutrition-constructor/config";
import { MEAL_SCHEDULE_MODES, PRIMARY_MEAL_SLOTS } from "@/lib/nutrition-constructor/config";
import type { ProgramGoal, ProgramLevel } from "@/lib/training";

export type ProgramScope = "nutrition" | "training" | "both";
export type ProgramGenerationStatus = "pending" | "generating" | "ready" | "failed";

export type ProgramReadinessInput = {
  goal: string | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: string | null;
  birthDate: string | null;
  activityLevel: string | null;
  trainingDays: number | null;
};

const GOAL_LABELS: Record<string, string> = {
  weight_loss: "Снижение веса",
  lose_weight: "Снижение веса",
  tone: "Тонус и форма",
  muscle_gain: "Набор мышц",
  rehab: "Восстановление",
  maintain: "Поддержание формы",
};

/** Подпись цели из анкеты или профиля. Пустую строку не заменяет выдуманным значением. */
export function goalLabel(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return GOAL_LABELS[value] ?? value;
}

export function missingProgramFields(input: ProgramReadinessInput, scope: ProgramScope): string[] {
  const missing: string[] = [];
  const nutrition = scope === "nutrition" || scope === "both";
  const training = scope === "training" || scope === "both";
  if (!input.goal?.trim()) missing.push("цель");
  if (nutrition && input.heightCm == null) missing.push("рост");
  if ((nutrition || training) && input.weightKg == null) missing.push("вес");
  if (nutrition && !mapGender(input.gender)) missing.push("пол");
  if (nutrition && !input.birthDate?.trim()) missing.push("дата рождения");
  if ((nutrition || training) && !input.activityLevel?.trim()) missing.push("уровень активности");
  if (training && input.trainingDays == null) missing.push("дни тренировок");
  return missing;
}

export function missingProgramMessage(missing: string[]): string {
  return `Для программы не хватает: ${missing.join(", ")}`;
}

export function mapGender(raw: string | null | undefined): "female" | "male" | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (/(female|woman|^f$|жен)/.test(value)) return "female";
  if (/(male|man|^m$|муж)/.test(value)) return "male";
  return null;
}

export function mapNutritionGoal(raw: string): string {
  return raw.trim();
}

export function mapTrainingGoal(raw: string): ProgramGoal | null {
  const value = raw.toLowerCase();
  if (/(похуд|снижен|жир|weight_loss|lose)/.test(value)) return "weight_loss";
  if (/(набор|мышц|gain|muscle)/.test(value)) return "muscle_gain";
  if (/(реабилит|восстанов|rehab|injur)/.test(value)) return "rehab";
  if (/(тонус|форм|подтян|tone)/.test(value)) return "tone";
  if (/(поддержан|maintain)/.test(value)) return "maintain";
  return null;
}

export function mapTrainingLevel(raw: string): ProgramLevel {
  const value = raw.toLowerCase();
  if (/(high|very_high|advanced)/.test(value)) return "advanced";
  if (/(moderate|medium|intermediate)/.test(value)) return "intermediate";
  if (/(beginner|low)/.test(value)) return "beginner";
  return "beginner";
}

export function mapTrainingDays(days: number): 3 | 4 {
  return days >= 4 ? 4 : 3;
}

export function mapMealSchedule(raw: string | null | undefined): MealScheduleMode {
  const value = raw?.trim();
  if (value && (MEAL_SCHEDULE_MODES as readonly string[]).includes(value)) {
    return value as MealScheduleMode;
  }
  return "three_main_two_snacks";
}

/** Ниже этого остатка углеводов схема «3 основных + 2 перекуса» не собирается в точных КБЖУ. */
export const LOW_CARB_FIVE_MEAL_LIMIT_G = 140;

export function resolveProvisionMealSchedule(input: {
  explicit: boolean;
  storedMode: MealScheduleMode | null;
  carbsG: number;
}): { mode: MealScheduleMode; adjustedForLowCarb: boolean } {
  if (input.explicit && input.storedMode) {
    return { mode: input.storedMode, adjustedForLowCarb: false };
  }
  if (input.carbsG < LOW_CARB_FIVE_MEAL_LIMIT_G) {
    return { mode: "three_mains_only", adjustedForLowCarb: true };
  }
  return { mode: input.storedMode ?? "three_main_two_snacks", adjustedForLowCarb: false };
}

export function mapPrimarySlot(raw: string | null | undefined): PrimaryMealSlot {
  const value = raw?.trim();
  if (value && (PRIMARY_MEAL_SLOTS as readonly string[]).includes(value)) {
    return value as PrimaryMealSlot;
  }
  return "lunch";
}

export type StageDecision = "run" | "skip";

export function decideGenerationStage(input: {
  inScope: boolean;
  status: ProgramGenerationStatus | null;
  draftExists: boolean;
  startedAt: Date | null;
  now: Date;
  staleMs: number;
}): StageDecision {
  if (!input.inScope) return "skip";
  if (input.status === "ready" && input.draftExists) return "skip";
  if (input.status == null && input.draftExists) return "skip";
  if (input.status === "generating" && input.startedAt) {
    const age = input.now.getTime() - input.startedAt.getTime();
    if (age >= 0 && age < input.staleMs) return "skip";
  }
  return "run";
}
