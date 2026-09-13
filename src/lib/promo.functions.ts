import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(prefix = "PP"): string {
  let body = "";
  for (let i = 0; i < 6; i++) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${body}`;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}


const createSchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(1),
  label: z.string().trim().max(120).optional().nullable(),
  program_slug: z.string().trim().max(80).optional().nullable(),
  program_title: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

export const adminCreatePromoCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const codes: string[] = [];
    const rows = [];
    for (let i = 0; i < data.count; i++) {
      let code = generateCode();
      // rare collision retry
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!codes.includes(code)) break;
        code = generateCode();
      }
      codes.push(code);
      rows.push({
        code,
        label: data.label || null,
        program_slug: data.program_slug || null,
        program_title: data.program_title || null,
        notes: data.notes || null,
        expires_at: data.expires_at || null,
        created_by: context.userId,
        status: "unused" as const,
      });
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("promo_codes")
      .insert(rows)
      .select("id, code, status, label, program_title, created_at, expires_at");

    if (error) {
      console.error("promo create", error);
      throw new Error("Не удалось создать промокоды");
    }
    return { ok: true as const, codes: inserted ?? [] };
  });

export const adminRevokePromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("promo_codes")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("status", "unused");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminListPromoCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("promo_codes")
      .select(
        "id, created_at, code, label, program_slug, program_title, status, used_by, used_at, expires_at, notes",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { ok: true as const, items: data ?? [] };
  });

const redeemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Введите промокод")
    .max(32, "Слишком длинный код"),
});

/** Activate cabinet access with a one-time promo (cash payment). */
export const redeemPromoCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => redeemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const code = normalizeCode(data.code);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: promo, error: findErr } = await supabaseAdmin
      .from("promo_codes")
      .select("id, status, expires_at, used_by, program_title")
      .eq("code", code)
      .maybeSingle();

    if (findErr) {
      console.error("promo find", findErr);
      throw new Error("Не удалось проверить промокод");
    }
    if (!promo) throw new Error("Промокод не найден");
    if (promo.status === "revoked") throw new Error("Промокод отозван");
    if (promo.status === "used") {
      if (promo.used_by === context.userId) {
        return { ok: true as const, already: true, program_title: promo.program_title };
      }
      throw new Error("Промокод уже использован");
    }
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      throw new Error("Срок действия промокода истёк");
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("promo_codes")
      .update({
        status: "used",
        used_by: context.userId,
        used_at: new Date().toISOString(),
      })
      .eq("id", promo.id)
      .eq("status", "unused")
      .select("id, program_title")
      .maybeSingle();

    if (updErr) {
      console.error("promo redeem", updErr);
      throw new Error("Не удалось активировать промокод");
    }
    if (!updated) {
      throw new Error("Промокод уже использован");
    }

    const { data: existing } = await supabaseAdmin
      .from("client_access")
      .select("status, activated_at, activated_by, unlock_source, notes")
      .eq("user_id", context.userId)
      .maybeSingle();

    // Promo only unlocks enrollment (анкета). Same pipeline as before:
    // pending_onboarding → awaiting_approval → trainer sets active.
    const status =
      existing?.status === "active" ||
      existing?.status === "awaiting_approval" ||
      existing?.status === "suspended"
        ? existing.status
        : "pending_onboarding";

    const now = new Date().toISOString();
    const { error: accessErr } = await supabaseAdmin.from("client_access").upsert(
      {
        user_id: context.userId,
        status,
        unlock_source: "promo",
        activated_at: existing?.activated_at ?? null,
        activated_by: existing?.activated_by ?? null,
        notes: existing?.notes || `Промокод ${code}`,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );

    if (accessErr) {
      console.error("promo access", accessErr);
      throw new Error("Промокод принят, но доступ к анкете не открылся. Напишите тренеру.");
    }

    // Ensure profile row exists
    await supabaseAdmin.from("profiles").upsert(
      { id: context.userId },
      { onConflict: "id" },
    );

    return {
      ok: true as const,
      already: false,
      program_title: updated.program_title,
    };
  });
