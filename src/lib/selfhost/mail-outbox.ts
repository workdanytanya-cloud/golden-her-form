import type { Pool, PoolClient } from "pg";
import { getMailTransport, sendSelfhostMail, type MailMessage } from "@/lib/selfhost/mail";
import { getPostgresPool } from "@/lib/selfhost/db";
import { isProduction } from "@/lib/selfhost/config";

type Queryable = Pool | PoolClient;

const PERMANENT = new Set([
  "mail_not_configured",
  "smtp_not_configured",
  "smtp_skipped",
  "resend_not_configured",
]);

export function canDeliverPasswordResetMail(): boolean {
  const transport = getMailTransport();
  if (transport === "smtp" || transport === "resend") return true;
  return transport === "file" && !isProduction();
}

function isPermanent(reason: string): boolean {
  return PERMANENT.has(reason);
}

export async function enqueueOutboxMail(
  db: Queryable,
  input: { kind: string; dedupeKey: string; to: string; subject: string; text: string },
): Promise<void> {
  await db.query(
    `INSERT INTO public.mail_outbox
       (kind, dedupe_key, recipient, subject, body_text, status)
     VALUES ($1,$2,$3,$4,$5,'queued')
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [input.kind, input.dedupeKey, input.to, input.subject, input.text],
  );
}

async function markOutbox(
  db: Queryable,
  id: string,
  status: "queued" | "sent" | "failed",
  reason: string | null,
  delayMinutes: number,
): Promise<void> {
  await db.query(
    `UPDATE public.mail_outbox
        SET status = $2,
            body_text = CASE WHEN $2 = 'queued' THEN body_text ELSE '' END,
            last_error = $3,
            sent_at = CASE WHEN $2 = 'sent' THEN (now() AT TIME ZONE 'utc') ELSE sent_at END,
            next_attempt_at = (now() AT TIME ZONE 'utc') + make_interval(mins => $4),
            updated_at = (now() AT TIME ZONE 'utc')
      WHERE id = $1`,
    [id, status, reason, delayMinutes],
  );
}

export async function flushMailOutbox(db: Pool, limit = 5): Promise<void> {
  const client = await db.connect();
  let claimed: Array<{
    id: string;
    recipient: string;
    subject: string;
    body_text: string;
    attempts: number;
  }> = [];
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, recipient, subject, body_text, attempts
         FROM public.mail_outbox
        WHERE status = 'queued'
          AND next_attempt_at <= (now() AT TIME ZONE 'utc')
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    claimed = rows as typeof claimed;
    for (const row of claimed) {
      await client.query(
        `UPDATE public.mail_outbox
            SET attempts = attempts + 1,
                next_attempt_at = (now() AT TIME ZONE 'utc') + interval '1 day',
                updated_at = (now() AT TIME ZONE 'utc')
          WHERE id = $1`,
        [row.id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code !== "42P01") console.error("[mail-outbox] claim failed", code ?? "error");
    client.release();
    return;
  }
  client.release();

  for (const row of claimed) {
    const message: MailMessage = { to: row.recipient, subject: row.subject, text: row.body_text };
    try {
      const result = await sendSelfhostMail(message);
      if (result.ok) {
        await markOutbox(db, row.id, "sent", null, 0);
        continue;
      }
      const attempts = Number(row.attempts) + 1;
      if (isPermanent(result.reason) || attempts >= 5) {
        await markOutbox(db, row.id, "failed", result.reason, 0);
      } else {
        await markOutbox(db, row.id, "queued", result.reason, Math.min(attempts * 2, 30));
      }
    } catch {
      console.error("[mail-outbox] send failed");
      await markOutbox(db, row.id, "failed", "mail_failed", 0);
    }
  }
}

const workerKey = Symbol.for("panovapro.mailOutboxWorker");

export function startMailOutboxWorker(): void {
  const globalState = globalThis as typeof globalThis & { [workerKey]?: boolean };
  if (globalState[workerKey]) return;
  if (process.env.NODE_ENV === "test") return;
  if (!canDeliverPasswordResetMail()) return;
  globalState[workerKey] = true;
  const timer = setInterval(() => {
    void flushMailOutbox(getPostgresPool()).catch(() => {
      console.error("[mail-outbox] worker tick failed");
    });
  }, 30_000);
  timer.unref?.();
}
