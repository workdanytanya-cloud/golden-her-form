import { clientAvailableEquipmentKeys, exerciseMatchesEquipment } from "@/lib/personalization/equipment-filter";
import { isImpactOrJumpExercise } from "@/lib/training";
import type { ClientProfile, ProgramValidationIssue, ProgramValidationResult } from "@/lib/personalization/types";
import type { Exercise, ProgramDay } from "@/lib/training";

const SECTIONS = ["warmup", "exercises", "cooldown"] as const;

/** Оценка длительности одной тренировки (мин). */
export function estimateSessionMinutes(day: ProgramDay): number {
  if (day.is_rest) return 0;
  let total = 0;
  for (const section of SECTIONS) {
    for (const s of day[section]) {
      total += s.sets * (s.rest_seconds / 60 + 1.5);
    }
  }
  return Math.round(total + 5);
}

export type ValidateProgramOptions = {
  days: ProgramDay[];
  exercises: Exercise[];
  profile: Pick<
    ClientProfile,
    "equipment" | "training_location" | "training_level" | "joint_care" | "session_duration_min"
  >;
  previousWeekVolume?: number | null;
};

/**
 * FINAL VALIDATION — перед сохранением/выдачей программы клиенту.
 * Ошибки блокируют публикацию; предупреждения — review тренером.
 */
export function validateTrainingProgram(opts: ValidateProgramOptions): ProgramValidationResult {
  const issues: ProgramValidationIssue[] = [];
  const exById = new Map(opts.exercises.map((e) => [e.id, e]));
  const available = clientAvailableEquipmentKeys(opts.profile.equipment, opts.profile.training_location);
  const usedIds = new Set<string>();
  let totalSets = 0;

  for (const day of opts.days) {
    if (day.is_rest) continue;
    const mins = estimateSessionMinutes(day);
    if (
      opts.profile.session_duration_min &&
      mins > opts.profile.session_duration_min + 15
    ) {
      issues.push({
        code: "session_too_long",
        severity: "warning",
        message: `${day.title}: ~${mins} мин — больше доступного времени (${opts.profile.session_duration_min} мин).`,
      });
    }

    for (const section of SECTIONS) {
      for (const set of day[section]) {
        usedIds.add(set.exercise_id);
        totalSets += set.sets;

        const ex = exById.get(set.exercise_id);
        if (!ex) {
          issues.push({
            code: "unknown_exercise_id",
            severity: "error",
            message: `Упражнение ${set.exercise_id} не найдено в базе.`,
          });
          continue;
        }

        if (!exerciseMatchesEquipment(ex, available)) {
          issues.push({
            code: "equipment_mismatch",
            severity: "error",
            message: `«${ex.name}» требует инвентарь, которого нет у клиента.`,
          });
        }

        if (opts.profile.joint_care && isImpactOrJumpExercise(ex)) {
          issues.push({
            code: "impact_with_joint_care",
            severity: "error",
            message: `«${ex.name}» — ударная нагрузка при ограничениях суставов.`,
          });
        }

        if (
          opts.profile.training_level === "beginner" &&
          ex.difficulty === "advanced"
        ) {
          issues.push({
            code: "level_too_high",
            severity: "warning",
            message: `«${ex.name}» может быть сложным для новичка.`,
          });
        }
      }
    }
  }

  if (usedIds.size === 0) {
    issues.push({
      code: "empty_program",
      severity: "error",
      message: "Программа не содержит упражнений.",
    });
  }

  if (
    opts.previousWeekVolume != null &&
    opts.previousWeekVolume > 0 &&
    totalSets > opts.previousWeekVolume * 1.25
  ) {
    issues.push({
      code: "volume_spike",
      severity: "warning",
      message: "Объём нагрузки вырос более чем на 25% относительно прошлой недели.",
    });
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, issues };
}

export function collectExerciseIds(days: ProgramDay[]): string[] {
  const ids = new Set<string>();
  for (const day of days) {
    for (const section of SECTIONS) {
      for (const s of day[section]) ids.add(s.exercise_id);
    }
  }
  return [...ids];
}
