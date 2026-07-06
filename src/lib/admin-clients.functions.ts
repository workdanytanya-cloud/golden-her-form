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
  .inputValidator((input: { userId: string; password: string }) =>
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
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("Нельзя удалить свой собственный аккаунт");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUpdateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
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
