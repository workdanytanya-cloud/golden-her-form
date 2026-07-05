import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader } from "@/components/panel/PanelShell";
import { toast } from "sonner";
import { CheckCircle2, Save, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/onboarding")({
  component: OnboardingPage,
});

type FormState = {
  goal_primary: string;
  goal_details: string;
  experience: string;
  training_days_per_week: string;
  session_duration_min: string;
  training_location: string;
  equipment: string[];
  focus_areas: string[];
  has_injuries: boolean;
  injuries_details: string;
  health_conditions: string;
  medications: string;
  pregnancy_status: string;
  sleep_hours: string;
  stress_level: string;
  energy_level: string;
  water_liters: string;
  diet_type: string;
  allergies: string;
  meals_per_day: string;
  favorite_foods: string;
  disliked_foods: string;
  alcohol_frequency: string;
  smoking: boolean;
  activity_level: string;
  job_type: string;
  motivation: string;
  previous_experience: string;
  timeframe: string;
  expectations: string;
};

const empty: FormState = {
  goal_primary: "",
  goal_details: "",
  experience: "",
  training_days_per_week: "",
  session_duration_min: "",
  training_location: "",
  equipment: [],
  focus_areas: [],
  has_injuries: false,
  injuries_details: "",
  health_conditions: "",
  medications: "",
  pregnancy_status: "",
  sleep_hours: "",
  stress_level: "",
  energy_level: "",
  water_liters: "",
  diet_type: "",
  allergies: "",
  meals_per_day: "",
  favorite_foods: "",
  disliked_foods: "",
  alcohol_frequency: "",
  smoking: false,
  activity_level: "",
  job_type: "",
  motivation: "",
  previous_experience: "",
  timeframe: "",
  expectations: "",
};

const GOALS = [
  "Снижение веса",
  "Тонус и рельеф",
  "Набор мышечной массы",
  "Здоровье и энергия",
  "Восстановление после родов",
  "Подготовка к событию",
];

const EXPERIENCE = [
  { v: "novice", l: "Новичок" },
  { v: "some", l: "Тренируюсь эпизодически" },
  { v: "regular", l: "Регулярно 6+ месяцев" },
  { v: "advanced", l: "Опытный, 2+ года" },
];

const LOCATIONS = [
  { v: "home", l: "Дом" },
  { v: "gym", l: "Зал" },
  { v: "outdoor", l: "На улице" },
  { v: "mixed", l: "Комбинирую" },
];

const EQUIPMENT = [
  "Гантели",
  "Резинки/фитнес-ленты",
  "Коврик",
  "Штанга",
  "Тренажёры зала",
  "Кардио-тренажёр",
  "Гиря",
  "Ничего",
];

const FOCUS = ["Живот и талия", "Бёдра и ягодицы", "Ноги", "Руки", "Спина", "Осанка", "Общий тонус"];

const DIETS = [
  "Обычное",
  "Вегетарианство",
  "Веганство",
  "Пескетарианство",
  "Кето / низкоуглеводное",
  "Без глютена",
  "Без лактозы",
];

const ACTIVITY = [
  { v: "sedentary", l: "Малоподвижный" },
  { v: "light", l: "Лёгкая активность" },
  { v: "moderate", l: "Средняя активность" },
  { v: "high", l: "Высокая активность" },
];

const ALCOHOL = ["Не употребляю", "1–2 раза в месяц", "Раз в неделю", "Несколько раз в неделю"];

const PREGNANCY = [
  { v: "na", l: "Не относится" },
  { v: "no", l: "Нет" },
  { v: "pregnant", l: "Беременна" },
  { v: "postpartum", l: "После родов < 6 мес" },
  { v: "nursing", l: "Кормлю грудью" },
];

const TIMEFRAME = ["1 месяц", "3 месяца", "6 месяцев", "Год и больше"];

