import { Link } from "@tanstack/react-router";
import { ClipboardList, Clock, Lock } from "lucide-react";
import { useAuth, type AccessStatus } from "@/lib/auth";

type Level = "onboarding_submitted" | "active";

/**
 * Wraps a section. Blocks access based on client_access.status.
 * - level="onboarding_submitted": needs status in ('awaiting_approval', 'active').
 * - level="active": needs status === 'active' (course).
 * Admins bypass. If accessStatus is null (still loading or admin/unset), pass through.
 */
export function AccessGate({
  level,
  children,
}: {
  level: Level;
  children: React.ReactNode;
}) {
  const { role, accessStatus, loading } = useAuth();

  if (loading) return null;
  if (role === "admin") return <>{children}</>;
  if (!accessStatus) return <>{children}</>;

  const allowed = isAllowed(accessStatus, level);
  if (allowed) return <>{children}</>;

  return <LockedCard status={accessStatus} level={level} />;
}

function isAllowed(status: AccessStatus, level: Level) {
  if (level === "onboarding_submitted") {
    return status === "awaiting_approval" || status === "active";
  }
  return status === "active";
}

function LockedCard({ status, level }: { status: AccessStatus; level: Level }) {
  const isPending = status === "pending_onboarding";
  const isAwaiting = status === "awaiting_approval";
  const isSuspended = status === "suspended";

  const Icon = isPending ? ClipboardList : isAwaiting ? Clock : Lock;

  const eyebrow = isPending
    ? "Раздел закрыт"
    : isAwaiting
      ? "Ожидает подтверждения"
      : isSuspended
        ? "Доступ приостановлен"
        : "Раздел закрыт";

  const title = isPending
    ? "Сначала заполните первичную анкету"
    : isAwaiting && level === "active"
      ? "Тренер проверяет вашу анкету"
      : isSuspended
        ? "Доступ временно ограничен"
        : "Раздел недоступен";

  const description = isPending
    ? "Все разделы личного кабинета откроются после того, как вы заполните и отправите анкету онбординга. На её основе тренер соберёт вашу программу."
    : isAwaiting && level === "active"
      ? "Анкета отправлена. Как только тренер проверит её и назначит вам программу — раздел курса и трекинг прогресса откроются автоматически."
      : isSuspended
        ? "Свяжитесь с тренером, чтобы возобновить доступ."
        : "Обратитесь к тренеру.";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl border border-gold/20 bg-gradient-to-br from-coral/10 via-transparent to-gold/15 p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
          <Icon className="h-6 w-6" />
        </div>
        <p className="eyebrow mt-6">{eyebrow}</p>
        <h2 className="mt-3 font-display text-2xl text-ivory md:text-3xl">{title}</h2>
        <p className="mt-4 text-sm leading-relaxed text-warm-gray">{description}</p>

        {isPending && (
          <Link
            to="/dashboard/onboarding"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            <ClipboardList className="h-4 w-4" /> Заполнить анкету
          </Link>
        )}
      </div>
    </div>
  );
}
