import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isEnrollmentUnlocked } from "@/lib/auth";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { JourneyStepper } from "@/components/panel/JourneyStepper";
import { SectionHint } from "@/components/panel/Hints";
import { ArrowRight, Clock, ClipboardList, Sparkles, User, LineChart as LineChartIcon, PartyPopper, X, Ticket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardOverview,
});

type Profile = {
  full_name: string | null;
  goal: string | null;
  height_cm: number | null;
};

type Measurement = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
};

function DashboardOverview() {
  const {
    effectiveUserId,
    effectiveAccessStatus,
    effectiveUnlockSource,
    effectiveRole,
    user,
  } = useAuth();
  const enrollmentOk = isEnrollmentUnlocked(
    effectiveAccessStatus,
    effectiveUnlockSource,
    effectiveRole,
    user?.email,
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [accessNotif, setAccessNotif] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    void supabase
      .from("profiles")
      .select("full_name, goal, height_cm")
      .eq("id", effectiveUserId)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));

    void supabase
      .from("measurements")
      .select("id, measured_on, weight_kg, waist_cm")
      .eq("user_id", effectiveUserId)
      .order("measured_on", { ascending: false })
      .limit(5)
      .then(({ data }) => setMeasurements((data ?? []) as Measurement[]));

    void supabase
      .from("onboarding_responses")
      .select("completed_at")
      .eq("user_id", effectiveUserId)
      .maybeSingle()
      .then(({ data }) => setOnboardingDone(Boolean((data as { completed_at?: string } | null)?.completed_at)));

    void supabase
      .from("client_notifications")
      .select("id, message")
      .eq("user_id", effectiveUserId)
      .eq("type", "access_granted")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setAccessNotif(data as { id: string; message: string });
      });
  }, [effectiveUserId]);

  const dismissAccessNotif = async () => {
    if (!accessNotif) return;
    const id = accessNotif.id;
    setAccessNotif(null);
    await supabase.from("client_notifications").update({ is_read: true }).eq("id", id);
  };


  const latest = measurements[0];
  const previous = measurements[1];
  const weightDelta =
    latest?.weight_kg != null && previous?.weight_kg != null
      ? +(latest.weight_kg - previous.weight_kg).toFixed(1)
      : null;

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Личный кабинет"
        title={`Добро пожаловать${profile?.full_name ? `, ${profile.full_name}` : ""}`}
        description="Здесь вы шаг за шагом идёте к цели. Подсказки ниже подскажут, что делать сейчас."
      />

      <JourneyStepper
        accessStatus={effectiveAccessStatus}
        onboardingDone={Boolean(onboardingDone)}
        measurementsCount={measurements.length}
      />

      {/* Крупная приветственная карточка для новичков */}
      {onboardingDone === false &&
        (effectiveAccessStatus === "pending_onboarding" || !effectiveAccessStatus) &&
        !enrollmentOk && (
        <section className="overflow-hidden rounded-3xl border border-coral/30 bg-gradient-to-br from-coral/15 via-background/40 to-gold/15 p-6 md:p-8">
          <p className="eyebrow">Доступ по приглашению</p>
          <h2 className="mt-2 font-display text-2xl text-ivory md:text-3xl">
            Нужен промокод после оплаты
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-warm-gray">
            Регистрация и анкета открываются после оплаты. Если оплатили наличными — введите
            промокод, который выдал тренер.
          </p>
          <Link
            to="/auth"
            search={{ mode: "promo" }}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            <Ticket className="h-4 w-4" /> Ввести промокод
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {onboardingDone === false &&
        (effectiveAccessStatus === "pending_onboarding" || !effectiveAccessStatus) &&
        enrollmentOk && (
        <section className="overflow-hidden rounded-3xl border border-coral/30 bg-gradient-to-br from-coral/15 via-background/40 to-gold/15 p-6 md:p-8">
          <p className="eyebrow">Первый шаг</p>
          <h2 className="mt-2 font-display text-2xl text-ivory md:text-3xl">
            Заполните анкету — и мы соберём программу под вас
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-warm-gray">
            Это займёт 5–7 минут. Расскажите о цели, здоровье и привычках — тренер составит план
            тренировок и питания именно под вас. Курс и замеры откроются после допуска тренера.
          </p>
          <ol className="mt-5 grid gap-3 text-sm text-warm-gray md:grid-cols-3">
            <li className="rounded-2xl border border-gold/15 bg-background/40 p-4">
              <span className="text-gold">1.</span> Ответьте на вопросы анкеты
            </li>
            <li className="rounded-2xl border border-gold/15 bg-background/40 p-4">
              <span className="text-gold">2.</span> Тренер проверит и назначит программу
            </li>
            <li className="rounded-2xl border border-gold/15 bg-background/40 p-4">
              <span className="text-gold">3.</span> Вы начинаете курс и ведёте замеры
            </li>
          </ol>
          <Link
            to="/dashboard/onboarding"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            <ClipboardList className="h-4 w-4" /> Заполнить анкету
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      {effectiveAccessStatus === "awaiting_approval" && (
        <div className="flex items-start gap-4 rounded-3xl border border-gold/25 bg-gradient-to-r from-gold/10 via-transparent to-coral/10 p-6">
          <div className="rounded-2xl bg-gold/20 p-3 text-gold">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="eyebrow">Анкета отправлена</p>
            <p className="mt-1 font-display text-lg text-ivory">
              Тренер проверяет вашу анкету
            </p>
            <p className="mt-1 text-sm text-warm-gray">
              Обычно это занимает 1–2 дня. Пока можно заполнить профиль — так тренер узнает вас лучше.
            </p>
            <Link
              to="/dashboard/profile"
              className="mt-3 inline-flex items-center gap-2 text-sm text-gold hover:text-ivory"
            >
              <User className="h-4 w-4" /> Открыть профиль <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {accessNotif && effectiveAccessStatus === "active" && (
        <div className="relative flex items-start gap-4 rounded-3xl border border-gold/40 bg-gradient-to-r from-gold/15 via-coral/10 to-gold/15 p-6">
          <div className="rounded-2xl bg-gold/25 p-3 text-gold">
            <PartyPopper className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="eyebrow text-gold">Доступ открыт</p>
            <p className="mt-1 font-display text-lg text-ivory">{accessNotif.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/dashboard/training"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2 text-sm font-medium text-background hover:scale-[1.02]"
              >
                К тренировкам <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/dashboard/nutrition"
                className="inline-flex items-center gap-2 rounded-full border border-gold/40 px-5 py-2 text-sm text-ivory hover:bg-gold/10"
              >
                К питанию
              </Link>
            </div>
          </div>
          <button
            onClick={dismissAccessNotif}
            className="rounded-full p-1 text-warm-gray hover:bg-background/40 hover:text-ivory"
            aria-label="Скрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}



      <AccessGate level="onboarding_submitted">
        <div className="space-y-8">
          <SectionHint tone="tip" title="Быстрая подсказка">
            Раз в неделю добавляйте замеры в разделе «Прогресс» — это главный источник вашей
            динамики. Цель храните в профиле — она будет вести вас каждый день.
          </SectionHint>


      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Текущий вес"
          value={latest?.weight_kg != null ? `${latest.weight_kg} кг` : "—"}
          hint={
            weightDelta != null
              ? `${weightDelta > 0 ? "+" : ""}${weightDelta} кг с прошлого замера`
              : "Добавьте первый замер"
          }
          tone="gold"
        />
        <StatCard
          label="Талия"
          value={latest?.waist_cm != null ? `${latest.waist_cm} см` : "—"}
          tone="coral"
        />
        <StatCard label="Рост" value={profile?.height_cm ? `${profile.height_cm} см` : "—"} />
        <StatCard label="Замеров" value={String(measurements.length)} />
      </div>

      <section className="rounded-3xl border border-gold/15 bg-gradient-to-br from-coral/10 via-transparent to-gold/10 p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-gold/20 p-3 text-gold">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="eyebrow">Моя цель</p>
            <p className="mt-2 font-display text-2xl text-ivory">
              {profile?.goal || "Цель ещё не задана"}
            </p>
            <p className="mt-2 text-sm text-warm-gray">
              Задайте цель в профиле — она будет вести вас каждый день.
            </p>
            <Link
              to="/dashboard/profile"
              className="mt-4 inline-flex items-center gap-2 text-sm text-gold hover:text-ivory"
            >
              Обновить профиль <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between">
          <div>
            <p className="eyebrow">Последние замеры</p>
            <h2 className="mt-2 font-display text-2xl">Ваша динамика</h2>
          </div>
          <Link
            to="/dashboard/progress"
            className="inline-flex items-center gap-2 text-sm text-gold hover:text-ivory"
          >
            Все замеры <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-gold/15">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface/50 text-[11px] uppercase tracking-widest text-warm-gray">
              <tr>
                <th className="px-5 py-3">Дата</th>
                <th className="px-5 py-3">Вес</th>
                <th className="px-5 py-3">Талия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {measurements.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-warm-gray">
                    Пока пусто —{" "}
                    <Link to="/dashboard/progress" className="text-gold hover:text-ivory">
                      добавьте первый замер <LineChartIcon className="inline h-3 w-3" />
                    </Link>
                  </td>
                </tr>

              ) : (
                measurements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-ivory">
                      {new Date(m.measured_on).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="px-5 py-3 text-warm-gray">
                      {m.weight_kg != null ? `${m.weight_kg} кг` : "—"}
                    </td>
                    <td className="px-5 py-3 text-warm-gray">
                      {m.waist_cm != null ? `${m.waist_cm} см` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
        </div>
      </AccessGate>
    </div>
  );
}
