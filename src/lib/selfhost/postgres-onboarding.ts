import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { normalizeStoredAge } from "@/lib/client-age";
import { mapGender } from "@/lib/client-courses/program-readiness";
import { withTransaction } from "@/lib/selfhost/db";
import { createMeasurementPg } from "@/lib/selfhost/postgres-measurements";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

const nullableStr = z.string().max(8000).nullable().optional();
const nullableInt = z.number().int().nullable().optional();
const nullableNum = z.number().finite().nullable().optional();

export const onboardingSaveSchema = z.object({
  clientId: z.string().uuid(),
  asCompleted: z.boolean().optional().default(false),
  height_cm: z.number().int().min(120).max(230).nullable().optional(),
  weight_kg: z.number().finite().min(30).max(250).nullable().optional(),
  age_years: z.number().int().min(14).max(100).nullable().optional(),
  gender: z.enum(["female", "male"]).nullable().optional(),
  weightIdempotencyKey: z.string().min(8).max(200).nullable().optional(),
  payload: z.object({
    goal_primary: nullableStr,
    goal_details: nullableStr,
    experience: nullableStr,
    training_days_per_week: nullableInt,
    session_duration_min: nullableInt,
    training_location: nullableStr,
    equipment: z.array(z.string().max(80)).optional().default([]),
    focus_areas: z.array(z.string().max(80)).optional().default([]),
    has_injuries: z.boolean().optional().default(false),
    injuries_details: nullableStr,
    health_conditions: nullableStr,
    medications: nullableStr,
    pregnancy_status: nullableStr,
    sleep_hours: nullableNum,
    stress_level: nullableInt,
    energy_level: nullableInt,
    water_liters: nullableNum,
    diet_type: nullableStr,
    allergies: nullableStr,
    meals_per_day: nullableInt,
    favorite_foods: nullableStr,
    disliked_foods: nullableStr,
    alcohol_frequency: nullableStr,
    smoking: z.boolean().optional().default(false),
    activity_level: nullableStr,
    job_type: nullableStr,
    motivation: nullableStr,
    previous_experience: nullableStr,
    timeframe: nullableStr,
    expectations: nullableStr,
    extra: z.record(z.string(), z.unknown()).optional().default({}),
  }),
});

export async function loadOnboardingPg(
  db: Queryable,
  userId: string,
): Promise<{
  onboarding: Record<string, unknown> | null;
  height_cm: number | null;
  weight_kg: number | null;
  age_years: number | null;
  gender: "female" | "male" | null;
}> {
  const onb = await db.query(`SELECT * FROM public.onboarding_responses WHERE user_id = $1`, [
    userId,
  ]);
  const profile = await db.query(
    `SELECT height_cm, age_years, gender FROM public.profiles WHERE id = $1`,
    [userId],
  );
  const weight = await db.query(
    `SELECT weight_kg FROM public.measurements
      WHERE user_id = $1 AND weight_kg IS NOT NULL
      ORDER BY measured_on DESC, created_at DESC LIMIT 1`,
    [userId],
  );
  const profileRow = profile.rows[0] as
    | { height_cm?: number | null; age_years?: number | null; gender?: string | null }
    | undefined;
  return {
    onboarding: (onb.rows[0] as Record<string, unknown> | undefined) ?? null,
    height_cm: profileRow?.height_cm == null ? null : Number(profileRow.height_cm),
    age_years: normalizeStoredAge(profileRow?.age_years),
    gender: mapGender(profileRow?.gender ?? null),
    weight_kg:
      (weight.rows[0] as { weight_kg?: number | string } | undefined)?.weight_kg == null
        ? null
        : Number((weight.rows[0] as { weight_kg: number | string }).weight_kg),
  };
}

export function missingCompletedBody(input: {
  age_years?: number | null;
  gender?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
}): string[] {
  const missing: string[] = [];
  if (normalizeStoredAge(input.age_years) == null) missing.push("возраст, полных лет");
  if (!mapGender(input.gender)) missing.push("пол");
  if (input.height_cm == null) missing.push("рост, см");
  if (input.weight_kg == null) missing.push("вес, кг");
  return missing;
}

