import { useEffect, useState } from "react";
import { Check, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import {
  MEAL_SCHEDULE_CLIENT_LABELS,
  MEAL_SCHEDULE_DESCRIPTIONS,
  MEAL_SCHEDULE_MODES_CLIENT,
  MEAL_SCHEDULE_TAGLINES,
  PRIMARY_MEAL_SLOT_LABELS,
  PRIMARY_MEAL_SLOTS,
  mealScheduleClientLabel,
  type MealScheduleMode,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";
import { saveClientMealSchedulePreference } from "@/lib/nutrition-constructor/client-preference";

type Props = {
  userId: string;
  courseId?: string | null;
  value: MealScheduleMode;
  primarySlot: PrimaryMealSlot;
  publishedMode?: MealScheduleMode | null;
  onSaved?: (mode: MealScheduleMode, primarySlot: PrimaryMealSlot) => void;
};

export function MealSchedulePicker({
  userId,
  courseId,
  value,
  primarySlot,
  publishedMode,
  onSaved,
}: Props) {
  const [mode, setMode] = useState(value);
  const [slot, setSlot] = useState(primarySlot);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(value);
    setSlot(primarySlot);
  }, [value, primarySlot]);

  const dirty = mode !== value || slot !== primarySlot;

  const save = async () => {
    setSaving(true);
    try {
      await saveClientMealSchedulePreference({
        userId,
        courseId,
        mode,
        primarySlot: slot,
        publishedMode: publishedMode ?? value,
      });
      onSaved?.(mode, slot);
      if (publishedMode != null && publishedMode !== mode) {
        toast.success(
          "Выбор сохранён. Тренер соберёт меню в формате «" +
            MEAL_SCHEDULE_CLIENT_LABELS[mode] +
            "» и опубликует его для вас.",
        );
      } else {
        toast.success("Формат меню сохранён");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить выбор");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-gold/15 bg-surface/30 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <UtensilsCrossed className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div>
          <h2 className="font-display text-lg text-foreground">Формат меню на день</h2>
          <p className="mt-1 text-sm text-warm-gray">
            Выберите, как удобнее питаться в течение дня. Тренер подберёт продукты и граммовки под
            ваш выбор.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {MEAL_SCHEDULE_MODES_CLIENT.map((m) => {
          const selected = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "relative rounded-2xl border p-4 text-left transition-colors",
                selected
                  ? "border-gold/50 bg-gold/10"
                  : "border-gold/15 bg-background/40 hover:border-gold/30",
              ].join(" ")}
            >
              {selected ? (
                <Check className="absolute right-3 top-3 h-4 w-4 text-gold" />
              ) : null}
              <p className="pr-6 font-medium text-foreground">{MEAL_SCHEDULE_CLIENT_LABELS[m]}</p>
              <p className="mt-1 text-xs text-gold">{MEAL_SCHEDULE_TAGLINES[m]}</p>
              <p className="mt-2 text-sm leading-relaxed text-warm-gray">
                {MEAL_SCHEDULE_DESCRIPTIONS[m]}
              </p>
            </button>
          );
        })}
      </div>

      {mode === "one_main_three_snacks" && (
        <label className="block max-w-md">
          <span className="mb-1 block text-xs uppercase tracking-wide text-warm-gray">
            Когда удобнее полноценный приём?
          </span>
          <select
            value={slot}
            onChange={(e) => setSlot(e.target.value as PrimaryMealSlot)}
            className="w-full rounded-xl border border-gold/20 bg-background/80 px-3 py-2.5 text-sm"
          >
            {PRIMARY_MEAL_SLOTS.map((s) => (
              <option key={s} value={s}>
                {PRIMARY_MEAL_SLOT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      )}

      {dirty ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {saving ? "Сохраняем…" : "Сохранить выбор"}
        </button>
      ) : (
        <p className="text-xs text-warm-gray">
          Сейчас выбрано: <span className="text-foreground">{mealScheduleClientLabel(mode)}</span>
          {mode === "one_main_three_snacks"
            ? ` · основной приём ${PRIMARY_MEAL_SLOT_LABELS[slot]}`
            : null}
        </p>
      )}
    </section>
  );
}
