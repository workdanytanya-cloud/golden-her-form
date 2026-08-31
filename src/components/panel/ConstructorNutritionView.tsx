import { useMemo, useState } from "react";
import { AlertTriangle, ChefHat, Info, Scale } from "lucide-react";
import {
  displayOrderForPlan,
  mealScheduleClientLabel,
  mealScheduleDescription,
  slotLabel,
  WEIGHING_NOTICE,
  type MealScheduleMode,
  type PlanSlot,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";
import { displayGrams, displayMacro, d } from "@/lib/nutrition-constructor/decimal-math";
import type {
  ConstructorDay,
  MacroComparisonRow,
  MealPlanItem,
} from "@/lib/nutrition-constructor/types";
import { formatMacroDeviationPhrase } from "@/lib/nutrition-constructor/validation-messages";

type Props = {
  days: ConstructorDay[];
  comparison: MacroComparisonRow[];
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  planStatus?: "draft" | "validated" | "assigned";
  kbjuAcceptable?: boolean;
  precisionHint?: string;
  mealScheduleMode?: MealScheduleMode;
  primaryMealSlot?: PrimaryMealSlot;
  editable?: boolean;
  onIngredientGramsChange?: (
    dayIndex: number,
    slot: PlanSlot,
    productId: string,
    grams: number,
  ) => Promise<void>;
  onAssign?: () => Promise<void>;
};

export function ConstructorNutritionView({
  days,
  comparison,
  targets,
  planStatus = "draft",
  kbjuAcceptable = false,
  precisionHint = "",
  mealScheduleMode = "two_main_two_snacks",
  primaryMealSlot = "lunch",
  editable = false,
  onIngredientGramsChange,
  onAssign,
}: Props) {
  const [dayIndex, setDayIndex] = useState(0);
  const day = days.find((d) => d.day_index === dayIndex) ?? days[0];

  const dayDisplay = useMemo(() => {
    if (!day) return null;
    return displayMacro({
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(day.fiber_g),
    });
  }, [day]);

  const displaySlots = useMemo(
    () => displayOrderForPlan(mealScheduleMode, primaryMealSlot),
    [mealScheduleMode, primaryMealSlot],
  );

  if (!day) {
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/40 p-8 text-center text-warm-gray">
        Рацион ещё не собран. Запустите генерацию в конструкторе.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold/15 bg-surface/30 px-4 py-3 text-xs text-warm-gray">
        <Info className="h-4 w-4 shrink-0 text-gold" />
        {WEIGHING_NOTICE}
      </div>

      {planStatus !== "assigned" && !kbjuAcceptable && precisionHint && (
        <div className="flex gap-3 rounded-2xl border border-gold/20 bg-gold/5 p-4 text-sm text-warm-gray">
          <Info className="h-5 w-5 shrink-0 text-gold" />
          <p>
            Рацион собран по структуре режима. Для назначения клиенту подправьте граммовки или
            дождитесь попадания в допуск.{" "}
            <span className="block mt-1 text-[11px] text-warm-gray/90">
              Для идеально точного попадания в цель: {precisionHint}.
            </span>
          </p>
        </div>
      )}

      {planStatus !== "assigned" && !kbjuAcceptable && !precisionHint && !day.is_valid && (
        <div className="flex gap-3 rounded-2xl border border-coral/30 bg-coral/10 p-4 text-sm text-warm-gray">
          <AlertTriangle className="h-5 w-5 shrink-0 text-coral" />
          <p>
            Рацион не прошёл проверку по допускам. Назначение клиенту заблокировано до успешной
            валидации.
          </p>
        </div>
      )}

      <MacroComparisonTable rows={comparison} precisionHint={precisionHint} />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Ккал" value={dayDisplay!.kcal} target={targets.kcal} />
        <StatCard label="Белки, г" value={dayDisplay!.protein_g} target={targets.protein_g} />
        <StatCard label="Жиры, г" value={dayDisplay!.fat_g} target={targets.fat_g} />
        <StatCard label="Углеводы, г" value={dayDisplay!.carbs_g} target={targets.carbs_g} />
      </div>

      {days.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <button
              key={d.day_index}
              type="button"
              onClick={() => setDayIndex(d.day_index)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest",
                d.day_index === dayIndex
                  ? "border-gold/60 bg-gold/15 text-ivory"
                  : "border-gold/20 text-warm-gray hover:text-ivory",
                !d.is_valid ? "border-coral/40" : "",
              ].join(" ")}
            >
              День {d.day_index + 1}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-gold/15 bg-surface/20 px-4 py-3 text-sm">
        <p className="font-medium text-foreground">
          Формат: {mealScheduleClientLabel(mealScheduleMode)}
        </p>
        <p className="mt-1 leading-relaxed text-warm-gray">
          {mealScheduleDescription(mealScheduleMode)}
        </p>
      </div>

      <div className="space-y-3">
        {displaySlots.map((slot) => {
          const item = day.items.find((i) => i.slot === slot);
          if (!item) {
            return (
              <div
                key={slot}
                className="rounded-2xl border border-dashed border-gold/20 p-5 text-warm-gray"
              >
                {slotLabel(slot, mealScheduleMode, primaryMealSlot)} — не задано
              </div>
            );
          }
          return (
            <MealCard
              key={slot}
              slot={slot}
              slotTitle={slotLabel(slot, mealScheduleMode, primaryMealSlot)}
              item={item}
              dayIndex={day.day_index}
              editable={editable}
              onIngredientGramsChange={onIngredientGramsChange}
            />
          );
        })}
      </div>

      {editable && onAssign && day.is_valid && (
        <button
          type="button"
          onClick={() => void onAssign()}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-xs uppercase tracking-widest text-background"
        >
          Назначить клиенту
        </button>
      )}
    </div>
  );
}

function MacroComparisonTable({
  rows,
  precisionHint = "",
}: {
  rows: MacroComparisonRow[];
  precisionHint?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-2xl border border-gold/15">
      <table className="w-full min-w-[320px] text-sm">
        <thead>
          <tr className="border-b border-gold/10 text-left text-xs uppercase tracking-widest text-warm-gray">
            <th className="px-4 py-3">Показатель</th>
            <th className="px-4 py-3 text-right">Цель</th>
            <th className="px-4 py-3 text-right">Фактически</th>
            <th className="px-4 py-3 text-right">Разница</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-gold/5">
              <td className="px-4 py-3 text-ivory">{row.label}</td>
              <td className="px-4 py-3 text-right text-warm-gray">{row.target}</td>
              <td className="px-4 py-3 text-right text-ivory">{row.actual}</td>
              <td
                className={[
                  "px-4 py-3 text-right font-medium",
                  row.diff === 0
                    ? "text-gold"
                    : Math.abs(row.diff) <= 5
                      ? "text-warm-gray"
                      : "text-coral",
                ].join(" ")}
              >
                {formatMacroDeviationPhrase(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {precisionHint ? (
        <p className="px-1 text-[10px] leading-relaxed text-warm-gray/80">
          Для идеально точного попадания (±1&nbsp;г / ±5&nbsp;ккал): {precisionHint}
        </p>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, target }: { label: string; value: number; target: number }) {
  const diff = value - target;
  return (
    <div className="rounded-2xl border border-gold/15 bg-surface/40 p-4">
      <p className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</p>
      <p className="mt-1 font-display text-2xl text-ivory">{value}</p>
      <p className="mt-1 text-xs text-warm-gray">
        цель {target}{" "}
        <span className={diff === 0 ? "text-gold" : "text-coral"}>
          ({diff > 0 ? "+" : ""}
          {Math.round(diff * 10) / 10})
        </span>
      </p>
    </div>
  );
}

function MealCard({
  slot,
  slotTitle,
  item,
  dayIndex,
  editable,
  onIngredientGramsChange,
}: {
  slot: PlanSlot;
  slotTitle: string;
  item: MealPlanItem;
  dayIndex: number;
  editable?: boolean;
  onIngredientGramsChange?: Props["onIngredientGramsChange"];
}) {
  const mealMacro = displayMacro({
    kcal: d(item.kcal),
    protein_g: d(item.protein_g),
    fat_g: d(item.fat_g),
    carbs_g: d(item.carbs_g),
    fiber_g: d(item.fiber_g),
  });

  return (
    <div className="rounded-2xl border border-gold/15 bg-surface/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">{slotTitle}</p>
          <p className="mt-1 break-words font-display text-lg text-ivory">{item.recipe_name}</p>
          {!item.requires_cooking && (
            <p className="mt-1 text-xs font-medium text-gold">Без приготовления</p>
          )}
          {item.snack_action && !item.requires_cooking && (
            <p className="mt-1 text-xs text-warm-gray">{item.snack_action}</p>
          )}
          {item.weighing_note && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-warm-gray">
              <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {item.weighing_note}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-xl text-gold">{mealMacro.kcal}</p>
          <p className="text-[10px] uppercase tracking-widest text-warm-gray">ккал</p>
          <p className="mt-1 text-[11px] text-warm-gray">
            Б {mealMacro.protein_g} · Ж {mealMacro.fat_g} · У {mealMacro.carbs_g}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {item.ingredients.map((ing) => (
          <li
            key={ing.product_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/40 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="text-ivory">{ing.product_name}</span>
              {ing.weighing_note && (
                <span className="ml-2 text-xs text-warm-gray">({ing.weighing_note})</span>
              )}
            </div>
            {editable && onIngredientGramsChange ? (
              <input
                type="number"
                min={10}
                max={600}
                step={1}
                defaultValue={displayGrams(ing.grams)}
                className="w-20 rounded-lg border border-gold/20 bg-surface px-2 py-1 text-right text-ivory"
                onBlur={(e) => {
                  const g = Number(e.target.value);
                  if (Number.isFinite(g)) {
                    void onIngredientGramsChange(dayIndex, slot, ing.product_id, g);
                  }
                }}
              />
            ) : (
              <span className="font-medium text-gold">{displayGrams(ing.grams)} г</span>
            )}
          </li>
        ))}
      </ul>

      {item.requires_cooking && item.steps.length > 0 ? (
        <div className="mt-4 border-t border-gold/10 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-warm-gray">
            <ChefHat className="h-3.5 w-3.5" /> Приготовление · {item.prep_time_min ?? "—"} мин
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-warm-gray">
            {item.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="mt-4 text-sm text-warm-gray">
          {item.snack_action ?? item.steps[0] ?? "Собрать и съесть."}
        </p>
      )}
    </div>
  );
}
