import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Проверка admin через user_roles — без public.has_role RPC (revoked у authenticated). */
export async function assertAdmin(ctx: {
  supabase: SupabaseClient<Database>;
  userId: string;
}) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}
