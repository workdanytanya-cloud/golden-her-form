import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X, LogOut, Eye } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { NotificationsBell } from "./NotificationsBell";


export type PanelNavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
};

export function PanelShell({
  brandSuffix,
  nav,
  children,
}: {
  brandSuffix?: string;
  nav: PanelNavItem[];
  children: ReactNode;
}) {
  const { signOut, user, role } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const handleSignOut = async () => {
    await signOut();
    toast.success("Вы вышли из аккаунта");
    await navigate({ to: "/" });
  };

  const isActive = (item: PanelNavItem) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");

  return (
    <div className="min-h-screen bg-background text-ivory">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gold/10 bg-background/80 px-4 py-3 backdrop-blur md:hidden">
        <Link to="/" className="font-display text-lg">
          Panova<span className="text-coral">PRO</span>
          {brandSuffix && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-gold">{brandSuffix}</span>
          )}
        </Link>
        <div className="flex items-center gap-2">
          {role === "admin" && <NotificationsBell />}
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-gold/25 p-2 text-ivory"
            aria-label="Меню"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>


      <div className="mx-auto flex max-w-7xl">
        {/* Sidebar */}
        <aside
          className={[
            "fixed inset-y-0 left-0 z-40 w-72 shrink-0 transform border-r border-gold/10 bg-surface/60 backdrop-blur transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="flex h-full flex-col p-6">
            <Link
              to="/"
              className="hidden font-display text-2xl md:block"
              onClick={() => setOpen(false)}
            >
              Panova<span className="text-coral">PRO</span>
              {brandSuffix && (
                <span className="ml-2 text-[10px] uppercase tracking-widest text-gold">
                  {brandSuffix}
                </span>
              )}
            </Link>

            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/15 bg-background/40 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-widest text-warm-gray">
                  {role === "admin" ? "Тренер" : "Клиент"}
                </p>
                <p className="mt-1 truncate font-display text-sm text-ivory">{user?.email}</p>
              </div>
              {role === "admin" && (
                <div className="hidden md:block">
                  <NotificationsBell />
                </div>
              )}
            </div>

            <nav className="mt-8 flex flex-1 flex-col gap-1">
              {nav.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.to}
                    to={item.to as unknown as "/"}
                    onClick={() => setOpen(false)}
                    className={[
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors",
                      active
                        ? "bg-gradient-to-r from-coral/20 to-gold/15 text-ivory ring-1 ring-gold/40"
                        : "text-warm-gray hover:bg-gold/5 hover:text-ivory",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-lg",
                        active ? "bg-gold/25 text-ivory" : "bg-background/50 text-gold",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <button
              onClick={handleSignOut}
              className="mt-6 flex items-center justify-center gap-2 rounded-full border border-gold/30 px-4 py-3 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-coral/15"
            >
              <LogOut className="h-4 w-4" /> Выйти
            </button>
          </div>
        </aside>

        {/* Backdrop on mobile */}
        {open && (
          <button
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-background/70 md:hidden"
          />
        )}

        {/* Main */}
        <main className="min-h-screen flex-1 px-4 py-8 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-gold/10 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl md:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-warm-gray">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "gold" | "coral";
}) {
  const toneCls =
    tone === "gold"
      ? "from-gold/20 to-transparent ring-gold/40"
      : tone === "coral"
        ? "from-coral/20 to-transparent ring-coral/40"
        : "from-surface/60 to-transparent ring-gold/15";
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${toneCls} p-5 ring-1 backdrop-blur`}
    >
      <p className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</p>
      <p className="mt-2 font-display text-2xl text-ivory">{value}</p>
      {hint && <p className="mt-1 text-xs text-warm-gray">{hint}</p>}
    </div>
  );
}
