import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { CalendarCheck, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  countWorkoutsCompletedThisWeek,
  currentWeekStart,
  getWeeklyCheckIn,
  saveWeeklyCheckIn,
  type WeeklyCheckInRow,
} from "@/lib/checkin-repo";
import { parseRuNumber } from "@/lib/ru-number";

type Props = {
  userId: string;
  workoutsPlanned: number;
  onSaved?: (row: WeeklyCheckInRow) => void;
};

function ScaleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-gold"
        />
        <span className="w-8 text-center font-display text-lg text-ivory">{value}</span>
      </div>
    </label>
  );
}

export function WeeklyCheckInCard({ userId, workoutsPlanned, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<WeeklyCheckInRow | null>(null);
  const [loading, setLoading] = useState(true);

  const weekStart = currentWeekStart();
  const weekLabel = format(new Date(weekStart), "d MMM", { locale: ru });

  useEffect(() => {
    let cancelled = false;
    void getWeeklyCheckIn(userId, weekStart)
      .then((row) => {
        if (!cancelled) setExisting(row);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, weekStart]);

  return (
    <>
      <section className="rounded-3xl border border-gold/15 bg-gradient-to-br from-gold/10 via-transparent to-coral/5 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-gold">Еженедельный check-in</p>
            <h3 className="mt-1 font-display text-lg text-ivory">Неделя с {weekLabel}</h3>
            <p className="mt-2 max-w-xl text-sm text-warm-gray">
              Раз в 7 дней — короткий опрос: самочувствие, тренировки, питание. Это помогает
              корректировать программу без резких скачков нагрузки.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background"
          >
            <CalendarCheck className="h-4 w-4" />
            {existing ? "Обновить" : "Заполнить"}
          </button>
        </div>
        {!loading && existing && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/20 bg-background/40 px-3 py-1 text-[11px] text-warm-gray">
            <Sparkles className="h-3 w-3 text-gold" />
            Check-in сохранён
            {existing.adaptation_decision && (
              <span className="text-ivory">· {existing.adaptation_decision}</span>
            )}
          </p>
        )}
      </section>

      {open && (
        <WeeklyCheckInDialog
          userId={userId}
          weekStart={weekStart}
          workoutsPlanned={workoutsPlanned}
          initial={existing}
          onClose={() => setOpen(false)}
          onSaved={(row) => {
            setExisting(row);
            onSaved?.(row);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function WeeklyCheckInDialog({
  userId,
  weekStart,
  workoutsPlanned,
  initial,
  onClose,
  onSaved,
}: {
  userId: string;
  weekStart: string;
  workoutsPlanned: number;
  initial: WeeklyCheckInRow | null;
  onClose: () => void;
  onSaved: (row: WeeklyCheckInRow) => void;
}) {
  const [avgWeight, setAvgWeight] = useState(initial?.avg_weight_kg?.toString() ?? "");
  const [waist, setWaist] = useState(initial?.waist_cm?.toString() ?? "");
  const [hips, setHips] = useState(initial?.hips_cm?.toString() ?? "");
  const [workoutsDone, setWorkoutsDone] = useState(
    initial?.workouts_completed?.toString() ?? "",
  );
  const [steps, setSteps] = useState(initial?.avg_steps?.toString() ?? "");
  const [hunger, setHunger] = useState(initial?.hunger_1_10 ?? 5);
  const [energy, setEnergy] = useState(initial?.energy_1_10 ?? 5);
  const [sleep, setSleep] = useState(initial?.sleep_hours?.toString() ?? "");
  const [trainingDiff, setTrainingDiff] = useState(initial?.training_difficulty_1_10 ?? 5);
  const [adherence, setAdherence] = useState(initial?.nutrition_adherence_pct ?? 80);
  const [pain, setPain] = useState(initial?.pain_reported ?? false);
  const [hard, setHard] = useState(initial?.what_was_hard ?? "");
  const [liked, setLiked] = useState(initial?.what_liked ?? "");
  const [wants, setWants] = useState(initial?.wants_change ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial?.workouts_completed != null) return;
    void countWorkoutsCompletedThisWeek(userId).then((n) => {
      if (n > 0) setWorkoutsDone(String(n));
    });
  }, [userId, initial]);

  const submit = async () => {
    setSaving(true);
    try {
      const { row, explanation } = await saveWeeklyCheckIn({
        userId,
        week_start: weekStart,
        avg_weight_kg: parseRuNumber(avgWeight),
        waist_cm: parseRuNumber(waist),
        hips_cm: parseRuNumber(hips),
        workouts_completed: workoutsDone ? Math.round(parseRuNumber(workoutsDone) ?? 0) : null,
        workouts_planned: workoutsPlanned,
        avg_steps: steps ? Math.round(parseRuNumber(steps) ?? 0) : null,
        hunger_1_10: hunger,
        energy_1_10: energy,
        sleep_hours: parseRuNumber(sleep),
        training_difficulty_1_10: trainingDiff,
        nutrition_adherence_pct: adherence,
        pain_reported: pain,
        what_was_hard: hard || null,
        what_liked: liked || null,
        wants_change: wants || null,
        notes: null,
      });
      toast.success("Check-in сохранён", { description: explanation });
      onSaved(row);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : "Не удалось сохранить";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory placeholder:text-warm-gray/60";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background text-ivory">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Check-in за неделю</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Средний вес, кг</span>
            <input className={inputCls} value={avgWeight} onChange={(e) => setAvgWeight(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Сон, ч/ночь</span>
            <input className={inputCls} value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="7.5" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Талия, см</span>
            <input className={inputCls} value={waist} onChange={(e) => setWaist(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Бёдра, см</span>
            <input className={inputCls} value={hips} onChange={(e) => setHips(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Тренировок выполнено</span>
            <input className={inputCls} value={workoutsDone} onChange={(e) => setWorkoutsDone(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[11px] uppercase tracking-widest text-warm-gray">Средние шаги/день</span>
            <input className={inputCls} value={steps} onChange={(e) => setSteps(e.target.value)} />
          </label>
        </div>

        <p className="text-xs text-warm-gray">Запланировано тренировок: {workoutsPlanned}</p>

        <ScaleField label="Голод (1–10)" value={hunger} onChange={setHunger} />
        <ScaleField label="Энергия (1–10)" value={energy} onChange={setEnergy} />
        <ScaleField label="Сложность тренировок (1–10)" value={trainingDiff} onChange={setTrainingDiff} />

        <label className="block space-y-2">
          <span className="text-[11px] uppercase tracking-widest text-warm-gray">
            Соблюдение питания, %
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={adherence}
            onChange={(e) => setAdherence(Number(e.target.value))}
            className="w-full accent-gold"
          />
          <span className="text-sm text-ivory">{adherence}%</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pain} onChange={(e) => setPain(e.target.checked)} className="accent-coral" />
          Были болезненные ощущения на этой неделе
        </label>

        <textarea rows={2} className={inputCls} placeholder="Что было сложно?" value={hard} onChange={(e) => setHard(e.target.value)} />
        <textarea rows={2} className={inputCls} placeholder="Что понравилось?" value={liked} onChange={(e) => setLiked(e.target.value)} />
        <textarea rows={2} className={inputCls} placeholder="Что хотите изменить?" value={wants} onChange={(e) => setWants(e.target.value)} />

        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="w-full rounded-full bg-gradient-to-r from-coral to-gold py-3 text-xs uppercase tracking-widest text-background disabled:opacity-50"
        >
          {saving ? "Сохраняем…" : "Сохранить check-in"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
