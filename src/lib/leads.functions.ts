import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const leadInputSchema = z.object({
  full_name: z.string().trim().min(2, "Укажите фамилию и имя").max(120),
  age: z.coerce.number().int().min(14, "Минимум 14 лет").max(100),
  phone: z
    .string()
    .trim()
    .min(10, "Укажите телефон")
    .max(32)
    .regex(/^[+\d\s()-]+$/, "Некорректный телефон"),
  email: z.string().trim().email("Укажите действующий email").max(255),
  messenger: z.enum(["telegram", "max", "whatsapp", "any"]),
  source: z.enum(["general", "program", "question"]).default("general"),
  program_slug: z.string().max(80).nullable().optional(),
  program_title: z.string().max(120).nullable().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
  /** Honeypot — bots fill this; humans leave empty */
  website: z.string().max(200).optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

const MESSENGER_LABEL: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  any: "Любой мессенджер",
};

async function notifyTelegram(text: string) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatIdRaw = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatIdRaw) {
    console.warn("[leads] Telegram not configured", {
      hasToken: Boolean(token),
      hasChatId: Boolean(chatIdRaw),
    });
    return { ok: false as const, reason: "telegram_not_configured" };
  }

  // Numeric chat ids must be numbers for Telegram API
  const chat_id = /^-?\d+$/.test(chatIdRaw) ? Number(chatIdRaw) : chatIdRaw;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text,
        disable_web_page_preview: true,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("[leads] Telegram notify failed", res.status, body);
      return { ok: false as const, reason: "telegram_failed", detail: body };
    }
    console.info("[leads] Telegram notify ok");
    return { ok: true as const };
  } catch (e) {
    console.error("[leads] Telegram network error", e);
    return { ok: false as const, reason: "telegram_network" };
  }
}

async function notifyEmailSmtp(subject: string, text: string, replyTo?: string) {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  const to = (process.env.LEAD_NOTIFY_EMAIL || "panova.fortuna@gmail.com").trim();
  const fromName = (process.env.LEAD_NOTIFY_FROM_NAME || "PanovaPRO").trim();
  const port = Number(process.env.SMTP_PORT || "465");

  if (!host || !user || !pass) {
    return { ok: false as const, reason: "smtp_not_configured" };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${user}>`,
      to,
      replyTo: replyTo || undefined,
      subject,
      text,
    });
    console.info("[leads] SMTP email notify ok →", to);
    return { ok: true as const };
  } catch (e) {
    console.error("[leads] SMTP email error", e);
    return {
      ok: false as const,
      reason: "smtp_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function notifyEmailResend(subject: string, text: string, replyTo?: string) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const to = (process.env.LEAD_NOTIFY_EMAIL || "panova.fortuna@gmail.com").trim();
  const from = (process.env.LEAD_NOTIFY_FROM || "PanovaPRO <onboarding@resend.dev>").trim();
  if (!apiKey || apiKey.includes("...")) {
    return { ok: false as const, reason: "email_not_configured" };
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
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("[leads] Resend notify failed", res.status, body);
      return { ok: false as const, reason: "email_failed", detail: body };
    }
    console.info("[leads] Resend email notify ok");
    return { ok: true as const };
  } catch (e) {
    console.error("[leads] Resend network error", e);
    return { ok: false as const, reason: "email_network" };
  }
}

/** Prefer Gmail/SMTP; fall back to Resend if configured */
async function notifyEmail(subject: string, text: string, replyTo?: string) {
  const smtp = await notifyEmailSmtp(subject, text, replyTo);
  if (smtp.ok) return smtp;
  if (smtp.reason !== "smtp_not_configured") return smtp;
  return notifyEmailResend(subject, text, replyTo);
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

/** Public: submit lead from landing / program pages */
export const submitLead = createServerFn({ method: "POST" })
  .validator((input: unknown) => leadInputSchema.parse(input))
  .handler(async ({ data }) => {
    if (data.website) {
      // Bot filled honeypot — pretend success
      return { ok: true, id: null as string | null };
    }

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

    const [tg, mail] = await Promise.all([
      notifyTelegram(text),
      notifyEmail(subject, text, data.email),
    ]);
    const notified = tg.ok || mail.ok;
    if (!notified) {
      console.warn("[leads] Lead saved but notify failed", {
        telegram: tg.reason,
        email: mail.reason,
      });
    }

    return {
      ok: true,
      id: inserted.id as string,
      notified,
      notify: {
        telegram: tg.ok,
        email: mail.ok,
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
