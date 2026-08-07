import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Users, LayoutDashboard, Dumbbell, Utensils, Inbox, Ticket } from "lucide-react";
import { PanelShell, type PanelNavItem } from "@/components/panel/PanelShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/dashboard" });
  },
  component: AdminLayout,
});

const nav: PanelNavItem[] = [
  { to: "/admin", label: "Клиенты", icon: <Users className="h-4 w-4" />, exact: true },
  { to: "/admin/leads", label: "Заявки", icon: <Inbox className="h-4 w-4" /> },
  { to: "/admin/promos", label: "Промокоды", icon: <Ticket className="h-4 w-4" /> },
  { to: "/admin/exercises", label: "Упражнения", icon: <Dumbbell className="h-4 w-4" /> },
  { to: "/admin/dishes", label: "Рационы", icon: <Utensils className="h-4 w-4" /> },
  { to: "/dashboard", label: "Мой кабинет", icon: <LayoutDashboard className="h-4 w-4" /> },
];

function AdminLayout() {
  return (
    <PanelShell brandSuffix="Admin" nav={nav}>
      <Outlet />
    </PanelShell>
  );
}
