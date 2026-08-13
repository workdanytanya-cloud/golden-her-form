import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { NutritionView } from "@/components/panel/NutritionView";
import { FoodSwapGuide } from "@/components/panel/FoodSwapGuide";
import { useAuth } from "@/lib/auth";
import {
  loadDishesForClient,
  loadPlanFor,
  loadTargetProfile,
  extractExcludedFromText,
  createOrReplacePlan,
  updateDayMeals,
  replaceMeal,
  scalePortionForSwap,
  dishIdsFromPlanDays,
  type PlanRow,
  type DayRow,
  type Dish,
} from "@/lib/nutrition-repo";
import { type DayEntry, type Slot } from "@/lib/nutrition";
import { mergeUnique } from "@/lib/food-products";
import {
  complexityLabel,
  decodePlanMeta,
  mealsChoiceFromPlan,
  mealsChoiceLabel,
} from "@/lib/plan-options";

export const Route = createFileRoute("/_authenticated/dashboard/nutrition")({
  component: NutritionPage,
});

function NutritionPage() {
  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Курс"
        title="Питание"
        description="Фиксированное меню на 4 недели. Состав меняет тренер; вы можете только перетасовать уже подобранные блюда."
      />
      <AccessGate level="active">
        <NutritionInner />
      </AccessGate>
    </div>
  );
}

function NutritionInner() {
  const { effectiveUserId } = useAuth();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reshuffling, setReshuffling] = useState(false);

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const p = await loadPlanFor(effectiveUserId);
    const planIds = p.days.flatMap((d) => d.meals.map((m) => m.dish_id));
    const [{ all }, prof] = await Promise.all([
      loadDishesForClient(effectiveUserId, planIds),
      loadTargetProfile(effectiveUserId),
    ]);
    // Клиент только читает план: без авто-пересборки при открытии страницы.
    setDishes(all);
    setPlan(p.plan);
    setDays(p.days);
    setAutoExcluded(extractExcludedFromText(prof.allergies, prof.disliked_foods));
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId]);

  const planDishIds = useMemo(() => dishIdsFromPlanDays(days), [days]);
  const swapPool = useMemo(() => {
    if (!planDishIds.length) return dishes;
    const allow = new Set(planDishIds);
    return dishes.filter((d) => allow.has(d.id));
  }, [dishes, planDishIds]);

  const handleReshuffle = async () => {
    if (!effectiveUserId || !plan) return;
    setReshuffling(true);
    try {
      const meta = decodePlanMeta(plan.preferred_products);
      await createOrReplacePlan({
        userId: effectiveUserId,
        mealsPerDay: plan.meals_per_day as 3 | 5,
        preferred: plan.preferred_products ?? [],
        excluded: mergeUnique(autoExcluded, plan.excluded_products ?? []),
        targets: {
          kcal: plan.target_kcal,
          protein_g: plan.target_protein_g,
          fat_g: plan.target_fat_g,
          carbs_g: plan.target_carbs_g,
        },
        targetsManual: true,
        dishes,
        recipeComplexity: meta.complexity,
        mealPattern: meta.pattern,
        restrictToDishIds: planDishIds,
      });
      await reload();
      toast.success("Меню перетасовано из ваших подобранных блюд");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReshuffling(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем меню…</div>;

  if (!plan || days.length === 0) {
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center text-warm-gray">
        Меню пока не назначено. Тренер соберёт фиксированный рацион на 4 недели.
      </div>
    );
  }

  const planMeta = decodePlanMeta(plan.preferred_products);
  const mealsChoice = mealsChoiceFromPlan(plan.meals_per_day, plan.preferred_products);

  const dayEntries: DayEntry[] = days.map((d) => ({
    day_index: d.day_index,
    day_note: d.day_note,
    meals: d.meals,
  }));

  const dishesById = Object.fromEntries(dishes.map((d) => [d.id, d]));

  const handleSwap = async (dayIndex: number, slot: Slot, newDishId: string) => {
    if (!plan) return;
    if (planDishIds.length && !planDishIds.includes(newDishId)) {
      toast.error("Можно выбирать только блюда из вашего назначенного рациона");
      return;
    }
    const day = days.find((d) => d.day_index === dayIndex);
    const meal = day?.meals.find((m) => m.slot === slot);
    const oldDish = meal ? dishesById[meal.dish_id] : null;
    const newDish = dishesById[newDishId];
    if (!meal || !oldDish || !newDish) return;
    const portion = scalePortionForSwap(oldDish, meal.portion_g, newDish);
    const nextMeals = replaceMeal(day.meals, slot, {
      dish_id: newDishId,
      portion_g: portion,
      note: null,
    });
    try {
      await updateDayMeals(plan.id, dayIndex, nextMeals);
      setDays((cur) =>
        cur.map((d) => (d.day_index === dayIndex ? { ...d, meals: nextMeals } : d)),
      );
      toast.success("Блюдо заменено");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить замену");
      throw e;
    }
  };

  return (
    <div className="space-y-6">
      <FoodSwapGuide />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-sm text-warm-gray">
          {mealsChoiceLabel(mealsChoice)} · {complexityLabel(planMeta.complexity)} · целевые{" "}
          <b className="text-ivory">{plan.target_kcal}</b> ккал
        </p>
        <button
          type="button"
          disabled={reshuffling || planDishIds.length < 3}
          onClick={() => void handleReshuffle()}
          className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reshuffling ? "animate-spin" : ""}`} />
          {reshuffling ? "Пересобираем…" : "Пересобрать меню"}
        </button>
      </div>

      {plan.notes && (
        <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/10 to-transparent p-4 text-sm text-ivory">
          <p className="text-[11px] uppercase tracking-widest text-gold">Комментарий тренера</p>
          <p className="mt-1">{plan.notes}</p>
        </div>
      )}

      <NutritionView
        dishes={dishes}
        swapDishes={swapPool}
        days={dayEntries}
        targets={{
          kcal: plan.target_kcal,
          protein_g: plan.target_protein_g,
          fat_g: plan.target_fat_g,
          carbs_g: plan.target_carbs_g,
        }}
        mealsPerDay={plan.meals_per_day as 3 | 5}
        mealPattern={planMeta.pattern}
        preferredProducts={plan.preferred_products ?? []}
        excludedProducts={mergeUnique(autoExcluded, plan.excluded_products ?? [])}
        editable={false}
        onSwap={handleSwap}
      />
    </div>
  );
}
