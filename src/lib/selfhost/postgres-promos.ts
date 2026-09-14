import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "@/lib/selfhost/db";
import {
  createSession,
  loadSession,
  type LocalSession,
} from "@/lib/selfhost/local-auth";
import {
  genericLoginError,
  hashPasswordArgon2id,
  verifyPassword,
} from "@/lib/selfhost/passwords";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePromoCode(prefix = "PP"): string {
  let body = "";
  for (let i = 0; i < 6; i++) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${body}`;
}

export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export const adminCreatePromosSchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(1),
  label: z.string().trim().max(120).optional().nullable(),
  program_slug: z.string().trim().max(80).optional().nullable(),
  program_title: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const signupPromoSchema = z.object({
  code: z.string().trim().min(4).max(32),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  full_name: z.string().trim().min(1).max(100),
});

export const redeemPromoSchema = z.object({
  code: z.string().trim().min(4).max(32),
});

export type PromoRow = {
  id: string;
  created_at: string;
  code: string;
  label: string | null;
  program_slug: string | null;
  program_title: string | null;
  status: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  notes: string | null;
};

function mapPromo(row: Record<string, unknown>): PromoRow {
  const ts = (v: unknown) =>
    v == null ? null : new Date(v as string | Date).toISOString();
  return {
    id: String(row.id),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    code: String(row.code),
    label: (row.label as string | null) ?? null,
    program_slug: (row.program_slug as string | null) ?? null,
    program_title: (row.program_title as string | null) ?? null,
    status: String(row.status),
    used_by: (row.used_by as string | null) ?? null,
    used_at: ts(row.used_at),
    expires_at: ts(row.expires_at),
    notes: (row.notes as string | null) ?? null,
  };
}

function assertPromoRedeemable(
  promo: {
    status: string;
    expires_at: Date | string | null;
    used_by: string | null;
  },
  userId: string | null,
): { already: boolean } {
  if (promo.status === "revoked") {
    throw Object.assign(new Error("Промокод отозван"), { statusCode: 400 });
  }
  if (promo.status === "used") {
    if (userId && promo.used_by === userId) return { already: true };
    throw Object.assign(new Error("Промокод уже использован"), { statusCode: 400 });
  }
  if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Срок действия промокода истёк"), { statusCode: 400 });
  }
  return { already: false };
}

async function applyPromoAccess(
  client: PoolClient,
  userId: string,
  code: string,
): Promise<void> {
  const existing = await client.query(
    `SELECT status, activated_at, activated_by, unlock_source, notes
       FROM public.client_access WHERE user_id = $1`,
    [userId],
  );
  const row = existing.rows[0] as
    | {
        status?: string;
        activated_at?: string | Date | null;
        activated_by?: string | null;
        notes?: string | null;
      }
    | undefined;
  const status =
    row?.status === "active" ||
    row?.status === "awaiting_approval" ||
    row?.status === "suspended"
      ? row.status
      : "pending_onboarding";

  await client.query(
    `INSERT INTO public.client_access (
       user_id, status, unlock_source, activated_at, activated_by, notes, updated_at
     ) VALUES (
       $1, $2, 'promo', $3, $4, $5, (now() AT TIME ZONE 'utc')
     )
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status,
       unlock_source = 'promo',
       activated_at = COALESCE(public.client_access.activated_at, EXCLUDED.activated_at),
       activated_by = COALESCE(public.client_access.activated_by, EXCLUDED.activated_by),
       notes = COALESCE(NULLIF(public.client_access.notes, ''), EXCLUDED.notes),
       updated_at = (now() AT TIME ZONE 'utc')`,
    [
      userId,
      status,
      row?.activated_at ?? null,
      row?.activated_by ?? null,
      row?.notes || `Промокод ${code}`,
    ],
  );

  await client.query(
    `INSERT INTO public.profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

async function markPromoUsed(
  client: PoolClient,
  promoId: string,
  userId: string,
): Promise<{ program_title: string | null } | null> {
  const { rows } = await client.query(
    `UPDATE public.promo_codes
        SET status = 'used',
            used_by = $2,
            used_at = (now() AT TIME ZONE 'utc')
      WHERE id = $1 AND status = 'unused'
      RETURNING program_title`,
    [promoId, userId],
  );
  const row = rows[0] as { program_title?: string | null } | undefined;
  return row ? { program_title: row.program_title ?? null } : null;
}

export async function listPromoCodesPg(db: Queryable): Promise<PromoRow[]> {
  const { rows } = await db.query(
    `SELECT id, created_at, code, label, program_slug, program_title, status,
            used_by, used_at, expires_at, notes
       FROM public.promo_codes
      ORDER BY created_at DESC
      LIMIT 200`,
  );
  return rows.map((r) => mapPromo(r as Record<string, unknown>));
}

export async function createPromoCodesPg(
  db: Queryable,
  input: z.infer<typeof adminCreatePromosSchema>,
  createdBy: string,
): Promise<PromoRow[]> {
  const data = adminCreatePromosSchema.parse(input);
  const run = async (client: PoolClient) => {
    const created: PromoRow[] = [];
    for (let i = 0; i < data.count; i++) {
      let inserted: PromoRow | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generatePromoCode();
        try {
          const { rows } = await client.query(
            `INSERT INTO public.promo_codes (
               code, label, program_slug, program_title, notes, expires_at, created_by, status
             ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,'unused')
             RETURNING id, created_at, code, label, program_slug, program_title, status,
                       used_by, used_at, expires_at, notes`,
            [
              code,
              data.label || null,
              data.program_slug || null,
              data.program_title || null,
              data.notes || null,
              data.expires_at || null,
              createdBy,
            ],
          );
          inserted = mapPromo(rows[0] as Record<string, unknown>);
          break;
        } catch (err) {
          const pg = err as { code?: string };
          if (pg.code === "23505") continue;
          throw err;
        }
      }
      if (!inserted) {
        throw Object.assign(new Error("Не удалось создать промокоды"), { statusCode: 500 });
      }
      created.push(inserted);
    }
    return created;
  };
  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}

