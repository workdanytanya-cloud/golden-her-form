import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClipboardList, LayoutDashboard, LineChart, Lock, User } from "lucide-react";
import { PanelShell, type PanelNavItem } from "@/components/panel/PanelShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ACCESS_STATUS_LABEL, isAccessStatus, type AccessStatus } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const ONBOARDING_PATH = "/dashboard/onboarding";

function DashboardLayout() {
  const { user, role } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (role === "admin") {
      setStatus("active");
      setLoaded(true);
      return;
    }
    void supabase
      .from("client_access")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const s = (data as { status?: string } | null)?.status;
        setStatus(isAccessStatus(s) ? s : "pending_onboarding");
        setLoaded(true);
      });

    const channel = supabase
      .channel(`client_access:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "client_access",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const s = (payload.new as { status?: string } | null)?.status;
          if (isAccessStatus(s)) setStatus(s);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, role]);

  const isActiveAccess = status === "active" || role === "admin";
  const isOnboardingPage = pathname === ONBOARDING_PATH;

  const nav: PanelNavItem[] = [
    {
      to: "/dashboard",
      label: "Обзор",
      icon: <LayoutDashboard className="h-4 w-4" />,
      exact: true,
      disabled: !isActiveAccess,
    },
    {
      to: "/dashboard/onboarding",
      label: "Анкета",
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      to: "/dashboard/progress",
      label: "Прогресс",
      icon: <LineChart className="h-4 w-4" />,
      disabled: !isActiveAccess,
    },
    {
      to: "/dashboard/profile",
      label: "Профиль",
      icon: <User className="h-4 w-4" />,
      disabled: !isActiveAccess,
    },
  ];

  const showLock = loaded && !isActiveAccess && !isOnboardingPage;

  return (
    <PanelShell nav={nav}>
      {!loaded ? (
        <div className="py-24 text-center text-warm-gray">Загрузка…</div>
      ) : showLock ? (
        <LockedScreen status={status ?? "pending_onboarding"} />
      ) : (
        <Outlet />
      )}
    </PanelShell>
  );
}

function LockedScreen({ status }: { status: AccessStatus }) {
  const isPending = status === "pending_onboarding";
  const isPaused = status === "paused";
  const title = isPending
    ? "Заполните первичную анкету"
    : isPaused
      ? "Сопровождение на паузе"
      : "Ждём подтверждения тренера";
  const description = isPending
    ? "Разделы кабинета откроются, как только вы отправите анкету и тренер согласует ваше сопровождение."
    : isPaused
      ? "Ваш доступ временно приостановлен. Свяжитесь с тренером, чтобы продолжить сопровождение."
      : "Анкета получена. Тренер свяжется с вами и активирует доступ к разделам кабинета в ближайшее время.";

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="rounded-3xl border border-gold/20 bg-gradient-to-br from-coral/10 via-transparent to-gold/10 p-8 md:p-12">
        <div className="flex flex-col items-center text-center">
          <div className="rounded-2xl bg-gold/15 p-4 text-gold">
            <Lock className="h-6 w-6" />
          </div>
          <p className="mt-6 text-[11px] uppercase tracking-widest text-gold">
            {ACCESS_STATUS_LABEL[status]}
          </p>
          <h1 className="mt-2 font-display text-3xl text-ivory md:text-4xl">{title}</h1>
          <p className="mt-4 max-w-xl text-sm text-warm-gray">{description}</p>

          {isPending && (
            <Link
              to="/dashboard/onboarding"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
            >
              <ClipboardList className="h-4 w-4" /> Перейти к анкете
            </Link>
          )}

          <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
            <Step done label="Регистрация" />
            <Step done={status !== "pending_onboarding"} label="Анкета" />
            <Step done={status === "active"} label="Подтверждение тренера" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div
      className={[
        "rounded-2xl border p-4 text-sm transition-colors",
        done ? "border-gold/40 bg-gold/10 text-ivory" : "border-gold/15 bg-background/40 text-warm-gray",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span
          className={[
            "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
            done ? "bg-gold text-background" : "bg-warm-gray/25 text-warm-gray",
          ].join(" ")}
        >
          {done ? "✓" : "·"}
        </span>
        <span className="font-medium">{label}</span>
      </div>
    </div>
  );
}