export async function saveOnboardingPg(
  db: Queryable,
  input: z.infer<typeof onboardingSaveSchema>,
): Promise<{
  onboarding: Record<string, unknown>;
  accessStatus: string | null;
  measurementId: string | null;
  /** Автогенерация draft программ после анкеты в selfhost ещё не портирована. */
  autogenSkipped: true;
}> {
  const data = onboardingSaveSchema.parse(input);
  if (data.asCompleted) {
    const missing = missingCompletedBody(data);
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Чтобы отправить анкету, заполните: ${missing.join(", ")}.`),
        { statusCode: 400 },
      );
    }
  }
  const p = data.payload;

  const run = async (client: PoolClient) => {
    await client.query(`INSERT INTO public.profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
      data.clientId,
    ]);
    if (
      data.height_cm !== undefined ||
      data.age_years !== undefined ||
      data.gender !== undefined
    ) {
      await client.query(
        `UPDATE public.profiles SET
           height_cm = CASE WHEN $2::boolean THEN $3 ELSE height_cm END,
           age_years = CASE WHEN $4::boolean THEN $5 ELSE age_years END,
           gender = CASE WHEN $6::boolean THEN $7 ELSE gender END,
           birth_date = NULL,
           updated_at = (now() AT TIME ZONE 'utc')
         WHERE id = $1`,
        [
          data.clientId,
          data.height_cm !== undefined,
          data.height_cm ?? null,
          data.age_years !== undefined,
          data.age_years ?? null,
          data.gender !== undefined,
          data.gender ?? null,
        ],
      );
    }

    let measurementId: string | null = null;
    if (data.weight_kg != null) {
      const created = await createMeasurementPg(client, {
        clientId: data.clientId,
        measured_on: new Date().toISOString().slice(0, 10),
        weight_kg: data.weight_kg,
        waist_cm: null,
        hips_cm: null,
        chest_cm: null,
        note: "Из анкеты",
        idempotencyKey: data.weightIdempotencyKey ?? null,
      });
      measurementId = created.measurement.id;
    }

    const upserted = await client.query(
      `INSERT INTO public.onboarding_responses (
         user_id, goal_primary, goal_details, experience, training_days_per_week,
         session_duration_min, training_location, equipment, focus_areas, has_injuries,
         injuries_details, health_conditions, medications, pregnancy_status, sleep_hours,
         stress_level, energy_level, water_liters, diet_type, allergies, meals_per_day,
         favorite_foods, disliked_foods, alcohol_frequency, smoking, activity_level,
         job_type, motivation, previous_experience, timeframe, expectations, extra,
         completed_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb,
         CASE WHEN $33::boolean THEN (now() AT TIME ZONE 'utc') ELSE NULL END,
         (now() AT TIME ZONE 'utc')
       )
       ON CONFLICT (user_id) DO UPDATE SET
         goal_primary = EXCLUDED.goal_primary,
         goal_details = EXCLUDED.goal_details,
         experience = EXCLUDED.experience,
         training_days_per_week = EXCLUDED.training_days_per_week,
         session_duration_min = EXCLUDED.session_duration_min,
         training_location = EXCLUDED.training_location,
         equipment = EXCLUDED.equipment,
         focus_areas = EXCLUDED.focus_areas,
         has_injuries = EXCLUDED.has_injuries,
         injuries_details = EXCLUDED.injuries_details,
         health_conditions = EXCLUDED.health_conditions,
         medications = EXCLUDED.medications,
         pregnancy_status = EXCLUDED.pregnancy_status,
         sleep_hours = EXCLUDED.sleep_hours,
         stress_level = EXCLUDED.stress_level,
         energy_level = EXCLUDED.energy_level,
         water_liters = EXCLUDED.water_liters,
         diet_type = EXCLUDED.diet_type,
         allergies = EXCLUDED.allergies,
         meals_per_day = EXCLUDED.meals_per_day,
         favorite_foods = EXCLUDED.favorite_foods,
         disliked_foods = EXCLUDED.disliked_foods,
         alcohol_frequency = EXCLUDED.alcohol_frequency,
         smoking = EXCLUDED.smoking,
         activity_level = EXCLUDED.activity_level,
         job_type = EXCLUDED.job_type,
         motivation = EXCLUDED.motivation,
         previous_experience = EXCLUDED.previous_experience,
         timeframe = EXCLUDED.timeframe,
         expectations = EXCLUDED.expectations,
         extra = EXCLUDED.extra,
         completed_at = CASE
           WHEN $33::boolean THEN COALESCE(public.onboarding_responses.completed_at, (now() AT TIME ZONE 'utc'))
           ELSE public.onboarding_responses.completed_at
         END,
         updated_at = (now() AT TIME ZONE 'utc')
       RETURNING *`,
      [
        data.clientId,
        p.goal_primary ?? null,
        p.goal_details ?? null,
        p.experience ?? null,
        p.training_days_per_week ?? null,
        p.session_duration_min ?? null,
        p.training_location ?? null,
        p.equipment ?? [],
        p.focus_areas ?? [],
        p.has_injuries ?? false,
        p.injuries_details ?? null,
        p.health_conditions ?? null,
        p.medications ?? null,
        p.pregnancy_status ?? null,
        p.sleep_hours ?? null,
        p.stress_level ?? null,
        p.energy_level ?? null,
        p.water_liters ?? null,
        p.diet_type ?? null,
        p.allergies ?? null,
        p.meals_per_day ?? null,
        p.favorite_foods ?? null,
        p.disliked_foods ?? null,
        p.alcohol_frequency ?? null,
        p.smoking ?? false,
        p.activity_level ?? null,
        p.job_type ?? null,
        p.motivation ?? null,
        p.previous_experience ?? null,
        p.timeframe ?? null,
        p.expectations ?? null,
        JSON.stringify(p.extra ?? {}),
        data.asCompleted,
      ],
    );

    if (data.asCompleted) {
      await client.query(
        `INSERT INTO public.client_access (user_id, status, updated_at)
         VALUES ($1, 'pending_onboarding', (now() AT TIME ZONE 'utc'))
         ON CONFLICT (user_id) DO NOTHING`,
        [data.clientId],
      );
      await client.query(
        `UPDATE public.client_access
            SET status = 'awaiting_approval', updated_at = (now() AT TIME ZONE 'utc')
          WHERE user_id = $1 AND status = 'pending_onboarding'`,
        [data.clientId],
      );
    }

    const access = await client.query(
      `SELECT status FROM public.client_access WHERE user_id = $1`,
      [data.clientId],
    );

    return {
      onboarding: upserted.rows[0] as Record<string, unknown>,
      accessStatus: ((access.rows[0] as { status?: string } | undefined)?.status as string) ?? null,
      measurementId,
      autogenSkipped: true as const,
    };
  };

  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}
