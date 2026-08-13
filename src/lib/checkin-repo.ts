import { startOfWeek, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  decideWeeklyAdaptation,
  decideWorkoutProgression,
  explainAdaptation,
  applyWorkoutAdaptation,
  type AdaptationDecision,
} from "@/lib/personalization";
import type { WeeklyCheckIn, WorkoutFeedback } from "@/lib/personalization/types";

export type WeeklyCheckInRow = {
  id: string;
  user_id: string;
  week_start: string;
  avg_weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  workouts_completed: number | null;
  workouts_planned: number | null;
  avg_steps: number | null;
  hunger_1_10: number | null;
  energy_1_10: number | null;
  sleep_hours: number | null;
  training_difficulty_1_10: number | null;
  nutrition_adherence_pct: number | null;
  pain_reported: boolean;
  what_was_hard: string | null;
  what_liked: string | null;
  wants_change: string | null;
  adaptation_decision: string | null;
  notes: string | null;
  created_at: string;
};

export type WorkoutFeedbackInput = {
  userId: string;
  programId?: string | null;
  weekIndex: number;
  dayIndex: number;
  dayTitle?: string | null;
  completed_fully: boolean;
  difficulty_1_10: number;
  pain_reported: boolean;
  pain_details?: string | null;
  too_easy_exercise_ids?: string[];
  too_hard_exercise_ids?: string[];
  energy_before_1_10?: number | null;
  wellbeing_after_1_10?: number | null;
  notes?: string | null;
};

export type WeeklyCheckInInput = Omit<
  WeeklyCheckInRow,
  "id" | "user_id" | "created_at" | "adaptation_decision"
> & {
  userId: string;
};

/** Понедельник текущей недели (ISO date). */
export function currentWeekStart(date = new Date()): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export async function getWeeklyCheckIn(
  userId: string,
  weekStart = currentWeekStart(),
): Promise<WeeklyCheckInRow | null> {
  const { data, error } = await supabase
    .from("weekly_check_ins")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data as WeeklyCheckInRow | null;
}

export async function saveWeeklyCheckIn(input: WeeklyCheckInInput): Promise<{
  row: WeeklyCheckInRow;
  decision: AdaptationDecision;
  explanation: string;
}> {
  const checkIn: WeeklyCheckIn = {
    avg_weight_kg: input.avg_weight_kg,
    waist_cm: input.waist_cm,
    workouts_completed: input.workouts_completed ?? 0,
    workouts_planned: input.workouts_planned ?? 0,
    avg_steps: input.avg_steps,
    hunger_1_10: input.hunger_1_10,
    energy_1_10: input.energy_1_10,
    sleep_hours: input.sleep_hours,
    training_difficulty_1_10: input.training_difficulty_1_10,
    nutrition_adherence_pct: input.nutrition_adherence_pct,
    pain_reported: input.pain_reported,
    notes: input.notes,
  };

  const decision = decideWeeklyAdaptation(checkIn);
  const payload = {
    user_id: input.userId,
    week_start: input.week_start,
    avg_weight_kg: input.avg_weight_kg,
    waist_cm: input.waist_cm,
    hips_cm: input.hips_cm,
    workouts_completed: input.workouts_completed,
    workouts_planned: input.workouts_planned,
    avg_steps: input.avg_steps,
    hunger_1_10: input.hunger_1_10,
    energy_1_10: input.energy_1_10,
    sleep_hours: input.sleep_hours,
    training_difficulty_1_10: input.training_difficulty_1_10,
    nutrition_adherence_pct: input.nutrition_adherence_pct,
    pain_reported: input.pain_reported,
    what_was_hard: input.what_was_hard,
    what_liked: input.what_liked,
    wants_change: input.wants_change,
    notes: input.notes,
    adaptation_decision: decision,
  };

  const { data, error } = await supabase
    .from("weekly_check_ins")
    .upsert(payload, { onConflict: "user_id,week_start" })
    .select("*")
    .single();
  if (error) throw error;

  return {
    row: data as WeeklyCheckInRow,
    decision,
    explanation: explainAdaptation(decision),
  };
}

export async function saveWorkoutFeedback(input: WorkoutFeedbackInput): Promise<{
  decision: AdaptationDecision;
  explanation: string;
}> {
  const feedback: WorkoutFeedback = {
    completed_fully: input.completed_fully,
    difficulty_1_10: input.difficulty_1_10,
    pain_reported: input.pain_reported,
    too_easy_exercises: input.too_easy_exercise_ids ?? [],
    too_hard_exercises: input.too_hard_exercise_ids ?? [],
    actual_weights: {},
    actual_reps: {},
    energy_before_1_10: input.energy_before_1_10 ?? null,
    wellbeing_after_1_10: input.wellbeing_after_1_10 ?? null,
  };

  const decision = decideWorkoutProgression(feedback);

  const { error } = await supabase.from("workout_feedback").insert({
    user_id: input.userId,
    program_id: input.programId ?? null,
    week_index: input.weekIndex,
    day_index: input.dayIndex,
    day_title: input.dayTitle ?? null,
    completed_fully: input.completed_fully,
    difficulty_1_10: input.difficulty_1_10,
    pain_reported: input.pain_reported,
    pain_details: input.pain_details ?? null,
    too_easy_exercise_ids: input.too_easy_exercise_ids ?? [],
    too_hard_exercise_ids: input.too_hard_exercise_ids ?? [],
    energy_before_1_10: input.energy_before_1_10 ?? null,
    wellbeing_after_1_10: input.wellbeing_after_1_10 ?? null,
    notes: input.notes ?? null,
    adaptation_decision: decision,
  });
  if (error) throw error;

  if (decision === "PROGRESS" || decision === "REDUCE" || decision === "RECOVER") {
    await applyWorkoutAdaptation({
      userId: input.userId,
      weekIndex: input.weekIndex,
      dayIndex: input.dayIndex,
      decision,
      tooEasyIds: input.too_easy_exercise_ids ?? [],
      tooHardIds: input.too_hard_exercise_ids ?? [],
    });
  }

  return { decision, explanation: explainAdaptation(decision) };
}

/** Сколько тренировочных (не rest) дней в программе на неделю. */
export function countPlannedWorkouts(
  days: Array<{ week_index?: number; is_rest: boolean }>,
  weekIndex = 0,
): number {
  return days.filter((d) => !d.is_rest && Number(d.week_index ?? 0) === weekIndex).length;
}

/** Сколько feedback записей за текущую календарную неделю. */
export async function countWorkoutsCompletedThisWeek(userId: string): Promise<number> {
  const weekStart = currentWeekStart();
  const { count, error } = await supabase
    .from("workout_feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", `${weekStart}T00:00:00`);
  if (error) throw error;
  return count ?? 0;
}
