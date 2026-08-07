import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import fs from "node:fs";
import path from "node:path";

/** Bump when changing notify logic — must appear in toast / logs */
export const LEADS_BUILD = "webhook-v1";

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const leadInputSchema = z.object({
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
});

export type LeadInput = z.infer<typeof leadInputSchema>;

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let cachedFileEnv: Record<string, string> | null = null;
let cachedFileEnvPath: string | null = null;

function loadFileEnv(): Record<string, string> {
  if (cachedFileEnv) return cachedFileEnv;
  const candidates = [
    path.join(process.cwd(), ".env"),
    "/var/www/panovapro/.env",
    path.resolve(".env"),
  ];
  for (const file of candidates) {
    try {
      const parsed = parseEnvFile(file);
      if (Object.keys(parsed).length > 0) {
        cachedFileEnv = parsed;
        cachedFileEnvPath = file;
        return parsed;
      }
    } catch {
      /* try next */
    }
  }
  cachedFileEnv = {};
  cachedFileEnvPath = null;
  return cachedFileEnv;
}

/** process.env first, then .env on disk (fixes PM2 not injecting custom keys) */
function envGet(key: string): string {
  const fromProcess = String(
    (process.env as Record<string, string | undefined>)[key] ?? "",
  ).trim();
  if (fromProcess) return fromProcess;
  return String(loadFileEnv()[key] ?? "").trim();
}

const MESSENGER_LABEL: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  any: "Любой мессенджер",
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: T,
): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(onTimeout), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(onTimeout);
      });
  });
}

type NotifyResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

