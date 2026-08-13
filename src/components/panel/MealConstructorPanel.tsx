import { useMemo, useState } from "react";
import { Check, Layers, Loader2 } from "lucide-react";
import { type Dish, type MealEntry, type Slot } from "@/lib/nutrition";
import type { MealPattern } from "@/lib/plan-options";
import {
  buildMealConstructorForDay,
  type MealConstructorOption,
} from "@/lib/meal-constructor";

type Props = {
  dayIndex: number;
  slots: Slot[];
  meals: MealEntry[];
  dishesById: Record<string, Dish>;
  swapPool: Dish[];
  preferredProducts?: string[];
  excludedProducts?: string[];
  mealPattern?: MealPattern;
  onSelect: (slot: Slot, dishId: string) => Promise<void>;
};

export function MealConstructorPanel({
  dayIndex,
  slots,
  meals,
  dishesById,
  swapPool,
  preferredProducts,
  excludedProducts,
  mealPattern,
  onSelect,
}: Props) {
  const [pending, setPending] = useState<string | null>(null);

  const constructorSlots = useMemo(
    () =>
      buildMealConstructorForDay({
        slots,
        meals,
        dishesById,
        swapPool,
        preferredProducts,
        excludedProducts,
        mealPattern,
      }),
    [slots, meals, dishesById, swapPool, preferredProducts, excludedProducts, mealPattern],
  );

  if (constructorSlots.length === 0) return null;

  const handlePick = async (slot: Slot, option: MealConstructorOption) => {
    if (option.isActive) return;
    const key = `${dayIndex}-${slot}-${option.key}`;
    setPending(key);
    try {
      await onSelect(slot, option.dish.id);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="rounded-2xl border border-gold/20 bg-gradient-to-br from-surface/50 to-transparent p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15">
          <Layers className="h-4 w-4 text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-widest text-gold">Конструктор меню</p>
          <p className="mt-1 text-sm text-warm-gray">
            Для каждого приёма пищи — варианты A, B и C с пересчётом порции под те же калории.
            Выберите удобный вариант — программа сохранится.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {constructorSlots.map(({ slot, label, options }) => (
          <div key={slot}>
            <p className="text-[11px] uppercase tracking-widest text-warm-gray">{label}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {options.map((option) => {
                const pendingKey = `${dayIndex}-${slot}-${option.key}`;
                const isLoading = pending === pendingKey;
                return (
                  <OptionCard
                    key={option.key}
                    option={option}
                    loading={isLoading}
                    disabled={pending !== null && !isLoading}
                    onClick={() => void handlePick(slot, option)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OptionCard({
  option,
  loading,
  disabled,
  onClick,
}: {
  option: MealConstructorOption;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const active = option.isActive;

  return (
    <button
      type="button"
      disabled={active || disabled || loading}
      onClick={onClick}
      className={[
        "relative rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-gold/50 bg-gold/10 ring-1 ring-gold/30"
          : "border-gold/15 bg-background/30 hover:border-gold/35 hover:bg-gold/5",
        disabled && !active ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={[
            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
            active ? "bg-gold text-background" : "bg-surface text-gold",
          ].join(" ")}
        >
          {option.key}
        </span>
        {active && <Check className="h-4 w-4 text-gold" />}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-ivory">{option.dish.name}</p>
      <p className="mt-1 text-[11px] text-warm-gray">Порция {option.portion_g} г</p>
      <p className="mt-2 text-xs text-warm-gray">
        <span className="font-display text-base text-gold">{Math.round(option.kcal)}</span> ккал
      </p>
      <p className="text-[10px] text-warm-gray">
        Б {Math.round(option.protein_g)} · Ж {Math.round(option.fat_g)} · У {Math.round(option.carbs_g)}
      </p>
    </button>
  );
}
