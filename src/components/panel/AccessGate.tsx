import { Link } from "@tanstack/react-router";
import { ClipboardList, Clock, Lock, Ticket } from "lucide-react";
import {
  useAuth,
  isEnrollmentUnlocked,
  isTrainerEmail,
  type AccessStatus,
} from "@/lib/auth";

type Level = "onboarding_submitted" | "active";

/**
 * Blocks client sections by client_access.status.
 * - onboarding_submitted: awaiting_approval | active
 * - active: только после допуска тренера (status === 'active')
 * Admins bypass. Missing status treated as pending_onboarding (locked).
 * Without promo/payment unlock, pending users cannot reach the questionnaire.
 */
export function AccessGate({
  level,
  children,
}: {
  level: Level;
  children: React.ReactNode;
}) {
  const {
    effectiveRole,
    effectiveAccessStatus,
    effectiveUnlockSource,
    user,
    loading,
  } = useAuth();

  if (loading) return null;
  if (effectiveRole === "admin" || isTrainerEmail(user?.email)) return <>{children}</>;

  const status: AccessStatus = effectiveAccessStatus ?? "pending_onboarding";
  const unlocked = isEnrollmentUnlocked(
    status,
    effectiveUnlockSource,
    effectiveRole,
    user?.email,
  );

  if (!unlocked) {
    return <NeedPromoCard />;
  }

  if (isAllowed(status, level)) return <>{children}</>;

  return <LockedCard status={status} level={level} />;
}

function isAllowed(status: AccessStatus, level: Level) {
  if (level === "onboarding_submitted") {
    return status === "awaiting_approval" || status === "active";
  }
  return status === "active";
}

function NeedPromoCard() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl border border-gold/20 bg-gradient-to-br from-coral/10 via-transparent to-gold/15 p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
          <Ticket className="h-6 w-6" />
        </div>
        <p className="eyebrow mt-6">Нужен промокод</p>
        <h2 className="mt-3 font-display text-2xl text-ivory md:text-3xl">
          Регистрация и анкета по приглашению
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-warm-gray">
          Доступ к кабинету открывается после оплаты. Если оплатили наличными —
          введите промокод от тренера.
        </p>
        <Link
          to="/auth"
          search={{ mode: "promo" }}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
        >
          <Ticket className="h-4 w-4" /> Ввести промокод
        </Link>
      </div>
    </div>
  );
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
    ? "Разделы курса откроются после анкеты и допуска тренера."
    : isAwaiting && level === "active"
      ? "Анкета отправлена. Курс откроется после проверки тренером."
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
