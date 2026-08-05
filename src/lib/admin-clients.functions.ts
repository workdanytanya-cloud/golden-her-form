import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminUpdateClientPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; password: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        password: z.string().min(8).max(72),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Нельзя удалить свой собственный аккаунт");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Best-effort cleanup for tables without ON DELETE CASCADE
    const uid = data.userId;
    await supabaseAdmin.from("admin_notifications").delete().eq("client_id", uid);
    await supabaseAdmin.from("onboarding_responses").delete().eq("user_id", uid);
    await supabaseAdmin.from("nutrition_plans").delete().eq("user_id", uid);
    await supabaseAdmin.from("client_access").delete().eq("user_id", uid);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUpdateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      userId: string;
      full_name?: string | null;
      phone?: string | null;
      goal?: string | null;
      height_cm?: number | null;
      birth_date?: string | null;
      gender?: string | null;
    }) =>
      z
        .object({
          userId: z.string().uuid(),
          full_name: z.string().max(100).nullable().optional(),
          phone: z.string().max(50).nullable().optional(),
          goal: z.string().max(300).nullable().optional(),
          height_cm: z.number().min(80).max(260).nullable().optional(),
          birth_date: z.string().nullable().optional(),
          gender: z.string().max(20).nullable().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, ...patch } = data;
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminExportContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .order("created_at", { ascending: false });
    if (pErr) throw new Error(pErr.message);

    // Fetch emails via Auth Admin API (paginated)
    const emailMap = new Map<string, string>();
    let page = 1;
    const perPage = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        if (u.email) emailMap.set(u.id, u.email);
      }
      if (data.users.length < perPage) break;
      page += 1;
      if (page > 20) break;
    }

    // Exclude admins from the export
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = new Set((adminRoles ?? []).map((r: { user_id: string }) => r.user_id));

    const rows = (profiles ?? [])
      .filter((p) => !adminIds.has(p.id))
      .map((p) => ({
        full_name: p.full_name ?? "",
        phone: p.phone ?? "",
        email: emailMap.get(p.id) ?? "",
        created_at: p.created_at,
      }));

    return { rows };
  });

