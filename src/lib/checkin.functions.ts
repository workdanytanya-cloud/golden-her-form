import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  decideWeeklyAdaptation,
  decideWorkoutProgression,
  explainAdaptation,
  applyWorkoutAdaptation,
  type AdaptationDecision,
} from "@/lib/personalization";
import type { WeeklyCheckIn, WorkoutFeedback } from "@/lib/personalization/types";

const nullableNumber = z.number().finite().nullable().optional();
const nullableInt = z.number().int().nullable().optional();
const scale = z.number().int().min(1).max(10).nullable().optional();

const weeklySchema = z.object({
  userId: z.string().uuid().optional(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  avg_weight_kg: nullableNumber,
  waist_cm: nullableNumber,
  hips_cm: nullableNumber,
  workouts_completed: nullableInt,
  workouts_planned: nullableInt,
  avg_steps: nullableInt,
  hunger_1_10: scale,
  energy_1_10: scale,
  sleep_hours: nullableNumber,
  training_difficulty_1_10: scale,
  nutrition_adherence_pct: z.number().int().min(0).max(100).nullable().optional(),
  pain_reported: z.boolean().default(false),
  what_was_hard: z.string().max(4000).nullable().optional(),
  what_liked: z.string().max(4000).nullable().optional(),
  wants_change: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const workoutFeedbackSchema = z.object({
  userId: z.string().uuid().optional(),
  programId: z.string().uuid().nullable().optional(),
  weekIndex: z.number().int().min(0),
  dayIndex: z.number().int().min(0).max(6),
  dayTitle: z.string().max(200).nullable().optional(),
  completed_fully: z.boolean(),
  difficulty_1_10: z.number().int().min(1).max(10),
  pain_reported: z.boolean(),
  pain_details: z.string().max(2000).nullable().optional(),
  too_easy_exercise_ids: z.array(z.string().uuid()).optional(),
  too_hard_exercise_ids: z.array(z.string().uuid()).optional(),
  energy_before_1_10: scale,
  wellbeing_after_1_10: scale,
  notes: z.string().max(4000).nullable().optional(),
});

async function assertAdmin(ctx: { supabase: { from: Function }; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function resolveTargetUserId(
  context: { userId: string; supabase: { from: Function } },
  requested?: string,
): Promise<string> {
  if (!requested || requested === context.userId) return context.userId;
  await assertAdmin(context);
  return requested;
}

export const getWeeklyCheckInFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid().optional(),
        week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = await resolveTargetUserId(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("weekly_check_ins")
      .select("*")
      .eq("user_id", userId)
      .eq("week_start", data.week_start)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveWeeklyCheckInFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => weeklySchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = await resolveTargetUserId(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const checkIn: WeeklyCheckIn = {
      avg_weight_kg: data.avg_weight_kg ?? null,
      waist_cm: data.waist_cm ?? null,
      workouts_completed: data.workouts_completed ?? 0,
      workouts_planned: data.workouts_planned ?? 0,
      avg_steps: data.avg_steps ?? null,
      hunger_1_10: data.hunger_1_10 ?? null,
      energy_1_10: data.energy_1_10 ?? null,
      sleep_hours: data.sleep_hours ?? null,
      training_difficulty_1_10: data.training_difficulty_1_10 ?? null,
      nutrition_adherence_pct: data.nutrition_adherence_pct ?? null,
      pain_reported: data.pain_reported,
      notes: data.notes ?? null,
    };

    const decision: AdaptationDecision = decideWeeklyAdaptation(checkIn);
    const payload = {
      user_id: userId,
      week_start: data.week_start,
      avg_weight_kg: data.avg_weight_kg ?? null,
      waist_cm: data.waist_cm ?? null,
      hips_cm: data.hips_cm ?? null,
      workouts_completed: data.workouts_completed ?? null,
      workouts_planned: data.workouts_planned ?? null,
      avg_steps: data.avg_steps ?? null,
      hunger_1_10: data.hunger_1_10 ?? null,
      energy_1_10: data.energy_1_10 ?? null,
      sleep_hours: data.sleep_hours ?? null,
      training_difficulty_1_10: data.training_difficulty_1_10 ?? null,
      nutrition_adherence_pct: data.nutrition_adherence_pct ?? null,
      pain_reported: data.pain_reported,
      what_was_hard: data.what_was_hard ?? null,
      what_liked: data.what_liked ?? null,
      wants_change: data.wants_change ?? null,
      notes: data.notes ?? null,
      adaptation_decision: decision,
    };

    const { data: row, error } = await supabaseAdmin
      .from("weekly_check_ins")
      .upsert(payload, { onConflict: "user_id,week_start" })
      .select("*")
      .single();

    if (error) {
      console.error("[checkin] weekly upsert", error);
      throw new Error(error.message || "Не удалось сохранить check-in");
    }

    return {
      row,
      decision,
      explanation: explainAdaptation(decision),
    };
  });

export const saveWorkoutFeedbackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => workoutFeedbackSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = await resolveTargetUserId(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const feedback: WorkoutFeedback = {
      completed_fully: data.completed_fully,
      difficulty_1_10: data.difficulty_1_10,
      pain_reported: data.pain_reported,
      too_easy_exercises: data.too_easy_exercise_ids ?? [],
      too_hard_exercises: data.too_hard_exercise_ids ?? [],
      actual_weights: {},
      actual_reps: {},
      energy_before_1_10: data.energy_before_1_10 ?? null,
      wellbeing_after_1_10: data.wellbeing_after_1_10 ?? null,
    };

    const decision = decideWorkoutProgression(feedback);

    const { error } = await supabaseAdmin.from("workout_feedback").insert({
      user_id: userId,
      program_id: data.programId ?? null,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      day_title: data.dayTitle ?? null,
      completed_fully: data.completed_fully,
      difficulty_1_10: data.difficulty_1_10,
      pain_reported: data.pain_reported,
      pain_details: data.pain_details ?? null,
      too_easy_exercise_ids: data.too_easy_exercise_ids ?? [],
      too_hard_exercise_ids: data.too_hard_exercise_ids ?? [],
      energy_before_1_10: data.energy_before_1_10 ?? null,
      wellbeing_after_1_10: data.wellbeing_after_1_10 ?? null,
      notes: data.notes ?? null,
      adaptation_decision: decision,
    });

    if (error) {
      console.error("[checkin] workout feedback", error);
      throw new Error(error.message || "Не удалось сохранить отзыв о тренировке");
    }

    if (decision === "PROGRESS" || decision === "REDUCE" || decision === "RECOVER") {
      await applyWorkoutAdaptation({
        userId,
        weekIndex: data.weekIndex,
        dayIndex: data.dayIndex,
        decision,
        tooEasyIds: data.too_easy_exercise_ids ?? [],
        tooHardIds: data.too_hard_exercise_ids ?? [],
        db: supabaseAdmin as never,
      });
    }

    return { decision, explanation: explainAdaptation(decision) };
  });
