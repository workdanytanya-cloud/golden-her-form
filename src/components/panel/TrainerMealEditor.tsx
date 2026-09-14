import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import { d, displayMacro } from "@/lib/nutrition-constructor/decimal-math";
import type { DeviationProposal } from "@/lib/nutrition-constructor/deviation-suggestions";
import {
  allowedProductsForManualMeal,
  eligibleRecipesForManualPick,
} from "@/lib/nutrition-constructor/manual-meals";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import {
  TRAINER_CLOCK_SLOTS,
  TRAINER_MEAL_KIND_LABELS,
  type TrainerClockSlot,
  type TrainerMealKind,
} from "@/lib/nutrition-constructor/trainer-slots";
import type { ConstructorDay, FoodProduct, Recipe } from "@/lib/nutrition-constructor/types";

export type MealEditorMode = "add" | "replace" | "assemble" | "suggest";

export type MealEditorSubmit =
  | {
      kind: "recipe";
      recipe: Recipe;
      mealKind: TrainerMealKind;
      clock: TrainerClockSlot;
    }
  | {
      kind: "manual";
      name: string;
      mealKind: TrainerMealKind;
      clock: TrainerClockSlot;
      lines: Array<{ product: FoodProduct; grams: number }>;
    }
  | {
      kind: "suggest";
      proposal: DeviationProposal;
    };

type Props = {
  open: boolean;
  mode: MealEditorMode;
  day: ConstructorDay | null;
  ctx: OptimizerContext;
  forbiddenIds: Set<string>;
  defaultSlot?: PlanSlot;
  proposals?: DeviationProposal[];
  targetMacro: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  onClose: () => void;
  onSubmit: (value: MealEditorSubmit) => void;
};