function OnboardingPage() {
  const { user, refreshAccess } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("onboarding_responses")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const d = data as Record<string, unknown>;
          setForm({
            goal_primary: (d.goal_primary as string) ?? "",
            goal_details: (d.goal_details as string) ?? "",
            experience: (d.experience as string) ?? "",
            training_days_per_week: d.training_days_per_week != null ? String(d.training_days_per_week) : "",
            session_duration_min: d.session_duration_min != null ? String(d.session_duration_min) : "",
            training_location: (d.training_location as string) ?? "",
            equipment: (d.equipment as string[]) ?? [],
            focus_areas: (d.focus_areas as string[]) ?? [],
            has_injuries: Boolean(d.has_injuries),
            injuries_details: (d.injuries_details as string) ?? "",
            health_conditions: (d.health_conditions as string) ?? "",
            medications: (d.medications as string) ?? "",
            pregnancy_status: (d.pregnancy_status as string) ?? "",
            sleep_hours: d.sleep_hours != null ? String(d.sleep_hours) : "",
            stress_level: d.stress_level != null ? String(d.stress_level) : "",
            energy_level: d.energy_level != null ? String(d.energy_level) : "",
            water_liters: d.water_liters != null ? String(d.water_liters) : "",
            diet_type: (d.diet_type as string) ?? "",
            allergies: (d.allergies as string) ?? "",
            meals_per_day: d.meals_per_day != null ? String(d.meals_per_day) : "",
            favorite_foods: (d.favorite_foods as string) ?? "",
            disliked_foods: (d.disliked_foods as string) ?? "",
            alcohol_frequency: (d.alcohol_frequency as string) ?? "",
            smoking: Boolean(d.smoking),
            activity_level: (d.activity_level as string) ?? "",
            job_type: (d.job_type as string) ?? "",
            motivation: (d.motivation as string) ?? "",
            previous_experience: (d.previous_experience as string) ?? "",
            timeframe: (d.timeframe as string) ?? "",
            expectations: (d.expectations as string) ?? "",
          });
          setCompleted((d.completed_at as string) ?? null);
        }
        setLoading(false);
      });
  }, [user]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toggleArr = (key: "equipment" | "focus_areas", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
    }));

  const buildPayload = (asCompleted: boolean) => {
    if (!user) return null;
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    return {
      user_id: user.id,
      goal_primary: form.goal_primary || null,
      goal_details: form.goal_details.trim() || null,
      experience: form.experience || null,
      training_days_per_week: num(form.training_days_per_week),
      session_duration_min: num(form.session_duration_min),
      training_location: form.training_location || null,
      equipment: form.equipment,
      focus_areas: form.focus_areas,
      has_injuries: form.has_injuries,
      injuries_details: form.injuries_details.trim() || null,
      health_conditions: form.health_conditions.trim() || null,
      medications: form.medications.trim() || null,
      pregnancy_status: form.pregnancy_status || null,
      sleep_hours: num(form.sleep_hours),
      stress_level: num(form.stress_level),
      energy_level: num(form.energy_level),
      water_liters: num(form.water_liters),
      diet_type: form.diet_type || null,
      allergies: form.allergies.trim() || null,
      meals_per_day: num(form.meals_per_day),
      favorite_foods: form.favorite_foods.trim() || null,
      disliked_foods: form.disliked_foods.trim() || null,
      alcohol_frequency: form.alcohol_frequency || null,
      smoking: form.smoking,
      activity_level: form.activity_level || null,
      job_type: form.job_type.trim() || null,
      motivation: form.motivation.trim() || null,
      previous_experience: form.previous_experience.trim() || null,
      timeframe: form.timeframe || null,
      expectations: form.expectations.trim() || null,
      completed_at: asCompleted ? new Date().toISOString() : completed,
    };
  };

  const save = async (asCompleted: boolean) => {
    if (!user) return;
    if (asCompleted && !form.goal_primary) {
      toast.error("Выберите основную цель");
      return;
    }
    setSaving(true);
    const payload = buildPayload(asCompleted);
    if (!payload) return;
    const { error } = await supabase
      .from("onboarding_responses")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    if (asCompleted) {
      setCompleted(payload.completed_at as string);
      await refreshAccess();
      toast.success("Анкета отправлена тренеру");
      void navigate({ to: "/dashboard" });
    } else {
      toast.success("Черновик сохранён");
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-warm-gray">Загрузка анкеты…</div>
    );
  }

  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Онбординг"
        title="Первичная анкета"
        description="Ответы помогут собрать программу и сопровождение под вас. Заполните всё, что можете — тренер увидит анкету сразу после отправки."
        action={
          completed ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-xs uppercase tracking-widest text-gold">
              <CheckCircle2 className="h-4 w-4" /> Отправлено
            </span>
          ) : undefined
        }
      />

      <Section title="Цель" step="1">
        <Field label="Основная цель">
          <div className="grid gap-2 sm:grid-cols-2">
            {GOALS.map((g) => (
              <Chip
                key={g}
                active={form.goal_primary === g}
                onClick={() => set("goal_primary", g)}
              >
                {g}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Опишите цель своими словами">
          <textarea
            rows={3}
            maxLength={500}
            value={form.goal_details}
            onChange={(e) => set("goal_details", e.target.value)}
            className={inputCls}
            placeholder="Например: минус 5 кг к отпуску, чувствовать себя увереннее в теле…"
          />
        </Field>
        <Field label="Желаемый срок">
          <div className="grid gap-2 sm:grid-cols-4">
            {TIMEFRAME.map((t) => (
              <Chip key={t} active={form.timeframe === t} onClick={() => set("timeframe", t)}>
                {t}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Проблемные зоны, на которых хотите сфокусироваться">
          <div className="flex flex-wrap gap-2">
            {FOCUS.map((f) => (
              <Chip
                key={f}
                active={form.focus_areas.includes(f)}
                onClick={() => toggleArr("focus_areas", f)}
              >
                {f}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Тренировки" step="2">
        <Field label="Опыт">
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPERIENCE.map((e) => (
              <Chip key={e.v} active={form.experience === e.v} onClick={() => set("experience", e.v)}>
                {e.l}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Сколько дней в неделю готовы тренироваться">
            <input
              type="number"
              min={0}
              max={7}
              value={form.training_days_per_week}
              onChange={(e) => set("training_days_per_week", e.target.value)}
              className={inputCls}
              placeholder="3"
            />
          </Field>
          <Field label="Длительность одной тренировки, мин">
            <input
              type="number"
              min={10}
              max={180}
              value={form.session_duration_min}
              onChange={(e) => set("session_duration_min", e.target.value)}
              className={inputCls}
              placeholder="45"
            />
          </Field>
        </div>
        <Field label="Где тренируетесь">
          <div className="grid gap-2 sm:grid-cols-4">
            {LOCATIONS.map((l) => (
              <Chip
                key={l.v}
                active={form.training_location === l.v}
                onClick={() => set("training_location", l.v)}
              >
                {l.l}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Доступный инвентарь">
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT.map((eq) => (
              <Chip
                key={eq}
                active={form.equipment.includes(eq)}
                onClick={() => toggleArr("equipment", eq)}
              >
                {eq}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Здоровье" step="3">
        <Field label="Есть травмы или ограничения?">
          <div className="flex gap-2">
            <Chip active={form.has_injuries} onClick={() => set("has_injuries", true)}>
              Да
            </Chip>
            <Chip active={!form.has_injuries} onClick={() => set("has_injuries", false)}>
              Нет
            </Chip>
          </div>
        </Field>
        {form.has_injuries && (
          <Field label="Опишите травмы / ограничения">
            <textarea
              rows={2}
              maxLength={500}
              value={form.injuries_details}
              onChange={(e) => set("injuries_details", e.target.value)}
              className={inputCls}
              placeholder="Например: болит поясница, повреждение колена в 2022…"
            />
          </Field>
        )}
        <Field label="Хронические заболевания / особенности здоровья">
          <textarea
            rows={2}
            maxLength={500}
            value={form.health_conditions}
            onChange={(e) => set("health_conditions", e.target.value)}
            className={inputCls}
            placeholder="Гипотериоз, диастаз, гипертония…"
          />
        </Field>
        <Field label="Лекарства, которые принимаете постоянно">
          <textarea
            rows={2}
            maxLength={500}
            value={form.medications}
            onChange={(e) => set("medications", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Беременность / кормление">
          <div className="grid gap-2 sm:grid-cols-3">
            {PREGNANCY.map((p) => (
              <Chip
                key={p.v}
                active={form.pregnancy_status === p.v}
                onClick={() => set("pregnancy_status", p.v)}
              >
                {p.l}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Образ жизни" step="4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Сон, часов в сутки">
            <input
              type="number"
              step="0.5"
              min={0}
              max={16}
              value={form.sleep_hours}
              onChange={(e) => set("sleep_hours", e.target.value)}
              className={inputCls}
              placeholder="7"
            />
          </Field>
          <Field label="Вода, литров в день">
            <input
              type="number"
              step="0.1"
              min={0}
              max={10}
              value={form.water_liters}
              onChange={(e) => set("water_liters", e.target.value)}
              className={inputCls}
              placeholder="1.5"
            />
          </Field>
          <Field label={`Уровень стресса: ${form.stress_level || "—"} / 10`}>
            <input
              type="range"
              min={1}
              max={10}
              value={form.stress_level || 5}
              onChange={(e) => set("stress_level", e.target.value)}
              className="w-full accent-coral"
            />
          </Field>
          <Field label={`Уровень энергии: ${form.energy_level || "—"} / 10`}>
            <input
              type="range"
              min={1}
              max={10}
              value={form.energy_level || 5}
              onChange={(e) => set("energy_level", e.target.value)}
              className="w-full accent-gold"
            />
          </Field>
        </div>
        <Field label="Уровень бытовой активности">
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIVITY.map((a) => (
              <Chip
                key={a.v}
                active={form.activity_level === a.v}
                onClick={() => set("activity_level", a.v)}
              >
                {a.l}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Характер работы">
          <input
            type="text"
            maxLength={200}
            value={form.job_type}
            onChange={(e) => set("job_type", e.target.value)}
            className={inputCls}
            placeholder="Сидячая офисная, на ногах, с командировками…"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Как часто употребляете алкоголь">
            <div className="flex flex-wrap gap-2">
              {ALCOHOL.map((a) => (
                <Chip
                  key={a}
                  active={form.alcohol_frequency === a}
                  onClick={() => set("alcohol_frequency", a)}
                >
                  {a}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Курите?">
            <div className="flex gap-2">
              <Chip active={form.smoking} onClick={() => set("smoking", true)}>
                Да
              </Chip>
              <Chip active={!form.smoking} onClick={() => set("smoking", false)}>
                Нет
              </Chip>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Питание" step="5">
        <Field label="Тип питания">
          <div className="flex flex-wrap gap-2">
            {DIETS.map((d) => (
              <Chip key={d} active={form.diet_type === d} onClick={() => set("diet_type", d)}>
                {d}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Приёмов пищи в день">
            <input
              type="number"
              min={1}
              max={10}
              value={form.meals_per_day}
              onChange={(e) => set("meals_per_day", e.target.value)}
              className={inputCls}
              placeholder="3"
            />
          </Field>
          <Field label="Аллергии / непереносимость">
            <input
              type="text"
              maxLength={200}
              value={form.allergies}
              onChange={(e) => set("allergies", e.target.value)}
              className={inputCls}
              placeholder="Орехи, лактоза…"
            />
          </Field>
        </div>
        <Field label="Любимые продукты">
          <textarea
            rows={2}
            maxLength={400}
            value={form.favorite_foods}
            onChange={(e) => set("favorite_foods", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Продукты, которые не едите">
          <textarea
            rows={2}
            maxLength={400}
            value={form.disliked_foods}
            onChange={(e) => set("disliked_foods", e.target.value)}
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="Мотивация и ожидания" step="6">
        <Field label="Что мотивирует вас сейчас">
          <textarea
            rows={2}
            maxLength={500}
            value={form.motivation}
            onChange={(e) => set("motivation", e.target.value)}
            className={inputCls}
            placeholder="Отпуск, самочувствие, событие, здоровье детей…"
          />
        </Field>
        <Field label="Прошлый опыт с тренером / программами">
          <textarea
            rows={2}
            maxLength={500}
            value={form.previous_experience}
            onChange={(e) => set("previous_experience", e.target.value)}
            className={inputCls}
            placeholder="Что работало, что не подошло…"
          />
        </Field>
        <Field label="Чего вы ждёте от сопровождения">
          <textarea
            rows={3}
            maxLength={500}
            value={form.expectations}
            onChange={(e) => set("expectations", e.target.value)}
            className={inputCls}
            placeholder="Формат обратной связи, частота контакта, что важно…"
          />
        </Field>
      </Section>

      <div className="sticky bottom-4 flex flex-col-reverse gap-3 rounded-2xl border border-gold/20 bg-surface/80 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-warm-gray">
          {completed
            ? `Анкета уже отправлена. Изменения будут видны тренеру после сохранения.`
            : `Можно сохранить черновик и вернуться позже.`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            disabled={saving}
            onClick={() => save(false)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-gold/30 px-5 py-3 text-sm text-ivory transition-colors hover:bg-gold/10 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> Сохранить черновик
          </button>
          <button
            disabled={saving}
            onClick={() => save(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {completed ? "Обновить анкету" : "Отправить тренеру"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, step, children }: { title: string; step: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-coral to-gold text-sm font-semibold text-background">
          {step}
        </span>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] uppercase tracking-widest text-warm-gray">{label}</span>
      {children}
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-4 py-2 text-sm transition-all",
        active
          ? "border-gold/60 bg-gradient-to-r from-coral/25 to-gold/20 text-ivory shadow-sm shadow-gold/10"
          : "border-gold/20 bg-background/30 text-warm-gray hover:border-gold/40 hover:text-ivory",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

const inputCls =
  "w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60";
