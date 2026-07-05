import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ClipboardList, LayoutDashboard, LineChart, User, Utensils } from "lucide-react";
import { PanelShell, type PanelNavItem } from "@/components/panel/PanelShell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const nav: PanelNavItem[] = [
  { to: "/dashboard", label: "Обзор", icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { to: "/dashboard/onboarding", label: "Анкета", icon: <ClipboardList className="h-4 w-4" /> },
  { to: "/dashboard/nutrition", label: "Питание", icon: <Utensils className="h-4 w-4" /> },
  { to: "/dashboard/progress", label: "Прогресс", icon: <LineChart className="h-4 w-4" /> },
  { to: "/dashboard/profile", label: "Профиль", icon: <User className="h-4 w-4" /> },
];

function DashboardLayout() {
  return (
    <PanelShell nav={nav}>
      <Outlet />
    </PanelShell>
  );
}
