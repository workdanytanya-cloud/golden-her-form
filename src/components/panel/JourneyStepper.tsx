import { Check, ClipboardList, Hourglass, Sparkles, LineChart, UserCheck } from "lucide-react";
import type { AccessStatus } from "@/lib/auth";

type StepState = "done" | "current" | "todo";

export type JourneyInput = {
  accessStatus: AccessStatus | null;
  onboardingDone: boolean;
  measurementsCount: number;
};

export function JourneyStepper({ accessStatus, onboardingDone, measurementsCount }: JourneyInput) {
  const steps = buildSteps({ accessStatus, onboardingDone, measurementsCount });
  const currentIndex = steps.findIndex((s) => s.state === "current");
  const active = currentIndex >= 0 ? steps[currentIndex] : steps[steps.length - 1];

  return (
    <div className="rounded-3xl border border-gold/15 bg-gradient-to-br from-surface/60 via-background/40 to-gold/5 p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Ваш путь</p>
        <p className="text-[11px] uppercase tracking-widest text-warm-gray">
          Шаг {Math.max(currentIndex + 1, steps.filter((s) => s.state === "done").length)} из {steps.length}
        </p>
      </div>

      {/* Desktop: horizontal */}
      <ol className="mt-5 hidden items-start gap-2 md:flex">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-start gap-2">
            <StepNode step={s} index={i} />
            {i < steps.length - 1 && (
              <div
                className={`mt-5 h-0.5 flex-1 rounded ${
                  s.state === "done" ? "bg-gradient-to-r from-gold to-coral" : "bg-gold/15"
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      {/* Mobile: vertical */}
      <ol className="mt-5 space-y-3 md:hidden">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-start gap-3">
            <StepDot step={s} index={i} />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-medium ${
                  s.state === "todo" ? "text-warm-gray" : "text-ivory"
                }`}
              >
                {s.label}
              </p>
              {s.state === "current" && (
                <p className="mt-0.5 text-xs text-warm-gray">{s.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {active && (
        <div className="mt-5 rounded-2xl border border-gold/20 bg-background/40 p-4">
          <p className="text-[11px] uppercase tracking-widest text-gold">Что делать сейчас</p>
          <p className="mt-1 text-sm text-ivory">{active.hint}</p>
        </div>
      )}
    </div>
  );
}

function StepNode({ step, index }: { step: Step; index: number }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <StepDot step={step} index={index} />
      <p
        className={`mt-2 max-w-[8rem] truncate text-xs ${
          step.state === "todo" ? "text-warm-gray" : "text-ivory"
        }`}
        title={step.label}
      >
        {step.label}
      </p>
    </div>
  );
}

function StepDot({ step, index }: { step: Step; index: number }) {
  const Icon = step.icon;
  const cls =
    step.state === "done"
      ? "border-gold/50 bg-gradient-to-br from-gold to-coral text-background"
      : step.state === "current"
        ? "border-gold/60 bg-background text-gold ring-4 ring-gold/15 animate-pulse-slow"
        : "border-gold/15 bg-background/40 text-warm-gray";
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${cls}`}
      aria-label={`Шаг ${index + 1}: ${step.label}`}
    >
      {step.state === "done" ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
    </div>
  );
}

type Step = {
  key: string;
  label: string;
  hint: string;
  icon: typeof ClipboardList;
  state: StepState;
};

function buildSteps({ accessStatus, onboardingDone, measurementsCount }: JourneyInput): Step[] {
  const registered = true; // если рендерим — значит пользователь вошёл
  const onboarded = onboardingDone;
  const approved = accessStatus === "active";
  const hasMeasurements = measurementsCount > 0;

  const state = (done: boolean, current: boolean): StepState =>
    done ? "done" : current ? "current" : "todo";

  return [
    {
      key: "signup",
      label: "Регистрация",
      hint: "Аккаунт создан — добро пожаловать!",
      icon: UserCheck,
      state: state(registered, false),
    },
    {
      key: "onboarding",
      label: "Анкета",
      hint: "Заполните первичную анкету — тренер соберёт программу под вас.",
      icon: ClipboardList,
      state: state(onboarded, registered && !onboarded),
    },
    {
      key: "review",
      label: "Проверка",
      hint: "Анкета отправлена. Тренер проверяет её и подбирает программу — обычно 1–2 дня.",
      icon: Hourglass,
      state: state(approved, onboarded && !approved),
    },
    {
      key: "course",
      label: "Курс",
      hint: "Программа назначена. Загляните в раздел курса и приступайте к первой неделе.",
      icon: Sparkles,
      state: state(approved && hasMeasurements, approved && !hasMeasurements),
    },
    {
      key: "measurements",
      label: "Замеры",
      hint: "Добавляйте замеры раз в неделю — так мы увидим динамику и вовремя скорректируем план.",
      icon: LineChart,
      state: state(false, approved && hasMeasurements),
    },
  ];
}
