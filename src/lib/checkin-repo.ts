import { startOfWeek, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { saveWeeklyCheckInFn, saveWorkoutFeedbackFn, getWeeklyCheckInFn } from "@/lib/checkin.functions";
import type { AdaptationDecision } from "@/lib/personalization";

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
  const row = await getWeeklyCheckInFn({
    data: { userId, week_start: weekStart },
  });
  return (row as WeeklyCheckInRow | null) ?? null;
}

export async function saveWeeklyCheckIn(input: WeeklyCheckInInput): Promise<{
  row: WeeklyCheckInRow;
  decision: AdaptationDecision;
  explanation: string;
}> {
  // Через server fn + service role: обходим RLS-баг public.has_role в admin-политиках.
  const result = await saveWeeklyCheckInFn({
    data: {
      userId: input.userId,
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
    },
  });
  return {
    row: result.row as WeeklyCheckInRow,
    decision: result.decision,
    explanation: result.explanation,
  };
}

export async function saveWorkoutFeedback(input: WorkoutFeedbackInput): Promise<{
  decision: AdaptationDecision;
  explanation: string;
}> {
  return saveWorkoutFeedbackFn({
    data: {
      userId: input.userId,
      programId: input.programId ?? null,
      weekIndex: input.weekIndex,
      dayIndex: input.dayIndex,
      dayTitle: input.dayTitle ?? null,
      completed_fully: input.completed_fully,
      difficulty_1_10: input.difficulty_1_10,
      pain_reported: input.pain_reported,
      pain_details: input.pain_details ?? null,
      too_easy_exercise_ids: input.too_easy_exercise_ids ?? [],
      too_hard_exercise_ids: input.too_hard_exercise_ids ?? [],
      energy_before_1_10: input.energy_before_1_10 ?? null,
      wellbeing_after_1_10: input.wellbeing_after_1_10 ?? null,
      notes: input.notes ?? null,
    },
  });
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
