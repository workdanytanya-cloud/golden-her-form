import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTransaction } from "@/lib/selfhost/db";
import {
  describeMailConfigForOps,
  getPublicAppUrl,
  sendSelfhostMail,
} from "@/lib/selfhost/mail";
import { hashPasswordArgon2id } from "@/lib/selfhost/passwords";

type Queryable = Pool | PoolClient;

function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return typeof (db as PoolClient).release === "function" && !("idleCount" in db);
}

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_OK =
  "Если аккаунт с таким email существует, мы отправили ссылку для смены пароля. Проверьте почту.";

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(255),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8).max(72),
});

const requestAttempts = new Map<string, { count: number; resetAt: number }>();
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_MAX_PER_KEY = 5;

export function resetPasswordResetRateLimitForTests() {
  requestAttempts.clear();
}

export function assertPasswordResetRateLimit(keys: string[]): void {
  const now = Date.now();
  for (const key of keys) {
    const current = requestAttempts.get(key);
    if (!current || current.resetAt < now) {
      requestAttempts.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
      continue;
    }
    current.count += 1;
    if (current.count > REQUEST_MAX_PER_KEY) {
      throw Object.assign(
        new Error("Слишком много запросов. Подождите несколько минут и попробуйте снова."),
        { statusCode: 429 },
      );
    }
  }
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

function clientIp(request: Request | null): string | null {
  if (!request) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * Always returns the same public message. Does not reveal whether the email exists.
 * Token is never returned in the API response.
 */
export async function requestPasswordResetPg(
  db: Queryable,
  input: z.infer<typeof passwordResetRequestSchema>,
  request: Request | null = null,
): Promise<{ message: string; mailed: boolean }> {
  const data = passwordResetRequestSchema.parse(input);
  const email = data.email.trim().toLowerCase();
  const ip = clientIp(request);
  assertPasswordResetRateLimit([`ip:${ip ?? "unknown"}`, `email:${email}`]);

  const publicUrl = getPublicAppUrl();
  const { rows } = await db.query(
    `SELECT id, status FROM public.users WHERE email = $1`,
    [email],
  );
  const user = rows[0] as { id: string; status: string } | undefined;

  // Uniform timing-ish path: if no user / disabled / no public URL, still return GENERIC_OK.
  if (!user || user.status === "disabled" || !publicUrl) {
    if (!publicUrl) {
      console.error("[password-reset] SELFHOST_PUBLIC_URL not configured");
    }
    return { message: GENERIC_OK, mailed: false };
  }

  const rawToken = newResetToken();
  const tokenHash = hashResetToken(rawToken);
  const expires = new Date(Date.now() + RESET_TTL_MS);

  const run = async (client: PoolClient) => {
    await client.query(
      `UPDATE public.password_reset_tokens
          SET used_at = COALESCE(used_at, (now() AT TIME ZONE 'utc'))
        WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at, request_ip)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expires.toISOString(), ip],
    );
  };
  if (isPoolClient(db)) await run(db);
  else await withTransaction((c) => run(c));

  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const mail = await sendSelfhostMail({
    to: email,
    subject: "Восстановление пароля — PanovaPRO",
    text: [
      "Здравствуйте!",
      "",
      "Мы получили запрос на смену пароля в кабинете PanovaPRO.",
      "Откройте ссылку (действует около часа, одноразовая):",
      link,
      "",
      "Если вы не запрашивали сброс — просто проигнорируйте это письмо.",
    ].join("\n"),
  });

  if (!mail.ok) {
    // Token exists but mail failed — still uniform response. Ops see reason without token.
    console.error("[password-reset] mail not delivered", mail.reason);
    const ops = describeMailConfigForOps();
    if (ops.blocker) console.error("[password-reset] blocker:", ops.blocker);
  }

  return { message: GENERIC_OK, mailed: mail.ok };
}

export async function confirmPasswordResetPg(
  db: Queryable,
  input: z.infer<typeof passwordResetConfirmSchema>,
): Promise<{ ok: true }> {
  const data = passwordResetConfirmSchema.parse(input);
  const tokenHash = hashResetToken(data.token);
  const passwordHash = await hashPasswordArgon2id(data.password);

  const run = async (client: PoolClient) => {
    const { rows } = await client.query(
      `SELECT id, user_id, expires_at, used_at
         FROM public.password_reset_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const row = rows[0] as
      | {
          id: string;
          user_id: string;
          expires_at: Date;
          used_at: Date | null;
        }
      | undefined;

    if (!row || row.used_at) {
      throw Object.assign(new Error("Ссылка восстановления недействительна или уже использована"), {
        statusCode: 400,
      });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error("Срок действия ссылки истёк. Запросите новую."), {
        statusCode: 400,
      });
    }

    const marked = await client.query(
      `UPDATE public.password_reset_tokens
          SET used_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1 AND used_at IS NULL
        RETURNING id`,
      [row.id],
    );
    if (!marked.rowCount) {
      throw Object.assign(new Error("Ссылка восстановления недействительна или уже использована"), {
        statusCode: 400,
      });
    }

    await client.query(
      `UPDATE public.users
          SET password_hash = $2,
              updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1`,
      [row.user_id, passwordHash],
    );

    await client.query(
      `UPDATE public.sessions
          SET revoked_at = (now() AT TIME ZONE 'utc')
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id],
    );

    // Invalidate any other outstanding reset tokens for this user.
    await client.query(
      `UPDATE public.password_reset_tokens
          SET used_at = COALESCE(used_at, (now() AT TIME ZONE 'utc'))
        WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id],
    );
  };

  if (isPoolClient(db)) await run(db);
  else await withTransaction((c) => run(c));
  return { ok: true };
}
