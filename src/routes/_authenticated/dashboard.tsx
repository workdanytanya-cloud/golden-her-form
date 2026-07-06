import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BookOpen, ClipboardList, Dumbbell, LayoutDashboard, LineChart, User, Utensils, Users } from "lucide-react";
import { PanelShell, type PanelNavItem } from "@/components/panel/PanelShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const baseNav: PanelNavItem[] = [
  { to: "/dashboard", label: "Обзор", icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { to: "/dashboard/onboarding", label: "Анкета", icon: <ClipboardList className="h-4 w-4" /> },
  { to: "/dashboard/preparation", label: "Как подготовиться", icon: <BookOpen className="h-4 w-4" /> },
  { to: "/dashboard/nutrition", label: "Питание", icon: <Utensils className="h-4 w-4" /> },
  { to: "/dashboard/training", label: "Тренировки", icon: <Dumbbell className="h-4 w-4" /> },
  { to: "/dashboard/progress", label: "Прогресс", icon: <LineChart className="h-4 w-4" /> },
  { to: "/dashboard/profile", label: "Профиль", icon: <User className="h-4 w-4" /> },
];

const adminNav: PanelNavItem[] = [
  { to: "/admin", label: "Клиенты", icon: <Users className="h-4 w-4" />, exact: true },
  { to: "/admin", label: "Анкеты клиентов", icon: <ClipboardList className="h-4 w-4" />, exact: true },
  { to: "/admin/exercises", label: "Упражнения", icon: <Dumbbell className="h-4 w-4" /> },
  { to: "/admin/dishes", label: "Рационы", icon: <Utensils className="h-4 w-4" /> },
];

function DashboardLayout() {
  const { role } = useAuth();
  const nav = role === "admin" ? [...adminNav, ...baseNav] : baseNav;
  return (
    <PanelShell nav={nav}>
      <Outlet />
    </PanelShell>
  );
}
