import { useMemo, useState } from "react";
import {
  applySpellFixes,
  checkFoodSpelling,
  formatFoodList,
  parseFoodList,
  type SpellIssue,
} from "@/lib/food-products";
import { type NutritionTargets } from "@/lib/nutrition";

export function NutritionSetup({
  initialMeals,
  initialPreferred,
  initialExcluded,
  suggestedTargets,
  autoExcluded,
  onCancel,
  onSubmit,
  submitLabel = "Сгенерировать меню",
}: {
  initialMeals?: 3 | 5;
  initialPreferred?: string[];
  /** Ручные исключения (без авто из анкеты). */
  initialExcluded?: string[];
  suggestedTargets: NutritionTargets;
  autoExcluded: string[];
  onCancel?: () => void;
  onSubmit: (v: {
    mealsPerDay: 3 | 5;
    preferred: string[];
    excluded: string[];
  }) => Promise<void>;
  submitLabel?: string;
}) {
  const [meals, setMeals] = useState<3 | 5>(initialMeals ?? 5);
  const [preferredText, setPreferredText] = useState(
    formatFoodList(
      initialPreferred?.length
        ? initialPreferred
        : ["птица", "рыба", "овощи", "яйца"],
    ),
  );
  const [excludedText, setExcludedText] = useState(formatFoodList(initialExcluded));
  const [busy, setBusy] = useState(false);
  const [spellIssues, setSpellIssues] = useState<SpellIssue[]>([]);
  const [spellAck, setSpellAck] = useState(false);

  const preferredTokens = useMemo(() => parseFoodList(preferredText), [preferredText]);
  const excludedTokens = useMemo(() => parseFoodList(excludedText), [excludedText]);

  const recheckSpelling = (preferred = preferredText, excluded = excludedText) => {
    const issues = checkFoodSpelling([
      ...parseFoodList(preferred),
      ...parseFoodList(excluded),
    ]);
    setSpellIssues(issues);
    return issues;
  };

  const applyAllFixes = () => {
    if (spellIssues.length === 0) return;
    setPreferredText((t) => applySpellFixes(t, spellIssues));
    setExcludedText((t) => applySpellFixes(t, spellIssues));
    setSpellIssues([]);
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
          Напишите любимые продукты через запятую — их будет в меню и рецептах больше.
        </p>
        <textarea
          rows={3}
          value={preferredText}
          onChange={(e) => {
            setPreferredText(e.target.value);
            setSpellIssues([]);
            setSpellAck(false);
          }}
          onBlur={() => recheckSpelling()}
          placeholder="Например: курица, творог, гречка, яблоки, брокколи"
          className="mt-3 w-full rounded-2xl border border-gold/20 bg-background/50 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 focus:border-gold/50 focus:outline-none"
        />
        {preferredTokens.length > 0 && (
          <p className="mt-2 text-xs text-warm-gray">
            Учтено: {preferredTokens.length}{" "}
            {preferredTokens.length === 1 ? "продукт" : "продукта(ов)"}
          </p>
        )}
      </div>

      <div>
        <h3 className="font-display text-xl">Что исключить?</h3>
        <p className="mt-1 text-sm text-warm-gray">
          Продукты, которых не должно быть в рецептах и меню.
        </p>
        <textarea
          rows={3}
          value={excludedText}
          onChange={(e) => {
            setExcludedText(e.target.value);
            setSpellIssues([]);
            setSpellAck(false);
          }}
          onBlur={() => recheckSpelling()}
          placeholder="Например: свинина, молоко, орехи"
          className="mt-3 w-full rounded-2xl border border-gold/20 bg-background/50 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 focus:border-gold/50 focus:outline-none"
        />
        {autoExcluded.length > 0 && (
          <p className="mt-3 text-xs text-warm-gray">
            Из анкеты (аллергии / не ем) уже исключаем:{" "}
            <span className="text-coral">{formatFoodList(autoExcluded)}</span>
          </p>
        )}
      </div>

      {spellIssues.length > 0 && (
        <div className="rounded-2xl border border-coral/30 bg-coral/10 p-4 text-sm">
          <p className="text-ivory">Проверьте правописание:</p>
          <ul className="mt-2 space-y-1 text-warm-gray">
            {spellIssues.map((issue) => (
              <li key={issue.original}>
                «{issue.original}» → возможно{" "}
                <button
                  type="button"
                  className="text-gold underline-offset-2 hover:underline"
                  onClick={() => {
                    setPreferredText((t) => applySpellFixes(t, [issue]));
                    setExcludedText((t) => applySpellFixes(t, [issue]));
                    setSpellIssues((cur) => cur.filter((x) => x.original !== issue.original));
                  }}
                >
                  «{issue.suggestion}»
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={applyAllFixes}
            className="mt-3 text-xs uppercase tracking-widest text-gold hover:text-ivory"
          >
            Исправить все
          </button>
        </div>
      )}

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
            const issues = recheckSpelling();
            if (issues.length > 0 && !spellAck) {
              setSpellAck(true);
              return;
            }
            setBusy(true);
            try {
              await onSubmit({
                mealsPerDay: meals,
                preferred: preferredTokens,
                excluded: excludedTokens,
              });
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm uppercase tracking-widest text-background hover:scale-[1.02] disabled:opacity-60"
        >
          {busy
            ? "Думаю…"
            : spellIssues.length > 0 && spellAck
              ? "Всё равно пересобрать"
              : submitLabel}
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
