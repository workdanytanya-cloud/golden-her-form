import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { loadRuntimeConfig, selfhostMe } from "@/lib/selfhost/client-api";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const runtime = await loadRuntimeConfig();
    if (runtime.authBackend === "local") {
      const me = await selfhostMe();
      if (!me.session) {
        throw redirect({
          to: "/auth",
          search: { redirect: location.href },
        });
      }
      return { user: { id: me.session.userId, email: me.session.email } };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
