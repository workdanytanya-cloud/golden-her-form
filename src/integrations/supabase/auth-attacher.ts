import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";
import { loadRuntimeConfig } from "@/lib/selfhost/client-api";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const runtime = await loadRuntimeConfig();
  if (runtime.authBackend === "local") {
    return next({ headers: {} });
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
