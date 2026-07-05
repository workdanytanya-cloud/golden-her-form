import { useState } from "react";
import { z } from "zod";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Info,
  Ruler,
  Scale,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";


type FormState = {
  measured_on: string;
  weight_kg: string;
  waist_cm: string;
  hips_cm: string;
  chest_cm: string;
  note: string;
};

const empty: FormState = {
  measured_on: format(new Date(), "yyyy-MM-dd"),
  weight_kg: "",
  waist_cm: "",
  hips_cm: "",
  chest_cm: "",
  note: "",
};

const CHECKLIST = [
  { key: "morning", label: "Утро, натощак, после туалета" },
  { key: "clothes", label: "Без одежды или в одном и том же белье" },
  { key: "tape", label: "Сантиметровая лента под рукой" },
  { key: "scale", label: "Весы на ровной твёрдой поверхности" },
];

type FieldStep = {
  key: keyof FormState;
  label: string;
  unit?: string;
  icon: typeof Scale;
  title: string;
  hint: string;
  placeholder: string;
  optional?: boolean;
  min?: number;
  max?: number;
};

const STEPS: FieldStep[] = [
  {
    key: "weight_kg",
    label: "Вес",
    unit: "кг",
    icon: Scale,
    title: "Взвесьтесь на весах",
    hint: "Встаньте на весы босиком, ровно, руки вдоль тела. Взвешивайтесь всегда в одно и то же время — лучше утром, до еды и воды.",
    placeholder: "например, 68.4",
    min: 20,
    max: 300,
  },
  {
    key: "waist_cm",
    label: "Талия",
    unit: "см",
    icon: Ruler,
    title: "Измерьте талию",
    hint: "Найдите самое узкое место — обычно на 2–3 см выше пупка. Лента параллельна полу, прилегает, но не сдавливает. Замер на выдохе, живот расслаблен.",
    placeholder: "например, 74",
    min: 30,
    max: 200,
  },
  {
    key: "hips_cm",
    label: "Бёдра",
    unit: "см",
    icon: Ruler,
    title: "Измерьте бёдра",
    hint: "Обхват в самой широкой точке ягодиц. Ноги вместе, лента параллельна полу спереди и сзади.",
    placeholder: "например, 96",
    optional: true,
    min: 30,
    max: 200,
  },
  {
    key: "chest_cm",
    label: "Грудь",
    unit: "см",
    icon: Ruler,
    title: "Измерьте грудь",
    hint: "Обхват по самой выступающей точке груди. Руки опущены, дыхание спокойное — замер между вдохом и выдохом.",
    placeholder: "например, 88",
    optional: true,
    min: 30,
    max: 200,
  },
];

const numberSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), {
      message: `Введите число от ${min} до ${max}`,
    });

