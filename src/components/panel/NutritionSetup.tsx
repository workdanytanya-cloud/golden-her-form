import { useState } from "react";
import { PREFERRED_PRODUCT_OPTIONS, type NutritionTargets } from "@/lib/nutrition";

export function NutritionSetup({
  initialMeals,
  initialPreferred,
  suggestedTargets,
  autoExcluded,
  onCancel,
  onSubmit,
  submitLabel = "Сгенерировать меню",
}: {
  initialMeals?: 3 | 5;
  initialPreferred?: string[];
  suggestedTargets: NutritionTargets;
  autoExcluded: string[];
  onCancel?: () => void;
  onSubmit: (v: { mealsPerDay: 3 | 5; preferred: string[] }) => Promise<void>;
  submitLabel?: string;
}) {
  const [meals, setMeals] = useState<3 | 5>(initialMeals ?? 5);
  const [preferred, setPreferred] = useState<Set<string>>(
    new Set(initialPreferred ?? ["птица", "рыба", "овощи", "молочка"]),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (k: string) => {
    setPreferred((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className="space-y-6 rounded-3xl border border-gold/15 bg-surface/40 p-6">
      <div>
        <h3 className="font-display text-xl">Как часто удобно есть?</h3>
        <p className="mt-1 text-sm text-warm-gray">
          Программу подстроим под ваш ритм. Позже можно изменить.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {([3, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMeals(n)}
              className={[
                "rounded-2xl border p-4 text-left transition-colors",
                meals === n
                  ? "border-gold/60 bg-gradient-to-br from-coral/15 to-gold/10 text-ivory"
                  : "border-gold/15 bg-background/40 text-warm-gray hover:border-gold/30",
              ].join(" ")}
            >
              <p className="font-display text-2xl text-ivory">{n}</p>
              <p className="mt-1 text-xs uppercase tracking-widest text-warm-gray">
                {n === 3 ? "3 плотных приёма" : "3 основных + 2 перекуса"}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display text-xl">Что вы едите чаще всего?</h3>
        <p className="mt-1 text-sm text-warm-gray">
          Отметьте любимые продукты — их будет в меню больше.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PREFERRED_PRODUCT_OPTIONS.map((opt) => {
            const on = preferred.has(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggle(opt.key)}
                className={[
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  on
                    ? "border-gold/60 bg-gradient-to-r from-coral/20 to-gold/15 text-ivory"
                    : "border-gold/20 text-warm-gray hover:border-gold/40 hover:text-ivory",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {autoExcluded.length > 0 && (
          <p className="mt-3 text-xs text-warm-gray">
            Из анкеты исключаем: <span className="text-coral">{autoExcluded.join(", ")}</span>
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-gold/15 bg-background/40 p-4 text-sm text-warm-gray">
        <p className="text-[11px] uppercase tracking-widest text-warm-gray">
          Расчётная суточная норма
        </p>
        <p className="mt-2 text-ivory">
          <b className="text-gold">{suggestedTargets.kcal}</b> ккал · Б{" "}
          <b className="text-ivory">{suggestedTargets.protein_g}</b> · Ж{" "}
          <b className="text-ivory">{suggestedTargets.fat_g}</b> · У{" "}
          <b className="text-ivory">{suggestedTargets.carbs_g}</b>
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ mealsPerDay: meals, preferred: Array.from(preferred) });
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm uppercase tracking-widest text-background hover:scale-[1.02] disabled:opacity-60"
        >
          {busy ? "Генерируем…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-gold/25 px-5 py-3 text-sm uppercase tracking-widest text-ivory hover:bg-gold/10"
          >
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}
