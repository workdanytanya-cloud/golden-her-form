import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

export type ClientNotificationRow = {
  id: string;
  type: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export type AdminNotificationRow = {
  id: string;
  type: string;
  client_id: string | null;
  measurement_id: string | null;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

function mapClient(row: Record<string, unknown>): ClientNotificationRow {
  return {
    id: String(row.id),
    type: String(row.type),
    message: String(row.message),
    link: (row.link as string | null) ?? null,
    is_read: Boolean(row.is_read),
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

function mapAdmin(row: Record<string, unknown>): AdminNotificationRow {
  return {
    id: String(row.id),
    type: String(row.type),
    client_id: (row.client_id as string | null) ?? null,
    measurement_id: (row.measurement_id as string | null) ?? null,
    message: String(row.message),
    link: (row.link as string | null) ?? null,
    is_read: Boolean(row.is_read),
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function listClientNotificationsPg(
  db: Queryable,
  userId: string,
  limit = 30,
): Promise<{ items: ClientNotificationRow[]; unreadCount: number }> {
  const [list, unread] = await Promise.all([
    db.query(
      `SELECT id, type, message, link, is_read, created_at
         FROM public.client_notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    ),
    db.query(
      `SELECT count(*)::int AS n FROM public.client_notifications
        WHERE user_id = $1 AND is_read = false`,
      [userId],
    ),
  ]);
  return {
    items: list.rows.map((r) => mapClient(r as Record<string, unknown>)),
    unreadCount: Number((unread.rows[0] as { n: number }).n ?? 0),
  };
}

export async function markClientNotificationReadPg(
  db: Queryable,
  userId: string,
  id: string,
): Promise<{ ok: true; found: boolean }> {
  const { rowCount } = await db.query(
    `UPDATE public.client_notifications
        SET is_read = true
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return { ok: true, found: Boolean(rowCount) };
}

export async function markAllClientNotificationsReadPg(
  db: Queryable,
  userId: string,
): Promise<{ ok: true; updated: number }> {
  const { rowCount } = await db.query(
    `UPDATE public.client_notifications
        SET is_read = true
      WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return { ok: true, updated: rowCount ?? 0 };
}

export async function deleteClientNotificationPg(
  db: Queryable,
  userId: string,
  id: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM public.client_notifications WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!rowCount) {
    throw Object.assign(new Error("Уведомление не найдено"), { statusCode: 404 });
  }
}

export async function listAdminNotificationsPg(
  db: Queryable,
  limit = 30,
): Promise<{ items: AdminNotificationRow[]; unreadCount: number }> {
  const [list, unread] = await Promise.all([
    db.query(
      `SELECT id, type, client_id, measurement_id, message, link, is_read, created_at
         FROM public.admin_notifications
        ORDER BY created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    ),
    db.query(
      `SELECT count(*)::int AS n FROM public.admin_notifications WHERE is_read = false`,
    ),
  ]);
  return {
    items: list.rows.map((r) => mapAdmin(r as Record<string, unknown>)),
    unreadCount: Number((unread.rows[0] as { n: number }).n ?? 0),
  };
}

export async function markAdminNotificationReadPg(
  db: Queryable,
  id: string,
): Promise<{ ok: true; found: boolean }> {
  const { rowCount } = await db.query(
    `UPDATE public.admin_notifications SET is_read = true WHERE id = $1`,
    [id],
  );
  return { ok: true, found: Boolean(rowCount) };
}

export async function markAllAdminNotificationsReadPg(
  db: Queryable,
): Promise<{ ok: true; updated: number }> {
  const { rowCount } = await db.query(
    `UPDATE public.admin_notifications SET is_read = true WHERE is_read = false`,
  );
  return { ok: true, updated: rowCount ?? 0 };
}

export async function deleteAdminNotificationPg(db: Queryable, id: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM public.admin_notifications WHERE id = $1`, [
    id,
  ]);
  if (!rowCount) {
    throw Object.assign(new Error("Уведомление не найдено"), { statusCode: 404 });
  }
}