export function MeasurementWizard({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [stage, setStage] = useState<"intro" | "steps" | "note">("intro");
  const [stepIdx, setStepIdx] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);

  const allChecked = CHECKLIST.every((c) => checked[c.key]);
  const step = STEPS[stepIdx];
  const totalSteps = STEPS.length + 1; // +1 = note

  const goNext = () => {
    // validate current step value
    const val = form[step.key];
    if (!step.optional && !val) {
      toast.error(`Введите ${step.label.toLowerCase()} или пропустите`);
      return;
    }
    if (val) {
      const parse = numberSchema(step.min ?? 0, step.max ?? 999).safeParse(val);
      if (!parse.success) {
        toast.error(parse.error.errors[0].message);
        return;
      }
    }
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
    else setStage("note");
  };

  const goBack = () => {
    if (stage === "note") {
      setStage("steps");
      return;
    }
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
    else setStage("intro");
  };

  const reset = () => {
    setStage("intro");
    setStepIdx(0);
    setChecked({});
    setForm(empty);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("measurements").insert({
      user_id: userId,
      measured_on: form.measured_on,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      waist_cm: form.waist_cm ? Number(form.waist_cm) : null,
      hips_cm: form.hips_cm ? Number(form.hips_cm) : null,
      chest_cm: form.chest_cm ? Number(form.chest_cm) : null,
      note: form.note.trim().slice(0, 500) || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Не удалось сохранить: " + error.message);
      return;
    }
    toast.success("Замер сохранён! Отличная работа.");
    reset();
    onSaved();
  };

  // ---------- INTRO ----------
  if (stage === "intro") {
    return (
      <Wrapper>
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-coral/25 to-gold/25 text-gold">
            <ClipboardCheck className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="eyebrow">Замер шаг за шагом</p>
            <h2 className="mt-2 font-display text-2xl text-ivory md:text-3xl">
              Готовы снять замеры?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-warm-gray">
              Пройдёмся вместе по каждому пункту — подскажу, где именно измерять и как записать
              результат. Займёт 2–3 минуты. Сначала быстрая подготовка:
            </p>

            <ul className="mt-5 space-y-2">
              {CHECKLIST.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => setChecked((s) => ({ ...s, [c.key]: !s[c.key] }))}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left text-sm transition-colors",
                      checked[c.key]
                        ? "border-gold/40 bg-gold/10 text-ivory"
                        : "border-gold/15 bg-background/40 text-warm-gray hover:border-gold/30",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        checked[c.key]
                          ? "border-gold bg-gold text-background"
                          : "border-gold/30 bg-transparent",
                      )}
                    >
                      {checked[c.key] && <Check className="h-3 w-3" />}
                    </span>
                    <span>{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setStage("steps")}
                disabled={!allChecked}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Начать замер <ArrowRight className="h-4 w-4" />
              </button>
              {!allChecked && (
                <p className="text-xs text-warm-gray">
                  Отметьте все пункты, чтобы начать
                </p>
              )}
            </div>
          </div>
        </div>
      </Wrapper>
    );
  }

  // ---------- NOTE (final step) ----------
  if (stage === "note") {
    return (
      <Wrapper>
        <ProgressHeader current={totalSteps} total={totalSteps} label="Готово" onBack={goBack} />
        <div className="mt-6 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <StickyNote className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-xl text-ivory">Пара слов о самочувствии</h3>
            <p className="mt-1 text-sm text-warm-gray">
              Необязательно. Тренер увидит эту заметку — расскажите, как прошла неделя: сон,
              энергия, тренировки, питание, стресс.
            </p>
          </div>
        </div>

        <textarea
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 500) })}
          maxLength={500}
          rows={4}
          placeholder="Например: неделя тяжёлая, спал плохо, но тренировки прошли по плану"
          className="mt-4 w-full rounded-2xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60"
        />
        <p className="mt-1 text-right text-[11px] text-warm-gray">{form.note.length}/500</p>

        <Summary form={form} />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-full border border-gold/20 px-5 py-2.5 text-sm text-ivory hover:bg-gold/5"
          >
            <ArrowLeft className="h-4 w-4" /> Назад
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Сохраняем…" : "Сохранить замер"}
          </button>
        </div>
      </Wrapper>
    );
  }

  // ---------- STEPS (weight/waist/hips/chest) ----------
  const Icon = step.icon;
  const value = form[step.key];

  return (
    <Wrapper>
      <ProgressHeader
        current={stepIdx + 1}
        total={totalSteps}
        label={`${stepIdx + 1} из ${totalSteps}`}
        onBack={goBack}
      />

      {/* Date picker on first step */}
      {stepIdx === 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-gold/15 bg-background/40 p-3 text-sm">
          <span className="text-warm-gray">Дата замера:</span>
          <input
            type="date"
            value={form.measured_on}
            onChange={(e) => setForm({ ...form, measured_on: e.target.value })}
            className="rounded-lg border border-gold/20 bg-transparent px-2 py-1 text-ivory outline-none focus:border-gold/60"
          />
          <span className="text-warm-gray">
            ({format(new Date(form.measured_on), "d MMMM yyyy", { locale: ru })})
          </span>
        </div>
      )}

      <div className="mt-6 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-coral/25 to-gold/25 text-gold">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-xl text-ivory md:text-2xl">
            {step.title}{" "}
            {step.optional && (
              <span className="ml-2 rounded-full border border-gold/25 px-2 py-0.5 align-middle text-[10px] uppercase tracking-widest text-warm-gray">
                можно пропустить
              </span>
            )}
          </h3>
          <p className="mt-1.5 flex items-start gap-2 text-sm leading-relaxed text-warm-gray">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold/80" />
            <span>{step.hint}</span>
          </p>
        </div>
      </div>

      {/* Highlighted input */}
      <div className="mt-6">
        <label className="block">
          <span className="mb-2 block text-[11px] uppercase tracking-widest text-gold">
            {step.label}
          </span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              autoFocus
              value={value}
              onChange={(e) => setForm({ ...form, [step.key]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goNext();
                }
              }}
              placeholder={step.placeholder}
              className="w-full rounded-2xl border-2 border-gold/60 bg-background/60 px-5 py-5 pr-16 font-display text-3xl text-ivory shadow-[0_0_0_6px_oklch(0.78_0.15_78/0.08)] outline-none transition-all placeholder:text-warm-gray/40 focus:border-gold focus:shadow-[0_0_0_6px_oklch(0.78_0.15_78/0.18)]"
            />
            {step.unit && (
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-lg text-warm-gray">
                {step.unit}
              </span>
            )}
          </div>
        </label>

        {/* Step dots */}
        <div className="mt-5 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStepIdx(i)}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < stepIdx
                  ? "bg-gradient-to-r from-gold to-coral"
                  : i === stepIdx
                    ? "bg-gold"
                    : "bg-gold/15",
              )}
              aria-label={`Перейти к: ${s.label}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-full border border-gold/20 px-5 py-2.5 text-sm text-ivory hover:bg-gold/5"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {step.optional && !value && (
            <button
              type="button"
              onClick={() => {
                setForm({ ...form, [step.key]: "" });
                if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
                else setStage("note");
              }}
              className="rounded-full border border-gold/20 px-5 py-2.5 text-sm text-warm-gray hover:text-ivory"
            >
              Пропустить
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            {stepIdx === STEPS.length - 1 ? "К заметке" : "Дальше"}{" "}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-gold/20 bg-gradient-to-br from-surface/60 via-background/40 to-gold/5 p-6 md:p-8">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-gold" />
        <p className="eyebrow">Новый замер</p>
      </div>
      {children}
    </section>
  );
}

function ProgressHeader({
  current,
  total,
  label,
  onBack,
}: {
  current: number;
  total: number;
  label: string;
  onBack: () => void;
}) {
  const pct = Math.round((current / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-warm-gray">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-ivory">
          <ArrowLeft className="h-3 w-3" /> Назад
        </button>
        <span>{label}</span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gold/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold to-coral transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Summary({ form }: { form: FormState }) {
  const rows: { label: string; value: string }[] = [
    { label: "Дата", value: format(new Date(form.measured_on), "d MMM yyyy", { locale: ru }) },
    { label: "Вес", value: form.weight_kg ? `${form.weight_kg} кг` : "—" },
    { label: "Талия", value: form.waist_cm ? `${form.waist_cm} см` : "—" },
    { label: "Бёдра", value: form.hips_cm ? `${form.hips_cm} см` : "—" },
    { label: "Грудь", value: form.chest_cm ? `${form.chest_cm} см` : "—" },
  ];
  return (
    <div className="mt-6 rounded-2xl border border-gold/15 bg-background/40 p-4">
      <p className="mb-3 text-[11px] uppercase tracking-widest text-warm-gray">Итог замера</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl bg-background/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-warm-gray">{r.label}</p>
            <p className="mt-1 font-display text-ivory">{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

