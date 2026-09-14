import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "@/lib/selfhost/db";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const nullableFinite = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v));

export const measurementCreateSchema = z.object({
  clientId: z.string().uuid(),
  measured_on: z.string().regex(dateRe),
  weight_kg: nullableFinite,
  waist_cm: nullableFinite,
  hips_cm: nullableFinite,
  chest_cm: nullableFinite,
  note: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().min(8).max(200).nullable().optional(),
});

export type MeasurementRow = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  chest_cm: number | null;
  note: string | null;
  created_at?: string;
};

function mapMeasurement(row: Record<string, unknown>): MeasurementRow {
  return {
    id: String(row.id),
    measured_on: String(row.measured_on).slice(0, 10),
    weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
    waist_cm: row.waist_cm == null ? null : Number(row.waist_cm),
    hips_cm: row.hips_cm == null ? null : Number(row.hips_cm),
    chest_cm: row.chest_cm == null ? null : Number(row.chest_cm),
    note: (row.note as string | null) ?? null,
    created_at: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : undefined,
  };
}

function assertMetricRanges(input: z.infer<typeof measurementCreateSchema>) {
  const check = (label: string, v: number | null | undefined, min: number, max: number) => {
    if (v == null) return;
    if (!Number.isFinite(v) || v < min || v > max) {
      throw Object.assign(new Error(`${label}: допустимо ${min}–${max}`), { statusCode: 400 });
    }
  };
  check("Вес (кг)", input.weight_kg, 30, 250);
  check("Талия (см)", input.waist_cm, 40, 200);
  check("Бёдра (см)", input.hips_cm, 40, 200);
  check("Грудь (см)", input.chest_cm, 40, 200);
  if (
    input.weight_kg == null &&
    input.waist_cm == null &&
    input.hips_cm == null &&
    input.chest_cm == null &&
    !(input.note && input.note.trim())
  ) {
    throw Object.assign(new Error("Укажите хотя бы один показатель или заметку"), {
      statusCode: 400,
    });
  }
}