export async function revokePromoCodePg(db: Queryable, id: string): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE public.promo_codes SET status = 'revoked'
      WHERE id = $1 AND status = 'unused'`,
    [id],
  );
  if (!rowCount) {
    throw Object.assign(new Error("Промокод не найден или уже недоступен для отзыва"), {
      statusCode: 404,
    });
  }
}

/** Redeem for an already authenticated user (mirrors cloud redeemPromoCode). */
export async function redeemPromoForUserPg(
  db: Queryable,
  userId: string,
  rawCode: string,
): Promise<{ already: boolean; program_title: string | null }> {
  const code = normalizePromoCode(rawCode);
  const run = async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, status, expires_at, used_by, program_title
         FROM public.promo_codes
        WHERE code = $1
        FOR UPDATE`,
      [code],
    );
    const promo = rows[0] as
      | {
          id: string;
          status: string;
          expires_at: Date | null;
          used_by: string | null;
          program_title: string | null;
        }
      | undefined;
    if (!promo) {
      throw Object.assign(new Error("Промокод не найден"), { statusCode: 404 });
    }
    const gate = assertPromoRedeemable(promo, userId);
    if (gate.already) {
      return { already: true, program_title: promo.program_title };
    }
    const updated = await markPromoUsed(client, promo.id, userId);
    if (!updated) {
      throw Object.assign(new Error("Промокод уже использован"), { statusCode: 400 });
    }
    await applyPromoAccess(client, userId, code);
    return { already: false, program_title: updated.program_title };
  };
  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}

/**
 * Atomic local signup/login + promo redeem.
 * Locks the promo row before creating a user so failures roll back cleanly
 * and concurrent last-use races leave at most one account with the code.
 */
export async function signupOrLoginWithPromoPg(
  db: Queryable,
  input: z.infer<typeof signupPromoSchema>,
): Promise<{
  token: string;
  session: LocalSession;
  already: boolean;
  program_title: string | null;
  createdUser: boolean;
}> {
  const data = signupPromoSchema.parse(input);
  const code = normalizePromoCode(data.code);
  const email = data.email.trim().toLowerCase();

  const run = async (client: PoolClient) => {
    const { rows: promoRows } = await client.query(
      `SELECT id, status, expires_at, used_by, program_title
         FROM public.promo_codes
        WHERE code = $1
        FOR UPDATE`,
      [code],
    );
    const promo = promoRows[0] as
      | {
          id: string;
          status: string;
          expires_at: Date | null;
          used_by: string | null;
          program_title: string | null;
        }
      | undefined;
    if (!promo) {
      throw Object.assign(new Error("Промокод не найден"), { statusCode: 404 });
    }

    const { rows: userRows } = await client.query(
      `SELECT id, password_hash, status FROM public.users WHERE email = $1`,
      [email],
    );
    const existing = userRows[0] as
      | { id: string; password_hash: string; status: string }
      | undefined;

    let userId: string;
    let createdUser = false;

    if (existing) {
      if (existing.status === "disabled") {
        throw Object.assign(new Error(genericLoginError()), { statusCode: 401 });
      }
      const ok = await verifyPassword(data.password, existing.password_hash);
      if (!ok) {
        throw Object.assign(new Error(genericLoginError()), { statusCode: 401 });
      }
      userId = existing.id;
      await client.query(
        `UPDATE public.profiles
            SET full_name = COALESCE(NULLIF(full_name, ''), $2),
                updated_at = (now() AT TIME ZONE 'utc')
          WHERE id = $1`,
        [userId, data.full_name],
      );
    } else {
      // Validate promo before insert so we never leave an orphan account.
      assertPromoRedeemable(promo, null);
      const passwordHash = await hashPasswordArgon2id(data.password);
      const inserted = await client.query(
        `INSERT INTO public.users (email, password_hash, email_verified_at, status)
         VALUES ($1, $2, (now() AT TIME ZONE 'utc'), 'active')
         RETURNING id`,
        [email, passwordHash],
      );
      userId = String((inserted.rows[0] as { id: string }).id);
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'client')`,
        [userId],
      );
      await client.query(
        `INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)`,
        [userId, data.full_name],
      );
      createdUser = true;
    }

    const gate = assertPromoRedeemable(promo, userId);
    if (gate.already) {
      await client.query(
        `UPDATE public.sessions SET revoked_at = (now() AT TIME ZONE 'utc')
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      const token = await createSession(client, userId);
      const session = await loadSession(client, token);
      if (!session) throw new Error("Не удалось создать сессию");
      return {
        token,
        session,
        already: true,
        program_title: promo.program_title,
        createdUser,
      };
    }

    const updated = await markPromoUsed(client, promo.id, userId);
    if (!updated) {
      throw Object.assign(new Error("Промокод уже использован"), { statusCode: 400 });
    }
    await applyPromoAccess(client, userId, code);

    await client.query(
      `UPDATE public.sessions SET revoked_at = (now() AT TIME ZONE 'utc')
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    const token = await createSession(client, userId);
    const session = await loadSession(client, token);
    if (!session) throw new Error("Не удалось создать сессию");
    return {
      token,
      session,
      already: false,
      program_title: updated.program_title,
      createdUser,
    };
  };

  return isPoolClient(db) ? run(db) : withTransaction((c) => run(c));
}
