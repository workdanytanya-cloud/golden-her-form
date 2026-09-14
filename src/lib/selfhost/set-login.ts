import type { Pool } from "pg";
import { hashPasswordArgon2id } from "@/lib/selfhost/passwords";

export function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertLoginEmail(raw: string): string {
  const email = normalizeLoginEmail(raw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Некорректный формат email");
  }
  if (email.length > 254) {
    throw new Error("Некорректный формат email");
  }
  return email;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const maskPart = (value: string) => {
    if (!value) return "*";
    if (value.length <= 2) return `${value[0] ?? "*"}*`;
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  };
  const [host, ...rest] = domain.split(".");
  const tld = rest.join(".");
  return `${maskPart(local)}@${maskPart(host)}${tld ? `.${tld}` : ""}`;
}

export type ImportedUserChoice = {
  id: string;
  role: string;
  accessStatus: string | null;
  courseCount: number;
  emailMasked: string;
};

export async function listImportedUsers(pool: Pool): Promise<ImportedUserChoice[]> {
  const result = await pool.query<{
    id: string;
    email: string;
    role: string | null;
    access_status: string | null;
    course_count: string;
  }>(
    `SELECT u.id, u.email,
            COALESCE((SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = u.id ORDER BY ur.role LIMIT 1), 'client') AS role,
            a.status AS access_status,
            (SELECT count(*)::text FROM public.client_courses c WHERE c.client_id = u.id) AS course_count
       FROM public.users u
       LEFT JOIN public.client_access a ON a.user_id = u.id
      ORDER BY u.created_at ASC, u.id ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role ?? "client",
    accessStatus: row.access_status,
    courseCount: Number(row.course_count),
    emailMasked: maskEmail(row.email),
  }));
}

export async function updateImportedUserLogin(
  pool: Pool,
  input: { userId: string; email: string; password: string },
): Promise<void> {
  const email = assertLoginEmail(input.email);
  if (input.password.length < 8) {
    throw new Error("Пароль должен содержать минимум 8 символов");
  }
  const hash = await hashPasswordArgon2id(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const taken = await client.query(
      `SELECT 1 FROM public.users WHERE email = $1 AND id <> $2`,
      [email, input.userId],
    );
    if ((taken.rowCount ?? 0) > 0) {
      throw new Error("Этот email уже занят");
    }
    const updated = await client.query(
      `UPDATE public.users
          SET email = $2,
              password_hash = $3,
              updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1
        RETURNING id`,
      [input.userId, email, hash],
    );
    if (!updated.rowCount) throw new Error("Пользователь не найден");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
