import type { ProgramDay } from "@/lib/training";

export const INSUFFICIENT_EXERCISE_VARIETY = "INSUFFICIENT_EXERCISE_VARIETY";

export const INSUFFICIENT_EXERCISE_VARIETY_MESSAGE =
  "Недостаточно подходящих упражнений для новой программы без повторения предыдущего курса. Добавьте упражнения или разрешите тренеру оставить отдельные базовые движения";

export function mainExerciseIds(day: ProgramDay): string[] {
  return day.exercises.map((exercise) => exercise.exercise_id).filter(Boolean);
}

export function trainingDaySignature(day: ProgramDay): string {
  if (day.is_rest) return `rest:${day.week_index ?? 0}:${day.day_index}`;
  return [...mainExerciseIds(day)].sort().join("|");
}

export function assessTrainingVariety(
  nextDays: ProgramDay[],
  previousDays: ProgramDay[] | null,
): { ok: boolean; duplicateDays: boolean; novelRatio: number } {
  const work = nextDays.filter((day) => !day.is_rest && mainExerciseIds(day).length > 0);
  const byWeek = new Map<number, string[]>();
  for (const day of work) {
    const week = day.week_index ?? 0;
    const list = byWeek.get(week) ?? [];
    list.push(trainingDaySignature(day));
    byWeek.set(week, list);
  }
  const duplicateDays = [...byWeek.values()].some(
    (signatures) => new Set(signatures).size !== signatures.length,
  );
  if (!previousDays || previousDays.length === 0) {
    return { ok: !duplicateDays && work.length > 0, duplicateDays, novelRatio: 1 };
  }
  const previous = new Set(previousDays.flatMap(mainExerciseIds));
  const next = new Set(work.flatMap(mainExerciseIds));
  if (next.size === 0) return { ok: false, duplicateDays, novelRatio: 0 };
  let novel = 0;
  for (const id of next) if (!previous.has(id)) novel += 1;
  const novelRatio = novel / next.size;
  const sameSet = next.size === previous.size && [...next].every((id) => previous.has(id));
  return { ok: !duplicateDays && !sameSet && novelRatio >= 0.7, duplicateDays, novelRatio };
}
