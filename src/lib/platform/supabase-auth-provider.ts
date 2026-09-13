import type { AuthProvider, AuthSession } from "@/lib/platform/types";
import { supabase } from "@/integrations/supabase/client";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly kind = "supabase" as const;

  async getBrowserSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  async getSessionFromBearerToken(token: string): Promise<AuthSession | null> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || !token || token.split(".").length !== 3) return null;

    const client = createClient<Database>(url, key, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    const { data, error } = await client.auth.getClaims(token);
    const userId = data?.claims?.sub;
    if (error || !userId) return null;

    const { data: roleRow } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    const email = typeof data.claims.email === "string" ? data.claims.email : null;

    return {
      userId,
      email,
      role: roleRow ? "admin" : "client",
    };
  }
}
