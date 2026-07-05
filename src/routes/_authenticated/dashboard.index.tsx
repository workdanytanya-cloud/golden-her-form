import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { JourneyStepper } from "@/components/panel/JourneyStepper";
import { SectionHint } from "@/components/panel/Hints";
import { ArrowRight, Clock, ClipboardList, Sparkles, User, LineChart as LineChartIcon } from "lucide-react";

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
  const { user, accessStatus } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("full_name, goal, height_cm")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));

    void supabase
      .from("measurements")
      .select("id, measured_on, weight_kg, waist_cm")
      .eq("user_id", user.id)
      .order("measured_on", { ascending: false })
      .limit(5)
      .then(({ data }) => setMeasurements((data ?? []) as Measurement[]));

    void supabase
      .from("onboarding_responses")
      .select("completed_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setOnboardingDone(Boolean((data as { completed_at?: string } | null)?.completed_at)));
  }, [user]);

  const latest = measurements[0];
  const previous = measurements[1];
  const weightDelta =
    latest?.weight_kg != null && previous?.weight_kg != null
      ? +(latest.weight_kg - previous.weight_kg).toFixed(1)
      : null;

  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Личный кабинет"
        title={`Добро пожаловать${profile?.full_name ? `, ${profile.full_name}` : ""}`}
        description="Отслеживайте прогресс, обновляйте замеры и держите цель перед глазами."
      />

      {onboardingDone === false && accessStatus === "pending_onboarding" && (
        <Link
          to="/dashboard/onboarding"
          className="group flex items-center gap-4 rounded-3xl border border-coral/40 bg-gradient-to-r from-coral/15 via-transparent to-gold/15 p-6 transition-transform hover:scale-[1.01]"
        >
          <div className="rounded-2xl bg-coral/20 p-3 text-coral">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="eyebrow">Первый шаг</p>
            <p className="mt-1 font-display text-lg text-ivory">
              Заполните первичную анкету — все разделы откроются после отправки
            </p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-gold transition-transform group-hover:translate-x-1" />
        </Link>
      )}

      {accessStatus === "awaiting_approval" && (
        <div className="flex items-start gap-4 rounded-3xl border border-gold/25 bg-gradient-to-r from-gold/10 via-transparent to-coral/10 p-6">
          <div className="rounded-2xl bg-gold/20 p-3 text-gold">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="eyebrow">Анкета отправлена</p>
            <p className="mt-1 font-display text-lg text-ivory">
              Тренер проверяет вашу анкету — доступ к курсу и трекингу прогресса откроется после назначения программы
            </p>
          </div>
        </div>
      )}

      <AccessGate level="onboarding_submitted">
        <div className="space-y-10">

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
                    Пока пусто — добавьте первый замер
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
