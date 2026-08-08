import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader } from "@/components/panel/PanelShell";
import { formatMedicalDietTable } from "@/lib/medical-diet-tables";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/onboarding")({
  component: AdminClientOnboarding,
});

type Onboarding = Record<string, unknown>;

const EXPERIENCE_LABELS: Record<string, string> = {
  novice: "Новичок",
  some: "Тренируюсь эпизодически",
  regular: "Регулярно 6+ месяцев",
  advanced: "Опытный, 2+ года",
};

const LOCATION_LABELS: Record<string, string> = {
  home: "Дом",
  gym: "Зал",
  outdoor: "Улица",
  mixed: "Комбинирует",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Малоподвижный",
  light: "Лёгкая активность",
  moderate: "Средняя активность",
  high: "Высокая активность",
};

const PREGNANCY_LABELS: Record<string, string> = {
  na: "Не относится",
  no: "Нет",
  pregnant: "Беременна",
  postpartum: "После родов < 6 мес",
  nursing: "Кормит грудью",
};

function AdminClientOnboarding() {
  const { id } = Route.useParams();
  const [data, setData] = useState<Onboarding | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setProfileName((data?.full_name as string) || "Без имени"));

    void supabase
      .from("onboarding_responses")
      .select("*")
      .eq("user_id", id)
      .maybeSingle()
      .then(({ data }) => {
        setData((data as Onboarding | null) ?? null);
        setLoading(false);
      });
  }, [id]);

  const get = (k: string) => data?.[k];
  const s = (k: string) => {
    const v = get(k);
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const n = (k: string) => {
    const v = get(k);
    return v == null ? null : String(v);
  };
  const arr = (k: string): string[] => (Array.isArray(get(k)) ? (get(k) as string[]) : []);

  return (
    <div className="space-y-10">
      <Link
        to="/admin/clients/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-sm text-warm-gray hover:text-ivory"
      >
        <ArrowLeft className="h-4 w-4" /> К карточке клиента
      </Link>

      <PanelHeader
        eyebrow="Анкета онбординга"
        title={profileName}
        description={
          data?.completed_at
            ? `Отправлена ${new Date(data.completed_at as string).toLocaleDateString("ru-RU")}`
            : data
              ? "Черновик клиента — ещё не отправлен"
              : "Клиент ещё не заполнил анкету"
        }
      />

      {loading ? (
        <div className="py-12 text-center text-warm-gray">Загрузка…</div>
      ) : !data ? (
        <div className="rounded-3xl border border-gold/15 bg-surface/40 p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-gold/60" />
          <p className="mt-4 text-warm-gray">Клиент ещё не заполнял анкету онбординга.</p>
        </div>
      ) : (
        <>
          <Group title="Цель">
            <Row label="Основная цель" value={s("goal_primary")} />
            <Row label="Своими словами" value={s("goal_details")} multiline />
            <Row label="Срок" value={s("timeframe")} />
            <Row label="Зоны фокуса" value={arr("focus_areas").join(", ") || null} />
          </Group>

          <Group title="Тренировки">
            <Row label="Опыт" value={s("experience") ? EXPERIENCE_LABELS[s("experience")!] : null} />
            <Row label="Дней в неделю" value={n("training_days_per_week")} />
            <Row label="Длительность, мин" value={n("session_duration_min")} />
            <Row label="Локация" value={s("training_location") ? LOCATION_LABELS[s("training_location")!] : null} />
            <Row label="Инвентарь" value={arr("equipment").join(", ") || null} />
          </Group>

          <Group title="Здоровье">
            <Row label="Травмы" value={get("has_injuries") ? "Да" : "Нет"} />
            <Row label="Детали травм" value={s("injuries_details")} multiline />
            <Row label="Хронические заболевания" value={s("health_conditions")} multiline />
            <Row label="Лекарства" value={s("medications")} multiline />
            <Row
              label="Беременность / кормление"
              value={s("pregnancy_status") ? PREGNANCY_LABELS[s("pregnancy_status")!] : null}
            />
          </Group>

          <Group title="Образ жизни">
            <Row label="Сон, ч" value={n("sleep_hours")} />
            <Row label="Вода, л" value={n("water_liters")} />
            <Row label="Стресс" value={n("stress_level") ? `${n("stress_level")} / 10` : null} />
            <Row label="Энергия" value={n("energy_level") ? `${n("energy_level")} / 10` : null} />
            <Row
              label="Активность"
              value={s("activity_level") ? ACTIVITY_LABELS[s("activity_level")!] : null}
            />
            <Row label="Работа" value={s("job_type")} />
            <Row label="Алкоголь" value={s("alcohol_frequency")} />
            <Row label="Курение" value={get("smoking") ? "Да" : "Нет"} />
          </Group>

          <Group title="Питание">
            <Row label="Тип питания" value={s("diet_type")} />
            <Row
              label="Меню / стол"
              value={formatMedicalDietTable(
                (() => {
                  const extra = get("extra");
                  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
                    const id = (extra as Record<string, unknown>).medical_diet_table;
                    return typeof id === "string" ? id : null;
                  }
                  return null;
                })(),
              )}
              multiline
            />
            <Row label="Приёмов пищи" value={n("meals_per_day")} />
            <Row label="Аллергии" value={s("allergies")} />
            <Row label="Любимые продукты" value={s("favorite_foods")} multiline />
            <Row label="Не ест" value={s("disliked_foods")} multiline />
          </Group>

          <Group title="Мотивация и ожидания">
            <Row label="Мотивация" value={s("motivation")} multiline />
            <Row label="Прошлый опыт" value={s("previous_experience")} multiline />
            <Row label="Ожидания" value={s("expectations")} multiline />
          </Group>
        </>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6 md:p-8">
      <h2 className="font-display text-2xl">{title}</h2>
      <dl className="mt-4 divide-y divide-gold/10">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-6">
      <dt className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</dt>
      <dd
        className={[
          "text-sm text-ivory",
          multiline ? "whitespace-pre-wrap" : "",
          !value ? "text-warm-gray/60" : "",
        ].join(" ")}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