/** HTTPS webhook (Make.com / n8n / Albato) — works from RU VPS when Telegram/Gmail are blocked */
async function notifyWebhook(
  text: string,
  data: z.infer<typeof leadInputSchema>,
  leadId: string,
): Promise<NotifyResult> {
  const url = envGet("LEAD_WEBHOOK_URL");
  if (!url) {
    return { ok: false, reason: "webhook_not_configured" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lead_id: leadId,
        full_name: data.full_name,
        age: data.age,
        phone: data.phone,
        email: data.email,
        messenger: data.messenger,
        source: data.source,
        program_slug: data.program_slug ?? null,
        program_title: data.program_title ?? null,
        message: data.message ?? null,
      }),
      signal: abortAfter(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[leads] Webhook failed", res.status, body);
      return { ok: false, reason: "webhook_failed", detail: body.slice(0, 200) };
    }
    console.info("[leads] Webhook notify ok");
    return { ok: true };
  } catch (e) {
    console.error("[leads] Webhook network error", e);
    return {
      ok: false,
      reason: "webhook_network",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function notifyTelegram(text: string): Promise<NotifyResult> {
  const token = envGet("TELEGRAM_BOT_TOKEN");
  const chatIdRaw = envGet("TELEGRAM_CHAT_ID");
  if (!token || !chatIdRaw) {
    return { ok: false, reason: "telegram_not_configured" };
  }

  const chat_id = /^-?\d+$/.test(chatIdRaw) ? Number(chatIdRaw) : chatIdRaw;
  // On RU VPS api.telegram.org is often blocked — set TELEGRAM_API_BASE to a proxy if needed
  const apiBase = (
    envGet("TELEGRAM_API_BASE") || "https://api.telegram.org"
  ).replace(/\/$/, "");

  try {
    const res = await fetch(`${apiBase}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text,
        disable_web_page_preview: true,
      }),
      signal: abortAfter(8000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("[leads] Telegram notify failed", res.status, body);
      return { ok: false, reason: "telegram_failed", detail: body };
    }
    console.info("[leads] Telegram notify ok");
    return { ok: true };
  } catch (e) {
    console.error("[leads] Telegram network error", e);
    return {
      ok: false,
      reason: "telegram_network",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function notifyEmailResend(
  subject: string,
  text: string,
  replyTo?: string,
): Promise<NotifyResult> {
  const apiKey = envGet("RESEND_API_KEY");
  const to = envGet("LEAD_NOTIFY_EMAIL") || "panova.fortuna@gmail.com";
  const from =
    envGet("LEAD_NOTIFY_FROM") || "PanovaPRO <onboarding@resend.dev>";
  if (!apiKey || apiKey.includes("...")) {
    return { ok: false, reason: "email_not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo || undefined,
        subject,
        text,
      }),
      signal: abortAfter(8000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("[leads] Resend notify failed", res.status, body);
      return { ok: false, reason: "email_failed", detail: body };
    }
    console.info("[leads] Resend email notify ok");
    return { ok: true };
  } catch (e) {
    console.error("[leads] Resend network error", e);
    return {
      ok: false,
      reason: "email_network",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function notifyEmailSmtp(
  subject: string,
  text: string,
  replyTo?: string,
): Promise<NotifyResult> {
  // Gmail SMTP from Timeweb/RU VPS usually fails — enable only with SMTP_ENABLED=1
  if (envGet("SMTP_ENABLED") !== "1") {
    return { ok: false, reason: "smtp_skipped" };
  }

  const host = envGet("SMTP_HOST");
  const user = envGet("SMTP_USER");
  const pass = envGet("SMTP_PASS");
  const to = envGet("LEAD_NOTIFY_EMAIL") || "panova.fortuna@gmail.com";
  const fromName = envGet("LEAD_NOTIFY_FROM_NAME") || "PanovaPRO";
  const port = Number(envGet("SMTP_PORT") || "465");

  if (!host || !user || !pass) {
    return { ok: false, reason: "smtp_not_configured" };
  }

  try {
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
      to,
      replyTo: replyTo || undefined,
      subject,
      text,
    });
    console.info("[leads] SMTP email notify ok →", to);
    return { ok: true };
  } catch (e) {
    console.error("[leads] SMTP email error", e);
    return {
      ok: false,
      reason: "smtp_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function notifyEmail(
  subject: string,
  text: string,
  replyTo?: string,
): Promise<NotifyResult> {
  const resend = await notifyEmailResend(subject, text, replyTo);
  if (resend.ok || resend.reason !== "email_not_configured") return resend;
  return notifyEmailSmtp(subject, text, replyTo);
}

function formatLeadMessage(data: z.infer<typeof leadInputSchema>) {
  const lines = [
    "🆕 Новая заявка PanovaPRO",
    "",
    `Имя: ${data.full_name}`,
    `Возраст: ${data.age}`,
    `Телефон: ${data.phone}`,
    `Email: ${data.email}`,
    `Мессенджер: ${MESSENGER_LABEL[data.messenger] ?? data.messenger}`,
    `Источник: ${data.source}`,
  ];
  if (data.program_title) lines.push(`Программа: ${data.program_title}`);
  if (data.program_slug) lines.push(`Slug: ${data.program_slug}`);
  if (data.message) lines.push(`Сообщение: ${data.message}`);
  return lines.join("\n");
}

export const submitLead = createServerFn({ method: "POST" })
  .validator((input: unknown) => leadInputSchema.parse(input))
  .handler(async ({ data }) => {
    if (data.website) {
      return { ok: true, id: null as string | null, build: LEADS_BUILD };
    }

    // Force (re)load .env from disk each submit in case PM2 started without env
    cachedFileEnv = null;
    loadFileEnv();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      full_name: data.full_name,
      age: data.age,
      phone: data.phone.replace(/\s+/g, " ").trim(),
      email: data.email.toLowerCase(),
      messenger: data.messenger,
      source: data.source,
      program_slug: data.program_slug ?? null,
      program_title: data.program_title ?? null,
      message: data.message?.trim() || null,
      status: "new" as const,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from("leads")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("lead insert", error);
      throw new Error("Не удалось сохранить заявку. Попробуйте ещё раз.");
    }

    const text = formatLeadMessage(data);
    const subject = data.program_title
      ? `Заявка: ${data.full_name} — ${data.program_title}`
      : `Новая заявка: ${data.full_name}`;

    const envFlags = {
      webhook: Boolean(envGet("LEAD_WEBHOOK_URL")),
      telegramToken: Boolean(envGet("TELEGRAM_BOT_TOKEN")),
      telegramChat: Boolean(envGet("TELEGRAM_CHAT_ID")),
      resend: Boolean(envGet("RESEND_API_KEY")),
      smtpEnabled: envGet("SMTP_ENABLED") === "1",
      envFile: cachedFileEnvPath,
      cwd: process.cwd(),
    };
    console.info(`[leads] NOTIFY_ENV_CHECK ${LEADS_BUILD}`, envFlags);

    const [hook, tg, mail] = await Promise.all([
      withTimeout(notifyWebhook(text, data, inserted.id as string), 12000, {
        ok: false as const,
        reason: "webhook_timeout",
      }),
      withTimeout(notifyTelegram(text), 10000, {
        ok: false as const,
        reason: "telegram_timeout",
      }),
      withTimeout(notifyEmail(subject, text, data.email), 10000, {
        ok: false as const,
        reason: "email_timeout",
      }),
    ]);
    const notified = hook.ok || tg.ok || mail.ok;
    if (!notified) {
      console.warn("[leads] Lead saved but notify failed", {
        webhook: hook.reason,
        telegram: tg.reason,
        email: mail.reason,
      });
    }

    return {
      ok: true,
      id: inserted.id as string,
      build: LEADS_BUILD,
      notified,
      envFlags,
      notify: {
        webhook: hook.ok,
        telegram: tg.ok,
        email: mail.ok,
        webhookReason: hook.ok ? null : hook.reason,
        telegramReason: tg.ok ? null : tg.reason,
        emailReason: mail.ok ? null : mail.reason,
      },
    };
  });

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminUpdateLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; status: string }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "contacted", "converted", "archived"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("leads")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
