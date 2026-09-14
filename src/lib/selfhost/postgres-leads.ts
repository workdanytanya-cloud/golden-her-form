import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "@/lib/selfhost/db";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

/** Same validation rules as cloud submitLead. */
export const leadCreateSchema = z.object({
  full_name: z.string().trim().min(2, "Укажите фамилию и имя").max(120),
  age: z.coerce.number().int().min(14, "Минимум 14 лет").max(100),
  phone: z
    .string()
    .trim()
    .min(10, "Укажите телефон")
    .max(32)
    .regex(/^[+\d\s()-]+$/, "Некорректный телефон")
    .refine(
      (v) => {
        const d = v.replace(/\D/g, "");
        return d.length === 11 && d.startsWith("7");
      },
      "Введите номер полностью: +7 (XXX) XXX-XX-XX",
    ),
  email: z.string().trim().email("Укажите действующий email").max(255),
  messenger: z.enum(["telegram", "max", "whatsapp", "any"]),
  source: z.enum(["general", "program", "question"]).default("general"),
  program_slug: z.string().max(80).nullable().optional(),
  program_title: z.string().max(120).nullable().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
  website: z.string().max(200).optional(),
  idempotencyKey: z.string().min(8).max(200).nullable().optional(),
});

export const leadStatusSchema = z.enum(["new", "contacted", "converted", "archived"]);

export type LeadRow = {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  age: number;
  phone: string;
  email: string;
  messenger: string;
  source: string;
  program_slug: string | null;
  program_title: string | null;
  message: string | null;
  status: string;
  notes: string | null;
};

function mapLead(row: Record<string, unknown>): LeadRow {
  return {
    id: String(row.id),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
    full_name: String(row.full_name),
    age: Number(row.age),
    phone: String(row.phone),
    email: String(row.email),
    messenger: String(row.messenger),
    source: String(row.source),
    program_slug: (row.program_slug as string | null) ?? null,
    program_title: (row.program_title as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    status: String(row.status),
    notes: (row.notes as string | null) ?? null,
  };
}

const submitAttempts = new Map<string, { count: number; resetAt: number }>();
const SUBMIT_WINDOW_MS = 15 * 60 * 1000;
const SUBMIT_MAX = 12;

export function resetLeadSubmitRateLimitForTests() {
  submitAttempts.clear();
}

export function assertLeadSubmitRateLimit(request: Request): void {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = submitAttempts.get(key);
  if (!current || current.resetAt < now) {
    submitAttempts.set(key, { count: 1, resetAt: now + SUBMIT_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > SUBMIT_MAX) {
    throw Object.assign(
      new Error("Слишком много заявок. Подождите несколько минут и попробуйте снова."),
      { statusCode: 429 },
    );
  }
}

export async function listLeadsPg(db: Queryable): Promise<LeadRow[]> {
  const { rows } = await db.query(
    `SELECT id, created_at, updated_at, full_name, age, phone, email, messenger,
            source, program_slug, program_title, message, status, notes
       FROM public.leads
      ORDER BY created_at DESC
      LIMIT 500`,
  );
  return rows.map((r) => mapLead(r as Record<string, unknown>));
}

export async function getLeadPg(db: Queryable, id: string): Promise<LeadRow | null> {
  const { rows } = await db.query(
    `SELECT id, created_at, updated_at, full_name, age, phone, email, messenger,
            source, program_slug, program_title, message, status, notes
       FROM public.leads WHERE id = $1`,
    [id],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapLead(row) : null;
}

export async function updateLeadStatusPg(
  db: Queryable,
  id: string,
  status: z.infer<typeof leadStatusSchema>,
): Promise<LeadRow> {
  const parsed = leadStatusSchema.parse(status);
  const { rows } = await db.query(
    `UPDATE public.leads SET status = $2
      WHERE id = $1
      RETURNING id, created_at, updated_at, full_name, age, phone, email, messenger,
                source, program_slug, program_title, message, status, notes`,
    [id, parsed],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Заявка не найдена"), { statusCode: 404 });
  }
  return mapLead(rows[0] as Record<string, unknown>);
}

/**
 * Persist a lead. Honeypot (`website`) → no insert, synthetic ok.
 * Idempotency key returns the same lead on form resubmit.
 */
export async function createLeadPg(
  db: Queryable,
  input: z.infer<typeof leadCreateSchema>,
): Promise<{ lead: LeadRow | null; idempotent: boolean; honeypot: boolean }> {
  const data = leadCreateSchema.parse(input);
  if (data.website) {
    return { lead: null, idempotent: false, honeypot: true };
  }

  const run = async (client: PoolClient) => {
    if (data.idempotencyKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `lead:${data.idempotencyKey}`,
      ]);
      const existing = await client.query(
        `SELECT lead_id FROM public.lead_write_idempotency WHERE idempotency_key = $1`,
        [data.idempotencyKey],
      );
      const leadId = (existing.rows[0] as { lead_id?: string } | undefined)?.lead_id;
      if (leadId) {
        const lead = await getLeadPg(client, leadId);
        if (lead) return { lead, idempotent: true, honeypot: false };
      }
    }

    const inserted = await client.query(
      `INSERT INTO public.leads (
         full_name, age, phone, email, messenger, source,
         program_slug, program_title, message, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new')
       RETURNING id, created_at, updated_at, full_name, age, phone, email, messenger,
                 source, program_slug, program_title, message, status, notes`,
      [
        data.full_name,
        data.age,
        data.phone.replace(/\s+/g, " ").trim(),
        data.email.toLowerCase(),
        data.messenger,
        data.source,
        data.program_slug ?? null,
        data.program_title ?? null,
        data.message?.trim() || null,
      ],
    );
    const lead = mapLead(inserted.rows[0] as Record<string, unknown>);

    if (data.idempotencyKey) {
      await client.query(
        `INSERT INTO public.lead_write_idempotency (idempotency_key, lead_id)
         VALUES ($1, $2)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [data.idempotencyKey, lead.id],
      );
    }

    return { lead, idempotent: false, honeypot: false };
  };

  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}