export function TrainerMealEditor({
  open,
  mode,
  day,
  ctx,
  forbiddenIds,
  proposals = [],
  targetMacro,
  onClose,
  onSubmit,
}: Props) {
  const [source, setSource] = useState<"suggest" | "recipe" | "manual">(
    mode === "assemble" ? "manual" : mode === "suggest" ? "suggest" : "suggest",
  );
  const [mealKind, setMealKind] = useState<TrainerMealKind>("snack");
  const [clock, setClock] = useState<TrainerClockSlot>("snack3");
  const [recipeId, setRecipeId] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Array<{ productId: string; grams: string }>>([
    { productId: "", grams: "" },
  ]);

  const recipes = useMemo(
    () => eligibleRecipesForManualPick({ ctx, forbiddenIds, mealKind }),
    [ctx, forbiddenIds, mealKind],
  );
  const products = useMemo(
    () => allowedProductsForManualMeal({ ctx, forbiddenIds, mealKind }),
    [ctx, forbiddenIds, mealKind],
  );

  const previewLines = picked
    .map((row) => {
      const product = products.find((p) => p.id === row.productId);
      const grams = Number(row.grams);
      if (!product || !Number.isFinite(grams) || grams <= 0) return null;
      const factor = grams / 100;
      return {
        product,
        grams,
        kcal: Number(product.kcal_per_100g) * factor,
        protein_g: Number(product.protein_per_100g) * factor,
        fat_g: Number(product.fat_per_100g) * factor,
        carbs_g: Number(product.carbs_per_100g) * factor,
      };
    })
    .filter(Boolean) as Array<{
    product: FoodProduct;
    grams: number;
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  }>;

  const mealPreview = previewLines.reduce(
    (acc, line) => ({
      kcal: acc.kcal + line.kcal,
      protein_g: acc.protein_g + line.protein_g,
      fat_g: acc.fat_g + line.fat_g,
      carbs_g: acc.carbs_g + line.carbs_g,
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );

  const dayPreview = day
    ? {
        kcal: Number(day.kcal) + mealPreview.kcal,
        protein_g: Number(day.protein_g) + mealPreview.protein_g,
        fat_g: Number(day.fat_g) + mealPreview.fat_g,
        carbs_g: Number(day.carbs_g) + mealPreview.carbs_g,
      }
    : mealPreview;

  const title =
    mode === "replace"
      ? "Заменить приём"
      : mode === "suggest"
        ? "Предложить варианты"
        : "Добавить приём";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto bg-background text-ivory">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
        </DialogHeader>

        {mode !== "suggest" && (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-warm-gray">Источник</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["suggest", "Предложить подходящие варианты"],
                  ["recipe", "Выбрать готовый рецепт"],
                  ["manual", "Собрать из продуктов вручную"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSource(id)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-widest",
                    source === id
                      ? "border-gold/60 bg-gold/15 text-ivory"
                      : "border-gold/20 text-warm-gray",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
                  Тип
                </span>
                <select
                  value={mealKind}
                  onChange={(e) => setMealKind(e.target.value as TrainerMealKind)}
                  className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
                >
                  {(Object.keys(TRAINER_MEAL_KIND_LABELS) as TrainerMealKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {TRAINER_MEAL_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
                  Слот
                </span>
                <select
                  value={clock}
                  onChange={(e) => setClock(e.target.value as TrainerClockSlot)}
                  className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
                >
                  {TRAINER_CLOCK_SLOTS.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {(mode === "suggest" || source === "suggest") && (
          <div className="space-y-3">
            {proposals.length === 0 ? (
              <p className="text-sm text-warm-gray">
                Нет связанных корректировок. Добавьте приём из рецепта или продуктов, либо измените
                граммовки.
              </p>
            ) : (
              proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="space-y-2 rounded-2xl border border-gold/20 bg-surface/30 p-4 text-sm"
                >
                  <p className="font-medium text-ivory">{proposal.title}</p>
                  <p className="text-warm-gray">{proposal.currentSummary}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gold">Что изменится</p>
                  <ul className="list-disc pl-5 text-warm-gray">
                    {proposal.whatChanges.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-[10px] uppercase tracking-widest text-gold">Новые граммовки</p>
                  <ul className="text-warm-gray">
                    {proposal.newGrams.map((g) => (
                      <li key={`${g.slot}-${g.productId}`}>
                        {g.productName}: {g.fromG} → {g.toG} г
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] uppercase tracking-widest text-gold">
                    Ккал и БЖУ приёма
                  </p>
                  {proposal.mealMacros.map((meal) => (
                    <p key={meal.slot} className="text-warm-gray">
                      {meal.recipeName}: {meal.kcal} ккал · Б{meal.protein_g} · Ж{meal.fat_g} · У
                      {meal.carbs_g}
                    </p>
                  ))}
                  <p className="text-ivory">
                    Итог дня: {proposal.dayTotals.kcal} ккал · Б{proposal.dayTotals.protein_g} · Ж
                    {proposal.dayTotals.fat_g} · У{proposal.dayTotals.carbs_g}
                  </p>
                  <p className="text-warm-gray">Отклонение от цели: {proposal.deviationText}</p>
                  <button
                    type="button"
                    onClick={() => onSubmit({ kind: "suggest", proposal })}
                    className="rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-[10px] uppercase tracking-widest text-background"
                  >
                    Применить это предложение
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {mode !== "suggest" && source === "recipe" && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
                Рецепт
              </span>
              <select
                value={recipeId}
                onChange={(e) => setRecipeId(e.target.value)}
                className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
              >
                <option value="">Выберите рецепт</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!recipeId}
              onClick={() => {
                const recipe = recipes.find((r) => r.id === recipeId);
                if (!recipe) return;
                onSubmit({ kind: "recipe", recipe, mealKind, clock });
              }}
              className="rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-[10px] uppercase tracking-widest text-background disabled:opacity-40"
            >
              Добавить рецепт
            </button>
          </div>
        )}

        {mode !== "suggest" && source === "manual" && (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
                Название приёма
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
                placeholder="Например: Творог с ягодами"
              />
            </label>
            {picked.map((row, idx) => {
              const product = products.find((p) => p.id === row.productId);
              const grams = Number(row.grams);
              const factor = Number.isFinite(grams) && grams > 0 ? grams / 100 : 0;
              return (
                <div key={idx} className="grid gap-2 rounded-xl border border-gold/15 p-3 sm:grid-cols-2">
                  <select
                    value={row.productId}
                    onChange={(e) =>
                      setPicked((cur) =>
                        cur.map((item, i) =>
                          i === idx ? { ...item, productId: e.target.value } : item,
                        ),
                      )
                    }
                    className="rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Продукт</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={row.grams}
                    onChange={(e) =>
                      setPicked((cur) =>
                        cur.map((item, i) => (i === idx ? { ...item, grams: e.target.value } : item)),
                      )
                    }
                    className="rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm"
                    placeholder="Граммы"
                  />
                  {product && factor > 0 && (
                    <p className="sm:col-span-2 text-xs text-warm-gray">
                      {Math.round(Number(product.kcal_per_100g) * factor)} ккал · Б{" "}
                      {(Number(product.protein_per_100g) * factor).toFixed(1)} · Ж{" "}
                      {(Number(product.fat_per_100g) * factor).toFixed(1)} · У{" "}
                      {(Number(product.carbs_per_100g) * factor).toFixed(1)}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setPicked((cur) => cur.filter((_, i) => i !== idx))}
                    className="text-left text-[10px] uppercase tracking-widest text-coral"
                  >
                    Удалить ингредиент
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setPicked((cur) => [...cur, { productId: "", grams: "" }])}
              className="text-xs uppercase tracking-widest text-gold"
            >
              + Ещё продукт
            </button>
            <div className="rounded-xl border border-gold/15 p-3 text-sm text-warm-gray">
              <p>
                Приём: {Math.round(mealPreview.kcal)} ккал · Б {mealPreview.protein_g.toFixed(1)} · Ж{" "}
                {mealPreview.fat_g.toFixed(1)} · У {mealPreview.carbs_g.toFixed(1)}
              </p>
              <p>
                Итог дня с этим приёмом: {Math.round(dayPreview.kcal)} ккал · Б{" "}
                {dayPreview.protein_g.toFixed(1)} · Ж {dayPreview.fat_g.toFixed(1)} · У{" "}
                {dayPreview.carbs_g.toFixed(1)}
              </p>
              <p>
                Цель: {targetMacro.kcal} / Б{targetMacro.protein_g} / Ж{targetMacro.fat_g} / У
                {targetMacro.carbs_g}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onSubmit({
                  kind: "manual",
                  name,
                  mealKind,
                  clock,
                  lines: previewLines.map((line) => ({ product: line.product, grams: line.grams })),
                })
              }
              className="rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-[10px] uppercase tracking-widest text-background"
            >
              Сохранить приём
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function selectedDayComparison(
  day: ConstructorDay | undefined,
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number },
) {
  if (!day) return [];
  return comparisonRows(
    {
      kcal: d(targets.kcal),
      protein_g: d(targets.protein_g),
      fat_g: d(targets.fat_g),
      carbs_g: d(targets.carbs_g),
      fiber_g: d(0),
    },
    {
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(day.fiber_g),
    },
  );
}

export function displayDayMacro(day: ConstructorDay) {
  return displayMacro({
    kcal: d(day.kcal),
    protein_g: d(day.protein_g),
    fat_g: d(day.fat_g),
    carbs_g: d(day.carbs_g),
    fiber_g: d(day.fiber_g),
  });
}
