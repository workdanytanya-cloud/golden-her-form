/**
 * Генерация нового 4-недельного блока как продолжение прошлого курса + актуальной анкеты.
 */

import {
  COACH_PROGRAM_WEEKS,
  resolveDefaultTrainingProgram,
  type DefaultProgramPlan,
} from "@/lib/coach-sheet-program";
import type { Exercise, ExerciseSet, ProgramDay, ProgramGoal, ProgramInput, ProgramLevel } from "@/lib/training";

export type PreviousTrainingContext = {
  days: ProgramDay[];
  goal: ProgramGoal;
  level: ProgramLevel;
  sessions_per_week: 3 | 4;
  /** Порядковый номер нового блока (2 = второй курс и т.д.) */
  courseNumber: number;
  sourceCourseTitle?: string | null;
};

const LEVEL_ORDER: ProgramLevel[] = ["beginner", "intermediate", "advanced"];

const GOAL_RU: Record<ProgramGoal, string> = {
  weight_loss: "снижение веса",
  tone: "тонус",
  muscle_gain: "набор мышц",
  rehab: "реабилитация",
  maintain: "поддержание формы",
};

/** После завершённого блока — осторожно повышаем готовность клиента. */
export function advanceLevelForContinuation(
  level: ProgramLevel,
  courseNumber: number,
): ProgramLevel {
  if (courseNumber <= 1) return level;
  if (courseNumber >= 2 && level === "beginner") return "intermediate";
  if (courseNumber >= 3 && level === "intermediate") return "advanced";
  return level;
}

export function mergeProgramInputWithQuestionnaire(
  input: ProgramInput,
  previous: PreviousTrainingContext | null,
): ProgramInput {
  if (!previous) return input;
  return {
    ...input,
    goal: input.goal ?? previous.goal,
    level: advanceLevelForContinuation(input.level, previous.courseNumber),
    sessions_per_week: input.sessions_per_week ?? previous.sessions_per_week,
  };
}

function parseRepsRange(reps: string): { min: number; max: number } {
  const range = reps.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = reps.match(/(\d+)/);
  const n = single ? Number(single[1]) : 10;
  return { min: n, max: n };
}

function formatReps(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

/** Пик нагрузки прошлого блока (неделя 4, основная часть). */
export function peakSetsByExerciseId(days: ProgramDay[]): Map<string, { sets: number; reps: string }> {
  const peak = new Map<string, { sets: number; reps: string }>();
  const lastWeek = COACH_PROGRAM_WEEKS - 1;

  const consider = (day: ProgramDay) => {
    if (day.is_rest) return;
    for (const set of day.exercises) {
      const cur = peak.get(set.exercise_id);
      if (!cur || set.sets > cur.sets) {
        peak.set(set.exercise_id, { sets: set.sets, reps: set.reps });
      }
    }
  };

  for (const day of days) {
    if ((day.week_index ?? 0) === lastWeek) consider(day);
  }
  if (peak.size === 0) {
    for (const day of days) consider(day);
  }
  return peak;
}

/** Прогрессия нового блока от пика прошлого: разгрузка → объём → +подход → пик. */
const CONTINUATION_WEEK_MODIFIERS = [
  { setDelta: -1, repDelta: 0, phase: "вход в блок (разгрузка от пика прошлого курса)" },
  { setDelta: 0, repDelta: 1, phase: "объём — возврат к рабочим весам" },
  { setDelta: 1, repDelta: 0, phase: "прогрессия — больше подходов" },
  { setDelta: 1, repDelta: 1, phase: "пик нового 4-недельного блока" },
] as const;

function applySetContinuation(
  set: ExerciseSet,
  weekIndex: number,
  peak: Map<string, { sets: number; reps: string }>,
): ExerciseSet {
  const mod = CONTINUATION_WEEK_MODIFIERS[weekIndex] ?? CONTINUATION_WEEK_MODIFIERS[0];
  const base = peak.get(set.exercise_id);
  let sets = base?.sets ?? set.sets;
  const repsRange = parseRepsRange(base?.reps ?? set.reps);

  sets = Math.max(2, Math.min(6, sets + mod.setDelta));
  const newMax = Math.min(20, repsRange.max + mod.repDelta);
  const newMin = Math.max(4, Math.min(repsRange.min, newMax - 2));
  const reps = formatReps(newMin, newMax);

  const noteParts = [set.note, mod.phase].filter(Boolean);
  return { ...set, sets, reps, note: noteParts.join(" · ") };
}

export function applyContinuationProgression(
  days: ProgramDay[],
  previousDays: ProgramDay[],
): ProgramDay[] {
  const peak = peakSetsByExerciseId(previousDays);
  return days.map((day) => {
    const week = day.week_index ?? 0;
    if (day.is_rest) return day;
    const mod = CONTINUATION_WEEK_MODIFIERS[week] ?? CONTINUATION_WEEK_MODIFIERS[0];
    return {
      ...day,
      day_note: [`Курс-продолжение · ${mod.phase}`, day.day_note].filter(Boolean).join(". "),
      exercises: day.exercises.map((s) => applySetContinuation(s, week, peak)),
    };
  });
}

export function continuationCoachNotes(
  input: ProgramInput,
  previous: PreviousTrainingContext,
): string {
  const titleBit = previous.sourceCourseTitle ? ` «${previous.sourceCourseTitle}»` : "";
  return [
    `Блок ${previous.courseNumber} — продолжение${titleBit} с прогрессией от пика прошлого курса.`,
    `Анкета: цель «${GOAL_RU[input.goal]}», уровень «${input.level}», ${input.sessions_per_week} трен./нед.`,
    input.has_injuries
      ? "Ограничения и травмы из актуальной анкеты учтены (без ударных/рискованных паттернов)."
      : "Нагрузка: разгрузка → рабочий объём → +подходы → пик. Техника важнее веса.",
    "Тренер может скорректировать веса и замены перед публикацией клиенту.",
  ].join("\n");
}

/**
 * Новый 4-недельный блок: анкета + (если есть) прошлый курс с нарастающей прогрессией.
 */
export function buildContinuationTrainingProgram(
  exercises: Exercise[],
  input: ProgramInput,
  previous: PreviousTrainingContext | null,
): DefaultProgramPlan {
  const merged = mergeProgramInputWithQuestionnaire(input, previous);
  const base = resolveDefaultTrainingProgram(exercises, merged);

  if (!previous || previous.days.length === 0) {
    return base;
  }

  return {
    ...base,
    days: applyContinuationProgression(base.days, previous.days),
    coachNotes: continuationCoachNotes(merged, previous),
  };
}
