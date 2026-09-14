import type { Pool, PoolClient } from "pg";
import {
  csrfCookieName,
  getAuthBackend,
  isProduction,
  sessionCookieName,
  sessionCookieSecure,
  sessionTtlMs,
} from "@/lib/selfhost/config";
import { getPostgresPool } from "@/lib/selfhost/db";
import {
  genericLoginError,
  hashPasswordArgon2id,
  hashSessionToken,
  isBcryptHash,
  newSessionToken,
  safeEqual,
  verifyPassword,
} from "@/lib/selfhost/passwords";
import type { AppRole, AuthSession } from "@/lib/platform/types";

export type DbClient = Pool | PoolClient;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;

export function resetLoginRateLimitForTests() {
  loginAttempts.clear();
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function assertLoginRateLimit(request: Request): void {
  const key = clientKey(request);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > LOGIN_MAX) {
    throw Object.assign(new Error("Слишком много попыток входа. Подождите несколько минут."), {
      statusCode: 429,
    });
  }
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) out[key] = value;
  }
  return out;
}

export function readSessionToken(request: Request): string | null {
  return parseCookies(request)[sessionCookieName()] ?? null;
}

export function readCsrfToken(request: Request): string | null {
  return parseCookies(request)[csrfCookieName()] ?? null;
}

export function assertCsrf(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const cookie = readCsrfToken(request);
  const header = request.headers.get("x-csrf-token");
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw Object.assign(new Error("CSRF-проверка не пройдена"), { statusCode: 403 });
  }
}

export function sessionCookieHeader(token: string, maxAgeMs = sessionTtlMs()): string {
  const parts = [
    `${sessionCookieName()}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (sessionCookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function csrfCookieHeader(token: string): string {
  const parts = [
    `${csrfCookieName()}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(sessionTtlMs() / 1000)}`,
  ];
  if (sessionCookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [
    `${sessionCookieName()}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (sessionCookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export async function createSession(db: DbClient, userId: string): Promise<string> {
  const token = newSessionToken();
  const tokenHash = hashSessionToken(token);
  const expires = new Date(Date.now() + sessionTtlMs());
  await db.query(
    `INSERT INTO public.sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expires.toISOString()],
  );
  return token;
}

export async function revokeSessionByToken(db: DbClient, token: string | null): Promise<void> {
  if (!token) return;
  await db.query(
    `UPDATE public.sessions SET revoked_at = (now() AT TIME ZONE 'utc')
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSessionToken(token)],
  );
}

export async function revokeAllSessionsForUser(db: DbClient, userId: string): Promise<void> {
  await db.query(
    `UPDATE public.sessions SET revoked_at = (now() AT TIME ZONE 'utc')
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

export type LocalSession = AuthSession & { accessStatus: string | null; unlockSource: string | null };

export async function loadSession(db: DbClient, token: string | null): Promise<LocalSession | null> {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.status AS user_status,
            ca.status AS access_status, ca.unlock_source
     FROM public.sessions s
     JOIN public.users u ON u.id = s.user_id
     LEFT JOIN public.client_access ca ON ca.user_id = u.id
     WHERE s.token_hash = $1`,
    [hashSessionToken(token)],
  );
  const row = rows[0] as
    | {
        id: string;
        user_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        email: string;
        user_status: string;
        access_status: string | null;
        unlock_source: string | null;
      }
    | undefined;
  if (!row || row.revoked_at || row.user_status === "disabled") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  await db.query(
    `UPDATE public.sessions SET last_seen_at = (now() AT TIME ZONE 'utc') WHERE id = $1`,
    [row.id],
  );

  const roles = await db.query(`SELECT role FROM public.user_roles WHERE user_id = $1`, [row.user_id]);
  const role: AppRole = roles.rows.some((r: { role: string }) => r.role === "admin")
    ? "admin"
    : "client";

  return {
    userId: row.user_id,
    email: row.email,
    role,
    accessStatus: row.access_status,
    unlockSource: row.unlock_source,
  };
}

export async function loginWithPassword(
  db: DbClient,
  email: string,
  password: string,
): Promise<{ token: string; session: LocalSession }> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await db.query(
    `SELECT id, password_hash, status FROM public.users WHERE email = $1`,
    [normalized],
  );
  const user = rows[0] as { id: string; password_hash: string; status: string } | undefined;
  if (!user || user.status === "disabled") {
    throw Object.assign(new Error(genericLoginError()), { statusCode: 401 });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    throw Object.assign(new Error(genericLoginError()), { statusCode: 401 });
  }
  if (isBcryptHash(user.password_hash)) {
    const next = await hashPasswordArgon2id(password);
    await db.query(`UPDATE public.users SET password_hash = $2, updated_at = (now() AT TIME ZONE 'utc') WHERE id = $1`, [
      user.id,
      next,
    ]);
  }
  await db.query(
    `UPDATE public.sessions SET revoked_at = (now() AT TIME ZONE 'utc')
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id],
  );
  const token = await createSession(db, user.id);
  const session = await loadSession(db, token);
  if (!session) throw new Error("Не удалось создать сессию");
  return { token, session };
}

export class LocalAuthProvider {
  readonly kind = "local" as const;

  async getSessionFromRequest(request: Request): Promise<LocalSession | null> {
    if (getAuthBackend() !== "local") return null;
    return loadSession(getPostgresPool(), readSessionToken(request));
  }

  async getSessionFromBearerToken(token: string): Promise<LocalSession | null> {
    if (getAuthBackend() !== "local") return null;
    return loadSession(getPostgresPool(), token);
  }

  async getBrowserSession(): Promise<null> {
    return null;
  }
}

export function ensureLocalAuthEnabled(): void {
  if (getAuthBackend() !== "local") {
    throw new Error("Локальная авторизация выключена (AUTH_BACKEND≠local)");
  }
}

export { isProduction };
