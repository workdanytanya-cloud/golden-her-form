import fs from "node:fs";
import path from "node:path";
import { isProduction } from "@/lib/selfhost/config";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type MailSendResult =
  | { ok: true; transport: "file" | "smtp" | "resend" }
  | { ok: false; reason: string };

/** Trusted public site origin for recovery links (no trailing slash). */
export function getPublicAppUrl(): string | null {
  const raw =
    readEnv("SELFHOST_PUBLIC_URL") ||
    readEnv("PUBLIC_APP_URL") ||
    readEnv("APP_URL");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function getMailTransport(): "file" | "smtp" | "resend" | "none" {
  const explicit = readEnv("SELFHOST_MAIL_TRANSPORT")?.toLowerCase();
  if (explicit === "file" || explicit === "capture") return "file";
  if (explicit === "smtp") return "smtp";
  if (explicit === "resend") return "resend";
  if (explicit === "none") return "none";
  // Auto: prefer file only outside production when directory is set or NODE_ENV=test.
  if (!isProduction() && (readEnv("SELFHOST_MAIL_DIR") || process.env.NODE_ENV === "test")) {
    return "file";
  }
  if (readEnv("RESEND_API_KEY") && !readEnv("RESEND_API_KEY")!.includes("...")) return "resend";
  if (readEnv("SMTP_ENABLED") === "1") return "smtp";
  return "none";
}

export function mailCatcherDir(): string {
  return (
    readEnv("SELFHOST_MAIL_DIR") ||
    path.resolve(process.cwd(), ".selfhost-mail-catcher")
  );
}

async function sendFile(message: MailMessage): Promise<MailSendResult> {
  const dir = mailCatcherDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${Math.random().toString(36).slice(2, 8)}.json`);
  // Local interceptor only — not a production delivery channel.
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...message,
        capturedAt: new Date().toISOString(),
        transport: "file",
        note: "LOCAL_MAIL_CATCHER_NOT_FOR_PRODUCTION",
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, transport: "file" };
}

async function sendSmtp(message: MailMessage): Promise<MailSendResult> {
  if (readEnv("SMTP_ENABLED") !== "1") {
    return { ok: false, reason: "smtp_skipped" };
  }
  const host = readEnv("SMTP_HOST");
  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASS");
  const fromName = readEnv("SELFHOST_MAIL_FROM_NAME") || readEnv("LEAD_NOTIFY_FROM_NAME") || "PanovaPRO";
  const port = Number(readEnv("SMTP_PORT") || "465");
  if (!host || !user || !pass) return { ok: false, reason: "smtp_not_configured" };

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  await transporter.sendMail({
    from: `"${fromName}" <${user}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  return { ok: true, transport: "smtp" };
}

async function sendResend(message: MailMessage): Promise<MailSendResult> {
  const apiKey = readEnv("RESEND_API_KEY");
  const from =
    readEnv("SELFHOST_MAIL_FROM") ||
    readEnv("LEAD_NOTIFY_FROM") ||
    "PanovaPRO <onboarding@resend.dev>";
  if (!apiKey || apiKey.includes("...")) return { ok: false, reason: "resend_not_configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    // Do not log message body (may contain reset URL/token).
    console.error("[selfhost-mail] Resend failed", res.status);
    return { ok: false, reason: "resend_failed" };
  }
  return { ok: true, transport: "resend" };
}

/**
 * Deliver password-reset (or other) email.
 * Never logs the message body — it may contain a recovery URL.
 */
export async function sendSelfhostMail(message: MailMessage): Promise<MailSendResult> {
  const transport = getMailTransport();
  try {
    if (transport === "file") return await sendFile(message);
    if (transport === "resend") return await sendResend(message);
    if (transport === "smtp") return await sendSmtp(message);
    return { ok: false, reason: "mail_not_configured" };
  } catch (e) {
    console.error(
      "[selfhost-mail] delivery error",
      e instanceof Error ? e.message : "unknown",
    );
    return { ok: false, reason: "mail_failed" };
  }
}

export function describeMailConfigForOps(): {
  transport: string;
  publicAppUrlConfigured: boolean;
  productionReady: boolean;
  blocker: string | null;
} {
  const transport = getMailTransport();
  const publicAppUrlConfigured = Boolean(getPublicAppUrl());
  const productionReady =
    publicAppUrlConfigured && (transport === "smtp" || transport === "resend");
  let blocker: string | null = null;
  if (!publicAppUrlConfigured) {
    blocker = "SELFHOST_PUBLIC_URL (или PUBLIC_APP_URL) не задан";
  } else if (transport === "none" || transport === "file") {
    blocker =
      "Боевая доставка писем не настроена: задайте RESEND_API_KEY + SELFHOST_MAIL_FROM или SMTP_ENABLED=1 с SMTP_HOST/USER/PASS. SELFHOST_MAIL_TRANSPORT=file — только локальный перехватчик.";
  }
  return { transport, publicAppUrlConfigured, productionReady, blocker };
}
