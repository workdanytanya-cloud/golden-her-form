import type { Pool, PoolClient } from "pg";
import { z } from "zod";

export type Queryable = Pool | PoolClient;

export const adminClientListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
});

export const adminClientProfileSchema = z.object({
  full_name: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  goal: z.string().max(300).nullable().optional(),
  height_cm: z.number().min(80).max(260).nullable().optional(),
  birth_date: z.string().nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  avatar_url: z.string().max(2000).nullable().optional(),
  can_reheat_food: z.boolean().nullable().optional(),
  can_take_food_to_work: z.boolean().nullable().optional(),
  disliked_products: z.array(z.string()).optional(),
  excluded_food_products: z.array(z.string()).optional(),
  food_allergies: z.array(z.string()).optional(),
  food_intolerances: z.array(z.string()).optional(),
  max_prep_minutes: z.number().int().nullable().optional(),
  preferred_main_meal_time: z.string().max(80).nullable().optional(),
  preferred_meal_schedule: z.string().max(80).nullable().optional(),
});

export const adminClientAccessSchema = z.object({
  status: z.enum(["pending_onboarding", "awaiting_approval", "active", "suspended"]),
  notes: z.string().max(2000).nullable().optional(),
});

export type AdminClientListItem = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  created_at: string;
  access_status: string | null;
  onboarding_completed_at: string | null;
  course_count: number;
  active_course_id: string | null;
};

export type AdminClientCard = AdminClientListItem & {
  height_cm: number | null;
  birth_date: string | null;
  gender: string | null;
  avatar_url: string | null;
  role: "client";
  unlock_source: string | null;
  activated_at: string | null;
  access_notes: string | null;
  onboarding: Record<string, unknown> | null;
  measurements: AdminMeasurement[];
  latest_measurement: AdminMeasurement | null;
};

export type AdminMeasurement = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  chest_cm: number | null;
  note: string | null;
};

const LIST_SELECT = `
SELECT u.id,
       u.email::text AS email,
       COALESCE(p.created_at, u.created_at) AS created_at,
       p.full_name, p.phone, p.goal, p.height_cm, p.birth_date, p.gender, p.avatar_url,
       ca.status AS access_status, ca.unlock_source, ca.activated_at, ca.notes AS access_notes,
       o.completed_at AS onboarding_completed_at,
       (
         SELECT count(*)::int FROM public.client_courses cc WHERE cc.client_id = u.id
       ) AS course_count,
       (
         SELECT cc.id FROM public.client_courses cc
          WHERE cc.client_id = u.id AND cc.status = 'active'
          ORDER BY cc.start_date DESC
          LIMIT 1
       ) AS active_course_id
  FROM public.users u
  JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'client'
  LEFT JOIN public.user_roles admin_role ON admin_role.user_id = u.id AND admin_role.role = 'admin'
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.client_access ca ON ca.user_id = u.id
  LEFT JOIN public.onboarding_responses o ON o.user_id = u.id
 WHERE admin_role.user_id IS NULL
`;

