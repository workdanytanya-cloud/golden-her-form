import { useState } from "react";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveWorkoutFeedback } from "@/lib/checkin-repo";
import { SubstituteSuggestions } from "@/components/panel/SubstituteSuggestions";

type ExerciseOption = {
  id: string;
  name: string;
  section: "warmup" | "exercises" | "cooldown";
  setIndex: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  programId?: string | null;
  weekIndex: number;
  dayIndex: number;
  dayTitle: string;
  exercises: ExerciseOption[];
  onSubstituteApplied?: () => void;
};

function ScaleField({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-gold"
        />
        <span className="w-8 text-center font-display text-lg text-ivory">{value}</span>
      </div>
    </label>
  );
}

export function WorkoutFeedbackDialog({
  open,
  onClose,
  userId,
  programId,
  weekIndex,
  dayIndex,
  dayTitle,
  exercises,
  onSubstituteApplied,
}: Props) {
  const [completed, setCompleted] = useState(true);
  const [difficulty, setDifficulty] = useState(6);
  const [energyBefore, setEnergyBefore] = useState(6);
  const [wellbeingAfter, setWellbeingAfter] = useState(7);
  const [pain, setPain] = useState(false);
  const [painDetails, setPainDetails] = useState("");
  const [tooEasy, setTooEasy] = useState<Set<string>>(new Set());
  const [tooHard, setTooHard] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (
    current: Set<string>,
    id: string,
    other: Set<string>,
    setCurrent: (s: Set<string>) => void,
    setOther: (s: Set<string>) => void,
  ) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.has(id)) {
      const o = new Set(other);
      o.delete(id);
      setOther(o);
    }
    setCurrent(next);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const { explanation } = await saveWorkoutFeedback({
        userId,
        programId,
        weekIndex,
        dayIndex,
        dayTitle,
        completed_fully: completed,
        difficulty_1_10: difficulty,
        pain_reported: pain,
        pain_details: pain ? painDetails || null : null,
        too_easy_exercise_ids: [...tooEasy],
        too_hard_exercise_ids: [...tooHard],
        energy_before_1_10: energyBefore,
        wellbeing_after_1_10: wellbeingAfter,
        notes: notes || null,
      });
      toast.success("Тренировка отмечена", { description: explanation });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background text-ivory">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Activity className="h-5 w-5 text-gold" />
            Как прошла тренировка?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-warm-gray">{dayTitle}</p>

        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCompleted(true)}
              className={[
                "flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest",
                completed ? "border-gold bg-gold/15 text-ivory" : "border-gold/20 text-warm-gray",
              ].join(" ")}
            >
              <CheckCircle2 className="mx-auto mb-1 h-4 w-4" /> Выполнил(а) полностью
            </button>
            <button
              type="button"
              onClick={() => setCompleted(false)}
              className={[
                "flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest",
                !completed ? "border-coral bg-coral/15 text-ivory" : "border-gold/20 text-warm-gray",
              ].join(" ")}
            >
              Частично
            </button>
          </div>

          <ScaleField label="Субъективная сложность (1 — легко, 10 — предел)" value={difficulty} onChange={setDifficulty} />
          <ScaleField label="Энергия до тренировки" value={energyBefore} onChange={setEnergyBefore} />
          <ScaleField label="Самочувствие после" value={wellbeingAfter} onChange={setWellbeingAfter} />

          <label className="flex items-center gap-2 text-sm text-ivory">
            <input type="checkbox" checked={pain} onChange={(e) => setPain(e.target.checked)} className="accent-coral" />
            <AlertTriangle className="h-4 w-4 text-coral" />
            Были болезненные ощущения
          </label>
          {pain && (
            <textarea
              rows={2}
              value={painDetails}
              onChange={(e) => setPainDetails(e.target.value)}
              placeholder="Где и когда болело?"
              className="w-full rounded-xl border border-gold/20 bg-surface/40 px-3 py-2 text-sm"
            />
          )}

          {exercises.length > 0 && (
            <div className="space-y-3 rounded-xl border border-gold/15 bg-surface/30 p-3">
              <p className="text-[11px] uppercase tracking-widest text-gold">Упражнения</p>
              {exercises.map((ex) => (
                <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 text-ivory">{ex.name}</span>
                  <div className="flex gap-2 text-[10px] uppercase tracking-widest">
                    <button
                      type="button"
                      onClick={() => toggle(tooEasy, ex.id, tooHard, setTooEasy, setTooHard)}
                      className={tooEasy.has(ex.id) ? "text-gold" : "text-warm-gray"}
                    >
                      Легко
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(tooHard, ex.id, tooEasy, setTooHard, setTooEasy)}
                      className={tooHard.has(ex.id) ? "text-coral" : "text-warm-gray"}
                    >
                      Тяжело
                    </button>
                  </div>
                </div>
              ))}
              {tooHard.size > 0 && (
                <div className="mt-3 space-y-3 border-t border-gold/10 pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-gold">
                    Замены для тяжёлых упражнений
                  </p>
                  {exercises
                    .filter((ex) => tooHard.has(ex.id))
                    .map((ex) => (
                      <SubstituteSuggestions
                        key={ex.id}
                        compact
                        userId={userId}
                        exerciseId={ex.id}
                        exerciseName={ex.name}
                        reason="too_hard"
                        applyContext={{
                          weekIndex,
                          dayIndex,
                          section: ex.section,
                          setIndex: ex.setIndex,
                        }}
                        onApplied={onSubstituteApplied}
                      />
                    ))}
                </div>
              )}
            </div>
          )}

          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Комментарий (необязательно)"
            className="w-full rounded-xl border border-gold/20 bg-surface/40 px-3 py-2 text-sm"
          />

          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="w-full rounded-full bg-gradient-to-r from-coral to-gold py-3 text-xs uppercase tracking-widest text-background disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
