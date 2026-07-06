import { useMemo, useState } from "react";
import { RefreshCcw, Replace, StickyNote, ChefHat, Info, Utensils } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  type Dish,
  type DayEntry,
  type MealEntry,
  type Slot,
  type NutritionTargets,
  SLOT_LABEL,
  WEEKDAY_LABELS,
  computeMealNutrition,
  dayTotals,
  slotsFor,
} from "@/lib/nutrition";

type Props = {
  dishes: Dish[];
  days: DayEntry[];
  targets: NutritionTargets;
  mealsPerDay: 3 | 5;
  editable: boolean; // trainer/admin
  onSwap?: (dayIndex: number, slot: Slot, newDishId: string) => Promise<void>;
  onPortionChange?: (dayIndex: number, slot: Slot, portion_g: number) => Promise<void>;
  onDayNote?: (dayIndex: number, note: string) => Promise<void>;
  onMealNote?: (dayIndex: number, slot: Slot, note: string) => Promise<void>;
  onRegenerate?: () => Promise<void>;
};

export function NutritionView({
  dishes,
  days,
  targets,
  mealsPerDay,
  editable,
  onSwap,
  onPortionChange,
  onDayNote,
  onMealNote,
  onRegenerate,
}: Props) {
  const dishesById = useMemo(() => {
    const m: Record<string, Dish> = {};
    for (const d of dishes) m[d.id] = d;
    return m;
  }, [dishes]);

  const [dayIndex, setDayIndex] = useState(0);
  const [openMeal, setOpenMeal] = useState<{ slot: Slot; meal: MealEntry } | null>(null);

  const day = days.find((d) => d.day_index === dayIndex) ?? days[0];
  const slots = slotsFor(mealsPerDay);
  const totals = day ? dayTotals(day.meals, dishesById) : { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };

  return (
    <div className="space-y-6">
      {/* Targets */}
      <div className="grid gap-3 sm:grid-cols-4">
        <TargetCard label="Ккал" value={Math.round(totals.kcal)} target={targets.kcal} tone="gold" />
        <TargetCard label="Белки, г" value={Math.round(totals.protein_g)} target={targets.protein_g} />
        <TargetCard label="Жиры, г" value={Math.round(totals.fat_g)} target={targets.fat_g} />
        <TargetCard label="Углеводы, г" value={Math.round(totals.carbs_g)} target={targets.carbs_g} />
      </div>

      {/* Day tabs */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => setDayIndex(i)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition-colors",
                i === dayIndex
                  ? "border-gold/60 bg-gradient-to-r from-coral/20 to-gold/15 text-ivory"
                  : "border-gold/20 text-warm-gray hover:text-ivory",
              ].join(" ")}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.slice(0, 2)}</span>
            </button>
          ))}
        </div>
        {editable && onRegenerate && (
          <button
            type="button"
            onClick={() => void onRegenerate()}
            className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-3 py-1.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Пересобрать неделю
          </button>
        )}
      </div>

      {/* Meals */}
      <div className="space-y-3">
        {slots.map((slot) => {
          const meal = day?.meals.find((m) => m.slot === slot);
          const dish = meal ? dishesById[meal.dish_id] : null;
          if (!meal || !dish) {
            return (
              <div
                key={slot}
                className="rounded-2xl border border-dashed border-gold/20 bg-surface/30 p-5 text-warm-gray"
              >
                {SLOT_LABEL[slot]} — не задано
              </div>
            );
          }
          const n = computeMealNutrition(dish, meal.portion_g);
          return (
            <button
              type="button"
              key={slot}
              onClick={() => setOpenMeal({ slot, meal })}
              className="w-full rounded-2xl border border-gold/15 bg-surface/40 p-5 text-left transition-colors hover:border-gold/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-widest text-warm-gray">
                    {SLOT_LABEL[slot]}
                  </p>
                  <p className="mt-1 font-display text-lg text-ivory">{dish.name}</p>
                  <p className="mt-1 text-xs text-warm-gray">
                    Порция {meal.portion_g} г готового блюда
                  </p>
                  {meal.note && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-gold/10 px-2 py-1 text-[11px] text-gold">
                      <StickyNote className="h-3 w-3" /> {meal.note}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-xl text-gold">{Math.round(n.kcal)}</p>
                  <p className="text-[10px] uppercase tracking-widest text-warm-gray">ккал</p>
                  <p className="mt-1 text-[11px] text-warm-gray">
                    Б {Math.round(n.protein_g)} · Ж {Math.round(n.fat_g)} · У {Math.round(n.carbs_g)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Day note */}
      <DayNote
        note={day?.day_note ?? ""}
        editable={editable}
        onSave={(v) => onDayNote?.(dayIndex, v) ?? Promise.resolve()}
      />

      {/* Meal dialog */}
      {openMeal && (
        <MealDialog
          key={`${openMeal.slot}-${openMeal.meal.dish_id}-${openMeal.meal.portion_g}`}
          dish={dishesById[openMeal.meal.dish_id]}
          meal={openMeal.meal}
          allDishes={dishes}
          editable={editable}
          onClose={() => setOpenMeal(null)}
          onSwap={async (newId) => {
            await onSwap?.(dayIndex, openMeal.slot, newId);
            setOpenMeal(null);
          }}
          onPortion={async (g) => {
            await onPortionChange?.(dayIndex, openMeal.slot, g);
            setOpenMeal((s) => (s ? { ...s, meal: { ...s.meal, portion_g: g } } : null));
          }}
          onNote={async (note) => {
            await onMealNote?.(dayIndex, openMeal.slot, note);
            setOpenMeal((s) => (s ? { ...s, meal: { ...s.meal, note } } : null));
          }}
        />
      )}
    </div>
  );
}

function TargetCard({
  label,
  value,
  target,
  tone,
}: {
  label: string;
  value: number;
  target: number;
  tone?: "gold";
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br p-4 ring-1 backdrop-blur ${
        tone === "gold"
          ? "from-gold/15 to-transparent ring-gold/40"
          : "from-surface/60 to-transparent ring-gold/15"
      }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-warm-gray">{label}</p>
      <p className="mt-1 font-display text-xl text-ivory">
        {value} <span className="text-sm text-warm-gray">/ {target}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-coral to-gold"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DayNote({
  note,
  editable,
  onSave,
}: {
  note: string;
  editable: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [value, setValue] = useState(note);
  const [saving, setSaving] = useState(false);

  if (!editable && !note) return null;

  return (
    <div className="rounded-2xl border border-gold/15 bg-surface/30 p-4">
      <p className="text-[11px] uppercase tracking-widest text-warm-gray">
        Комментарий тренера к дню
      </p>
      {editable ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory outline-none focus:border-gold/60"
            placeholder="Например: сегодня без углеводов на ужин"
          />
          <button
            type="button"
            disabled={saving || value === note}
            onClick={async () => {
              setSaving(true);
              await onSave(value);
              setSaving(false);
              toast.success("Комментарий сохранён");
            }}
            className="mt-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-1.5 text-xs uppercase tracking-widest text-background disabled:opacity-50"
          >
            Сохранить
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-ivory">{note}</p>
      )}
    </div>
  );
}

function MealDialog({
  dish,
  meal,
  allDishes,
  editable,
  onClose,
  onSwap,
  onPortion,
  onNote,
}: {
  dish: Dish;
  meal: MealEntry;
  allDishes: Dish[];
  editable: boolean;
  onClose: () => void;
  onSwap: (id: string) => Promise<void>;
  onPortion: (g: number) => Promise<void>;
  onNote: (v: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"recipe" | "swap" | "adjust">("recipe");
  const [portion, setPortion] = useState(meal.portion_g);
  const [note, setNote] = useState(meal.note ?? "");

  const replacements = useMemo(() => {
    const bySlug: Record<string, Dish> = {};
    for (const d of allDishes) bySlug[d.slug] = d;
    // include explicit replacements + all others of same meal_type
    const explicit = dish.replacements.map((s) => bySlug[s]).filter(Boolean) as Dish[];
    const sameType = allDishes.filter((d) => d.meal_type === dish.meal_type && d.id !== dish.id);
    const seen = new Set(explicit.map((d) => d.id));
    for (const d of sameType) if (!seen.has(d.id)) explicit.push(d);
    return explicit;
  }, [dish, allDishes]);

  const n = computeMealNutrition(dish, portion);
  const ratio = portion / dish.portion_weight_g;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-background text-ivory">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{dish.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-warm-gray">{dish.description}</p>

        <div className="grid grid-cols-4 gap-2 rounded-xl bg-surface/50 p-2 text-xs">
          <span className="text-center text-warm-gray">
            <b className="text-ivory">{Math.round(n.kcal)}</b> ккал
          </span>
          <span className="text-center text-warm-gray">
            Б <b className="text-ivory">{n.protein_g.toFixed(1)}</b>
          </span>
          <span className="text-center text-warm-gray">
            Ж <b className="text-ivory">{n.fat_g.toFixed(1)}</b>
          </span>
          <span className="text-center text-warm-gray">
            У <b className="text-ivory">{n.carbs_g.toFixed(1)}</b>
          </span>
        </div>

        <div className="flex gap-1 border-b border-gold/15">
          <TabBtn active={tab === "recipe"} onClick={() => setTab("recipe")} icon={<ChefHat className="h-3.5 w-3.5" />}>
            Рецепт
          </TabBtn>
          {editable && (
            <>
              <TabBtn active={tab === "swap"} onClick={() => setTab("swap")} icon={<Replace className="h-3.5 w-3.5" />}>
                Замена
              </TabBtn>
              <TabBtn active={tab === "adjust"} onClick={() => setTab("adjust")} icon={<Info className="h-3.5 w-3.5" />}>
                Порция и заметка
              </TabBtn>
            </>
          )}
          {!editable && (
            <TabBtn active={tab === "swap"} onClick={() => setTab("swap")} icon={<Replace className="h-3.5 w-3.5" />}>
              Замены
            </TabBtn>
          )}
        </div>

        {tab === "recipe" && (
          <div className="space-y-4">
            <section>
              <h4 className="text-[11px] uppercase tracking-widest text-warm-gray">
                Ингредиенты на порцию {portion} г
              </h4>
              <ul className="mt-2 space-y-1 text-sm">
                {dish.ingredients.map((ing, i) => {
                  const raw = Math.round(ing.raw_g * ratio);
                  const cooked = Math.round(ing.cooked_g * ratio);
                  const lower = ing.raw.toLowerCase();
                  const isEggWhite = /белок/.test(lower) && /яич|яйц/.test(lower);
                  const isWholeEgg =
                    !isEggWhite && (/\bяйц/.test(lower) || /яйцо|яйца|яичн/.test(lower));
                  let amount: string;
                  if (isEggWhite) {
                    const pcs = Math.max(1, Math.round(raw / 33));
                    amount = `${pcs} шт (~${pcs * 33} г белка)`;
                  } else if (isWholeEgg) {
                    const pcs = Math.max(1, Math.round(raw / 50));
                    amount = `${pcs} шт (~${pcs * 50} г)`;
                  } else {
                    amount = `${raw} г сырого / ${cooked} г готового`;
                  }
                  return (
                    <li
                      key={i}
                      className="flex items-center justify-between border-b border-gold/10 py-1.5"
                    >
                      <span className="text-ivory">{ing.raw}</span>
                      <span className="text-warm-gray">{amount}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section>
              <h4 className="text-[11px] uppercase tracking-widest text-warm-gray">Приготовление</h4>
              <ol className="mt-2 space-y-2 text-sm text-ivory">
                {dish.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/25 text-[10px] font-bold text-ivory">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}

        {tab === "swap" && (
          <div className="space-y-2">
            <p className="text-xs text-warm-gray">
              {editable
                ? "Выберите блюдо для замены — КБЖУ дня пересчитается автоматически."
                : "Варианты замены с сопоставимым КБЖУ:"}
            </p>
            {replacements.slice(0, 8).map((d) => {
              const rep_portion = Math.round(
                (dish.portion_weight_g * dish.calories_per_100g) / Math.max(d.calories_per_100g, 1) / 5,
              ) * 5;
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gold/15 bg-surface/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ivory">{d.name}</p>
                    <p className="text-[11px] text-warm-gray">
                      Порция ~{rep_portion} г · {Math.round((d.calories_per_100g * rep_portion) / 100)} ккал
                    </p>
                  </div>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => void onSwap(d.id)}
                      className="shrink-0 rounded-full bg-gradient-to-r from-coral to-gold px-3 py-1.5 text-[11px] uppercase tracking-widest text-background"
                    >
                      Заменить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "adjust" && editable && (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-warm-gray">
                Порция готового блюда (г)
              </label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={60}
                  max={600}
                  step={5}
                  value={portion}
                  onChange={(e) => setPortion(Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  value={portion}
                  onChange={(e) => setPortion(Number(e.target.value))}
                  className="w-20 rounded-lg border border-gold/20 bg-background/40 px-2 py-1 text-sm text-ivory"
                />
              </div>
              <button
                type="button"
                onClick={() => void onPortion(portion)}
                disabled={portion === meal.portion_g}
                className="mt-3 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background disabled:opacity-50"
              >
                Сохранить порцию
              </button>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-warm-gray">
                Комментарий клиенту (виден в приложении)
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory outline-none focus:border-gold/60"
                placeholder="Например: не забудь запить водой"
              />
              <button
                type="button"
                onClick={() => void onNote(note)}
                disabled={note === (meal.note ?? "")}
                className="mt-2 rounded-full border border-gold/30 px-4 py-1.5 text-xs uppercase tracking-widest text-ivory disabled:opacity-50"
              >
                Сохранить комментарий
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs uppercase tracking-widest transition-colors",
        active ? "border-gold text-ivory" : "border-transparent text-warm-gray hover:text-ivory",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

export function NutritionEmpty() {
  return (
    <div className="rounded-3xl border border-dashed border-gold/25 bg-surface/30 p-10 text-center">
      <Utensils className="mx-auto h-8 w-8 text-gold" />
      <p className="mt-3 font-display text-xl text-ivory">Меню ещё не составлено</p>
      <p className="mt-1 text-sm text-warm-gray">
        Ответьте на 2 вопроса, и мы сгенерируем персональное недельное меню.
      </p>
    </div>
  );
}
