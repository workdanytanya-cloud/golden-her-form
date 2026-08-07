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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false as const, reason: "telegram_not_configured" };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Telegram notify failed", body);
    return { ok: false as const, reason: "telegram_failed" };
  }
  return { ok: true as const };
}

async function notifyEmail(subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_NOTIFY_EMAIL || "panova.fortuna@gmail.com";
  const from = process.env.LEAD_NOTIFY_FROM || "PanovaPRO <onboarding@resend.dev>";
  if (!apiKey) return { ok: false as const, reason: "email_not_configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Email notify failed", body);
    return { ok: false as const, reason: "email_failed" };
  }
  return { ok: true as const };
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

    const [tg, mail] = await Promise.all([notifyTelegram(text), notifyEmail(subject, text)]);
    if (!tg.ok && !mail.ok) {
      console.warn("Lead saved but no notify channel configured", { tg, mail });
    }

    return { ok: true, id: inserted.id as string };
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
