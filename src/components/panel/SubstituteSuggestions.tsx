import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  applyExerciseSubstituteFn,
  suggestExerciseSubstitutesFn,
} from "@/lib/substitute.functions";
import type { SubstituteReason } from "@/lib/personalization/substitute-engine";

type ApplyContext = {
  weekIndex: number;
  dayIndex: number;
  section: "warmup" | "exercises" | "cooldown";
  setIndex: number;
};

type Props = {
  userId: string;
  exerciseId: string;
  exerciseName: string;
  reason?: SubstituteReason;
  applyContext?: ApplyContext;
  compact?: boolean;
  onApplied?: () => void;
};

export function SubstituteSuggestions({
  userId,
  exerciseId,
  exerciseName,
  reason = "too_hard",
  applyContext,
  compact = false,
  onApplied,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{ exercise_id: string; name: string; reason: string }> | null
  >(null);
  const [source, setSource] = useState<"llm" | "rules" | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await suggestExerciseSubstitutesFn({
        data: { userId, exerciseId, reason, limit: 3 },
      });
      setSuggestions(res.suggestions);
      setSource(res.source);
      if (res.suggestions.length === 0) {
        toast.message("Подходящих замен в базе не найдено");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось подобрать замену");
    } finally {
      setLoading(false);
    }
  };

  const apply = async (newExerciseId: string) => {
    if (!applyContext) {
      toast.message("Замену применит тренер в программе");
      return;
    }
    setApplyingId(newExerciseId);
    try {
      await applyExerciseSubstituteFn({
        data: {
          userId,
          weekIndex: applyContext.weekIndex,
          dayIndex: applyContext.dayIndex,
          section: applyContext.section,
          setIndex: applyContext.setIndex,
          newExerciseId,
        },
      });
      toast.success("Упражнение заменено в программе");
      onApplied?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось применить замену");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3 rounded-xl border border-gold/15 bg-surface/30 p-3"}>
      {!compact && (
        <p className="text-[11px] uppercase tracking-widest text-gold">Замена: {exerciseName}</p>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={() => void load()}
        className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 px-3 py-1.5 text-[10px] uppercase tracking-widest text-warm-gray hover:border-gold/40 hover:text-ivory disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5 text-gold" />
        {loading ? "Подбираем…" : compact ? "Замена" : "Подобрать замену"}
      </button>

      {source && suggestions && suggestions.length > 0 && (
        <p className="text-[10px] text-warm-gray">
          Источник: {source === "llm" ? "AI + база упражнений" : "правила + база упражнений"}
        </p>
      )}

      {suggestions?.map((s) => (
        <div
          key={s.exercise_id}
          className="flex flex-col gap-2 rounded-lg border border-gold/10 bg-background/40 p-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm text-ivory">{s.name}</p>
            <p className="mt-0.5 text-xs text-warm-gray">{s.reason}</p>
          </div>
          {applyContext && (
            <button
              type="button"
              disabled={applyingId === s.exercise_id}
              onClick={() => void apply(s.exercise_id)}
              className="shrink-0 rounded-full bg-gradient-to-r from-coral to-gold px-3 py-1 text-[10px] uppercase tracking-widest text-background disabled:opacity-50"
            >
              {applyingId === s.exercise_id ? "…" : "Применить"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