function mapListRow(row: Record<string, unknown>): AdminClientListItem {
  return {
    id: String(row.id),
    email: (row.email as string | null) ?? null,
    full_name: (row.full_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    goal: (row.goal as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
    access_status: (row.access_status as string | null) ?? null,
    onboarding_completed_at: row.onboarding_completed_at
      ? new Date(row.onboarding_completed_at as string | Date).toISOString()
      : null,
    course_count: Number(row.course_count ?? 0),
    active_course_id: (row.active_course_id as string | null) ?? null,
  };
}

function mapMeasurement(row: Record<string, unknown>): AdminMeasurement {
  return {
    id: String(row.id),
    measured_on: String(row.measured_on).slice(0, 10),
    weight_kg: row.weight_kg == null ? null : Number(row.weight_kg),
    waist_cm: row.waist_cm == null ? null : Number(row.waist_cm),
    hips_cm: row.hips_cm == null ? null : Number(row.hips_cm),
    chest_cm: row.chest_cm == null ? null : Number(row.chest_cm),
    note: (row.note as string | null) ?? null,
  };
}

export class PostgresAdminClientRepository {
  queryCount = 0;

  constructor(private readonly db: Queryable) {}

  private async q(sql: string, params: unknown[] = []) {
    this.queryCount += 1;
    return this.db.query(sql, params);
  }

  async list(
    input: { q?: string } = {},
  ): Promise<{ items: AdminClientListItem[]; queryCount: number }> {
    const parsed = adminClientListQuerySchema.parse(input);
    const start = this.queryCount;
    const params: unknown[] = [];
    let sql = LIST_SELECT;
    const q = parsed.q.trim();
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` AND (
        lower(COALESCE(p.full_name, '')) LIKE $1
        OR lower(COALESCE(p.phone, '')) LIKE $1
        OR lower(COALESCE(p.goal, '')) LIKE $1
        OR lower(u.email::text) LIKE $1
      )`;
    }
    sql += ` ORDER BY CASE COALESCE(ca.status, 'pending_onboarding')
      WHEN 'awaiting_approval' THEN 0
      WHEN 'pending_onboarding' THEN 2
      WHEN 'active' THEN 3
      ELSE 4 END, COALESCE(p.created_at, u.created_at) DESC`;
    const { rows } = await this.q(sql, params);
    return {
      items: rows.map((row) => mapListRow(row as Record<string, unknown>)),
      queryCount: this.queryCount - start,
    };
  }

  async get(clientId: string): Promise<AdminClientCard | null> {
    const { rows } = await this.q(`${LIST_SELECT} AND u.id = $1`, [clientId]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const [onboarding, measurements] = await Promise.all([
      this.q(`SELECT * FROM public.onboarding_responses WHERE user_id = $1`, [clientId]),
      this.q(
        `SELECT id, measured_on, weight_kg, waist_cm, hips_cm, chest_cm, note
           FROM public.measurements WHERE user_id = $1 ORDER BY measured_on DESC, created_at DESC`,
        [clientId],
      ),
    ]);
    const meas = measurements.rows.map((item) => mapMeasurement(item as Record<string, unknown>));
    const base = mapListRow(row);
    return {
      ...base,
      height_cm: row.height_cm == null ? null : Number(row.height_cm),
      birth_date: row.birth_date ? String(row.birth_date).slice(0, 10) : null,
      gender: (row.gender as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      role: "client",
      unlock_source: (row.unlock_source as string | null) ?? null,
      activated_at: row.activated_at
        ? new Date(row.activated_at as string | Date).toISOString()
        : null,
      access_notes: (row.access_notes as string | null) ?? null,
      onboarding: (onboarding.rows[0] as Record<string, unknown> | undefined) ?? null,
      measurements: meas,
      latest_measurement: meas[0] ?? null,
    };
  }

  async updateProfile(
    clientId: string,
    patch: z.infer<typeof adminClientProfileSchema>,
  ): Promise<void> {
    const data = adminClientProfileSchema.parse(patch);
    const existing = await this.get(clientId);
    if (!existing) throw Object.assign(new Error("Клиент не найден"), { statusCode: 404 });
    await this.q(`INSERT INTO public.profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
      clientId,
    ]);
    await this.q(
      `UPDATE public.profiles SET
         full_name = $2,
         phone = $3,
         goal = $4,
         height_cm = $5,
         birth_date = $6::date,
         gender = $7,
         avatar_url = COALESCE($8, avatar_url),
         can_reheat_food = COALESCE($9, can_reheat_food),
         can_take_food_to_work = COALESCE($10, can_take_food_to_work),
         disliked_products = COALESCE($11, disliked_products),
         excluded_food_products = COALESCE($12, excluded_food_products),
         food_allergies = COALESCE($13, food_allergies),
         food_intolerances = COALESCE($14, food_intolerances),
         max_prep_minutes = COALESCE($15, max_prep_minutes),
         preferred_main_meal_time = COALESCE($16, preferred_main_meal_time),
         preferred_meal_schedule = COALESCE($17, preferred_meal_schedule),
         updated_at = (now() AT TIME ZONE 'utc')
       WHERE id = $1`,
      [
        clientId,
        data.full_name ?? null,
        data.phone ?? null,
        data.goal ?? null,
        data.height_cm ?? null,
        data.birth_date ?? null,
        data.gender ?? null,
        data.avatar_url ?? null,
        data.can_reheat_food ?? null,
        data.can_take_food_to_work ?? null,
        data.disliked_products ?? null,
        data.excluded_food_products ?? null,
        data.food_allergies ?? null,
        data.food_intolerances ?? null,
        data.max_prep_minutes ?? null,
        data.preferred_main_meal_time ?? null,
        data.preferred_meal_schedule ?? null,
      ],
    );
  }

  async setAccess(
    clientId: string,
    input: z.infer<typeof adminClientAccessSchema>,
    actorId: string,
  ): Promise<void> {
    const data = adminClientAccessSchema.parse(input);
    const existing = await this.get(clientId);
    if (!existing) throw Object.assign(new Error("Клиент не найден"), { statusCode: 404 });
    await this.q(
      `INSERT INTO public.client_access (user_id, status, notes, activated_at, activated_by, updated_at)
       VALUES ($1,$2,$3, CASE WHEN $2 = 'active' THEN (now() AT TIME ZONE 'utc') ELSE NULL END, $4, (now() AT TIME ZONE 'utc'))
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         notes = COALESCE(EXCLUDED.notes, public.client_access.notes),
         activated_at = CASE WHEN EXCLUDED.status = 'active' THEN COALESCE(public.client_access.activated_at, (now() AT TIME ZONE 'utc')) ELSE public.client_access.activated_at END,
         activated_by = CASE WHEN EXCLUDED.status = 'active' THEN $4 ELSE public.client_access.activated_by END,
         updated_at = (now() AT TIME ZONE 'utc')`,
      [clientId, data.status, data.notes ?? null, actorId],
    );
  }

  async exportContacts(): Promise<
    Array<{ full_name: string; phone: string; email: string; created_at: string }>
  > {
    const { items } = await this.list();
    return items.map((item) => ({
      full_name: item.full_name ?? "",
      phone: item.phone ?? "",
      email: item.email ?? "",
      created_at: item.created_at,
    }));
  }
}
