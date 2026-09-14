import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  decideWeeklyAdaptation,
  explainAdaptation,
  type AdaptationDecision,
} from "@/lib/personalization";
import type { WeeklyCheckIn } from "@/lib/personalization/types";
import { withTransaction } from "@/lib/selfhost/db";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

const nullableNumber = z.number().finite().nullable().optional();
const nullableInt = z.number().int().nullable().optional();
const scale = z.number().int().min(1).max(10).nullable().optional();

export const weeklyCheckInSaveSchema = z.object({
  clientId: z.string().uuid(),
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

export type WeeklyCheckInRowPg = {
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

function mapRow(row: Record<string, unknown>): WeeklyCheckInRowPg {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    week_start: String(row.week_start).slice(0, 10),
    avg_weight_kg: num(row.avg_weight_kg),
    waist_cm: num(row.waist_cm),
    hips_cm: num(row.hips_cm),
    workouts_completed: num(row.workouts_completed),
    workouts_planned: num(row.workouts_planned),
    avg_steps: num(row.avg_steps),
    hunger_1_10: num(row.hunger_1_10),
    energy_1_10: num(row.energy_1_10),
    sleep_hours: num(row.sleep_hours),
    training_difficulty_1_10: num(row.training_difficulty_1_10),
    nutrition_adherence_pct: num(row.nutrition_adherence_pct),
    pain_reported: Boolean(row.pain_reported),
    what_was_hard: (row.what_was_hard as string | null) ?? null,
    what_liked: (row.what_liked as string | null) ?? null,
    wants_change: (row.wants_change as string | null) ?? null,
    adaptation_decision: (row.adaptation_decision as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function getWeeklyCheckInPg(
  db: Queryable,
  userId: string,
  weekStart: string,
): Promise<WeeklyCheckInRowPg | null> {
  const { rows } = await db.query(
    `SELECT * FROM public.weekly_check_ins WHERE user_id = $1 AND week_start = $2::date`,
    [userId, weekStart],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function saveWeeklyCheckInPg(
  db: Queryable,
  input: z.infer<typeof weeklyCheckInSaveSchema>,
): Promise<{ row: WeeklyCheckInRowPg; decision: AdaptationDecision; explanation: string }> {
  const data = weeklyCheckInSaveSchema.parse(input);
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
  const decision = decideWeeklyAdaptation(checkIn);

  const run = async (client: PoolClient) => {
    const { rows } = await client.query(
      `INSERT INTO public.weekly_check_ins (
         user_id, week_start, avg_weight_kg, waist_cm, hips_cm, workouts_completed,
         workouts_planned, avg_steps, hunger_1_10, energy_1_10, sleep_hours,
         training_difficulty_1_10, nutrition_adherence_pct, pain_reported,
         what_was_hard, what_liked, wants_change, notes, adaptation_decision, updated_at
       ) VALUES (
         $1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         (now() AT TIME ZONE 'utc')
       )
       ON CONFLICT (user_id, week_start) DO UPDATE SET
         avg_weight_kg = EXCLUDED.avg_weight_kg,
         waist_cm = EXCLUDED.waist_cm,
         hips_cm = EXCLUDED.hips_cm,
         workouts_completed = EXCLUDED.workouts_completed,
         workouts_planned = EXCLUDED.workouts_planned,
         avg_steps = EXCLUDED.avg_steps,
         hunger_1_10 = EXCLUDED.hunger_1_10,
         energy_1_10 = EXCLUDED.energy_1_10,
         sleep_hours = EXCLUDED.sleep_hours,
         training_difficulty_1_10 = EXCLUDED.training_difficulty_1_10,
         nutrition_adherence_pct = EXCLUDED.nutrition_adherence_pct,
         pain_reported = EXCLUDED.pain_reported,
         what_was_hard = EXCLUDED.what_was_hard,
         what_liked = EXCLUDED.what_liked,
         wants_change = EXCLUDED.wants_change,
         notes = EXCLUDED.notes,
         adaptation_decision = EXCLUDED.adaptation_decision,
         updated_at = (now() AT TIME ZONE 'utc')
       RETURNING *`,
      [
        data.clientId,
        data.week_start,
        data.avg_weight_kg ?? null,
        data.waist_cm ?? null,
        data.hips_cm ?? null,
        data.workouts_completed ?? null,
        data.workouts_planned ?? null,
        data.avg_steps ?? null,
        data.hunger_1_10 ?? null,
        data.energy_1_10 ?? null,
        data.sleep_hours ?? null,
        data.training_difficulty_1_10 ?? null,
        data.nutrition_adherence_pct ?? null,
        data.pain_reported,
        data.what_was_hard ?? null,
        data.what_liked ?? null,
        data.wants_change ?? null,
        data.notes ?? null,
        decision,
      ],
    );
    return {
      row: mapRow(rows[0] as Record<string, unknown>),
      decision,
      explanation: explainAdaptation(decision),
    };
  };

  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}

export async function countWorkoutsCompletedThisWeekPg(
  db: Queryable,
  userId: string,
  weekStart: string,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM public.workout_feedback
      WHERE user_id = $1 AND created_at >= ($2::date)::timestamptz`,
    [userId, weekStart],
  );
  return Number((rows[0] as { n: number }).n ?? 0);
}