/** Единый способ «текущего» веса: последняя запись с weight_kg по дате, затем created_at. */
export async function loadLatestWeightKgPg(
  db: Queryable,
  userId: string,
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT weight_kg FROM public.measurements
      WHERE user_id = $1 AND weight_kg IS NOT NULL
      ORDER BY measured_on DESC, created_at DESC
      LIMIT 1`,
    [userId],
  );
  const w = (rows[0] as { weight_kg?: number | string } | undefined)?.weight_kg;
  return w == null ? null : Number(w);
}

export async function listMeasurementsPg(
  db: Queryable,
  userId: string,
): Promise<MeasurementRow[]> {
  const { rows } = await db.query(
    `SELECT id, measured_on::text, weight_kg, waist_cm, hips_cm, chest_cm, note, created_at
       FROM public.measurements
      WHERE user_id = $1
      ORDER BY measured_on ASC, created_at ASC`,
    [userId],
  );
  return rows.map((r) => mapMeasurement(r as Record<string, unknown>));
}

async function loadMeasurementById(
  db: Queryable,
  id: string,
): Promise<MeasurementRow | null> {
  const { rows } = await db.query(
    `SELECT id, measured_on::text, weight_kg, waist_cm, hips_cm, chest_cm, note, created_at
       FROM public.measurements WHERE id = $1`,
    [id],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapMeasurement(row) : null;
}

/**
 * Расчётная рекомендация КБЖУ по правилам cloud-триггера.
 * Не трогает published nutrition/training, assignments, snapshots, content_hash.
 */
export async function createNutritionRecommendationFromMeasurementPg(
  db: Queryable,
  userId: string,
  measurementId: string,
  weightKg: number,
): Promise<void> {
  if (!Number.isFinite(weightKg) || weightKg < 30) return;

  const profile = await db.query(
    `SELECT height_cm, gender, birth_date::text AS birth_date FROM public.profiles WHERE id = $1`,
    [userId],
  );
  const onb = await db.query(
    `SELECT activity_level, goal_primary FROM public.onboarding_responses WHERE user_id = $1`,
    [userId],
  );
  const p = profile.rows[0] as
    | { height_cm?: number | null; gender?: string | null; birth_date?: string | null }
    | undefined;
  const o = onb.rows[0] as
    | { activity_level?: string | null; goal_primary?: string | null }
    | undefined;

  const height = Number(p?.height_cm ?? 165) || 165;
  let age = 30;
  if (p?.birth_date) {
    const birth = new Date(p.birth_date);
    if (!Number.isNaN(birth.getTime())) {
      const now = new Date();
      age = Math.max(
        14,
        now.getFullYear() -
          birth.getFullYear() -
          (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0),
      );
    }
  }
  const activity = (o?.activity_level ?? "medium").toLowerCase();
  const factor =
    activity === "sedentary" || activity === "low"
      ? 1.2
      : activity === "high"
        ? 1.55
        : activity === "very_high"
          ? 1.725
          : 1.375;
  const goal = (o?.goal_primary ?? "").toLowerCase();
  const adj = /(похуд|снижен|жир|lose|weight_loss)/.test(goal)
    ? -0.15
    : /(набор|мышц|gain|muscle)/.test(goal)
      ? 0.1
      : 0;
  const gender = (p?.gender ?? "female").toLowerCase();
  const bmr =
    gender === "male"
      ? 10 * weightKg + 6.25 * height - 5 * age + 5
      : 10 * weightKg + 6.25 * height - 5 * age - 161;
  const tdee = bmr * factor;
  let prot = Math.round(weightKg * 1.8 * 10) / 10;
  let fat = Math.round(weightKg * 0.9 * 10) / 10;
  let kcal = Math.round(tdee * (1 + adj));
  let carbs = Math.max(0, Math.round(((kcal - prot * 4 - fat * 9) / 4) * 10) / 10);
  kcal = Math.round(prot * 4 + carbs * 4 + fat * 9);

  const assigned = await db.query(
    `SELECT a.active_version_id AS version_id, v.snapshot->'targets' AS targets
       FROM public.client_program_assignments a
       JOIN public.nutrition_plan_versions v ON v.id = a.active_version_id
      WHERE a.client_id = $1 AND a.kind = 'nutrition' AND v.status = 'published'
      LIMIT 1`,
    [userId],
  );
  const arow = assigned.rows[0] as
    | { version_id?: string; targets?: Record<string, unknown> | null }
    | undefined;
  const targets = arow?.targets ?? {};
  const ak = Number(targets.kcal ?? 0) || 0;
  const ap = Number(targets.protein_g ?? 0) || 0;
  const af = Number(targets.fat_g ?? 0) || 0;
  const ac = Number(targets.carbs_g ?? 0) || 0;

  await db.query(
    `UPDATE public.nutrition_recommendations
        SET status = 'replaced'
      WHERE client_id = $1 AND status = 'pending_trainer_review'`,
    [userId],
  );
  await db.query(
    `INSERT INTO public.nutrition_recommendations (
       client_id, measurement_id, based_on_version_id, status,
       assigned_kcal, assigned_protein_g, assigned_fat_g, assigned_carbs_g,
       recommended_kcal, recommended_protein_g, recommended_fat_g, recommended_carbs_g,
       new_weight_kg, bmr, tdee, reason
     ) VALUES (
       $1,$2,$3,'pending_trainer_review',
       $4,$5,$6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,
       'Новые замеры клиента — требуется проверка тренера'
     )`,
    [
      userId,
      measurementId,
      arow?.version_id ?? null,
      ak,
      ap,
      af,
      ac,
      kcal,
      prot,
      fat,
      carbs,
      weightKg,
      Math.round(bmr),
      Math.round(tdee),
    ],
  );
  await db.query(
    `INSERT INTO public.admin_notifications (type, client_id, measurement_id, message)
     VALUES (
       'nutrition_recommendation',
       $1,
       $2,
       'Новые замеры: пересчитана рекомендация КБЖУ. Активное меню не изменено — нужна проверка.'
     )`,
    [userId, measurementId],
  );
}

export async function createMeasurementPg(
  db: Queryable,
  input: z.infer<typeof measurementCreateSchema>,
): Promise<{ measurement: MeasurementRow; idempotent: boolean }> {
  const data = measurementCreateSchema.parse(input);
  assertMetricRanges(data);

  const run = async (client: PoolClient) => {
    if (data.idempotencyKey) {
      // Сериализуем повторную отправку с тем же ключом в рамках транзакции.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [data.idempotencyKey]);
      const existing = await client.query(
        `SELECT measurement_id FROM public.measurement_write_idempotency
          WHERE idempotency_key = $1 AND user_id = $2`,
        [data.idempotencyKey, data.clientId],
      );
      const mid = (existing.rows[0] as { measurement_id?: string } | undefined)?.measurement_id;
      if (mid) {
        const measurement = await loadMeasurementById(client, mid);
        if (measurement) return { measurement, idempotent: true };
      }
    }

    const inserted = await client.query(
      `INSERT INTO public.measurements (
         user_id, measured_on, weight_kg, waist_cm, hips_cm, chest_cm, note
       ) VALUES ($1,$2::date,$3,$4,$5,$6,$7)
       RETURNING id, measured_on::text, weight_kg, waist_cm, hips_cm, chest_cm, note, created_at`,
      [
        data.clientId,
        data.measured_on,
        data.weight_kg,
        data.waist_cm,
        data.hips_cm,
        data.chest_cm,
        data.note?.trim() || null,
      ],
    );
    const measurement = mapMeasurement(inserted.rows[0] as Record<string, unknown>);

    if (data.idempotencyKey) {
      await client.query(
        `INSERT INTO public.measurement_write_idempotency (idempotency_key, user_id, measurement_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [data.idempotencyKey, data.clientId, measurement.id],
      );
    }

    if (measurement.weight_kg != null) {
      await createNutritionRecommendationFromMeasurementPg(
        client,
        data.clientId,
        measurement.id,
        measurement.weight_kg,
      );
    }

    return { measurement, idempotent: false };
  };

  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}

export async function deleteMeasurementPg(
  db: Queryable,
  measurementId: string,
  ownerUserId: string,
): Promise<void> {
  if (!uuidRe.test(measurementId)) {
    throw Object.assign(new Error("Некорректный id замера"), { statusCode: 400 });
  }
  const { rowCount } = await db.query(
    `DELETE FROM public.measurements WHERE id = $1 AND user_id = $2`,
    [measurementId, ownerUserId],
  );
  if (!rowCount) {
    throw Object.assign(new Error("Замер не найден"), { statusCode: 404 });
  }
}
