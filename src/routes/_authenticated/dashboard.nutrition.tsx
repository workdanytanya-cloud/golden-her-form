import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { NutritionView } from "@/components/panel/NutritionView";
import { NutritionSetup } from "@/components/panel/NutritionSetup";
import { FoodSwapGuide } from "@/components/panel/FoodSwapGuide";
import { useAuth } from "@/lib/auth";
import {
  loadDishes,
  loadDishesForClient,
  loadPlanFor,
  loadTargetProfile,
  extractExcludedFromText,
  createOrReplacePlan,
  type PlanRow,
  type DayRow,
  type Dish,
} from "@/lib/nutrition-repo";
import { calcTargets, type DayEntry } from "@/lib/nutrition";

export const Route = createFileRoute("/_authenticated/dashboard/nutrition")({
  component: NutritionPage,
});

function NutritionPage() {
  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Курс"
        title="Питание"
        description="Персональное недельное меню на основе анкеты, любимых продуктов и целевого КБЖУ."
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
  const [swapDishes, setSwapDishes] = useState<Dish[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [suggested, setSuggested] = useState({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const p = await loadPlanFor(effectiveUserId);
    const planIds = p.days.flatMap((d) => d.meals.map((m) => m.dish_id));
    const [{ all, pool }, prof] = await Promise.all([
      loadDishesForClient(effectiveUserId, planIds),
      loadTargetProfile(effectiveUserId),
    ]);
    const d = all;
    const freshTargets = calcTargets(prof);
    const freshExcluded = extractExcludedFromText(prof.allergies, prof.disliked_foods);

    // Auto-refresh: если анкета/замеры изменились и КБЖУ не зафиксированы тренером —
    // пересобираем план под новые цифры.
    let finalPlan = p.plan;
    let finalDays = p.days;
    if (p.plan && !p.plan.targets_manual) {
      const targetsChanged =
        p.plan.target_kcal !== freshTargets.kcal ||
        p.plan.target_protein_g !== freshTargets.protein_g ||
        p.plan.target_fat_g !== freshTargets.fat_g ||
        p.plan.target_carbs_g !== freshTargets.carbs_g;
      const excludedChanged =
        [...(p.plan.excluded_products ?? [])].sort().join("|") !==
        [...freshExcluded].sort().join("|");
      if (targetsChanged || excludedChanged) {
        try {
          const res = await createOrReplacePlan({
            userId: effectiveUserId,
            mealsPerDay: (p.plan.meals_per_day as 3 | 5),
            preferred: p.plan.preferred_products ?? [],
            excluded: freshExcluded,
            targets: freshTargets,
            targetsManual: false,
            dishes: await loadDishes(),
          });
          finalPlan = res.plan;
          finalDays = res.days;
          toast.success(
            targetsChanged
              ? `Меню обновлено под новую норму ${freshTargets.kcal} ккал`
              : "Меню обновлено под новые ограничения по продуктам",
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    setDishes(d);
    setSwapDishes(pool);
    setPlan(finalPlan);
    setDays(finalDays);
    setSuggested(freshTargets);
    setAutoExcluded(freshExcluded);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId]);

  const handleGenerate = async (opts: { mealsPerDay: 3 | 5; preferred: string[] }) => {
    if (!effectiveUserId) return;
    try {
      const targets = plan?.targets_manual
        ? {
            kcal: plan.target_kcal,
            protein_g: plan.target_protein_g,
            fat_g: plan.target_fat_g,
            carbs_g: plan.target_carbs_g,
          }
        : suggested;
      await createOrReplacePlan({
        userId: effectiveUserId,
        mealsPerDay: opts.mealsPerDay,
        preferred: opts.preferred,
        excluded: autoExcluded,
        targets,
        targetsManual: plan?.targets_manual,
        dishes: await loadDishes(),
      });
      await reload();
      setShowSetup(false);
      toast.success("Меню готово!");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем меню…</div>;

  if (!plan || showSetup) {
    return (
      <div className="space-y-8">
        <FoodSwapGuide />
        <NutritionSetup
          initialMeals={(plan?.meals_per_day as 3 | 5) ?? 5}
          initialPreferred={plan?.preferred_products}
          suggestedTargets={suggested}
          autoExcluded={autoExcluded}
          onCancel={plan ? () => setShowSetup(false) : undefined}
          onSubmit={handleGenerate}
          submitLabel={plan ? "Пересобрать меню" : "Показать рацион"}
        />
      </div>
    );
  }

  const dayEntries: DayEntry[] = days.map((d) => ({
    day_index: d.day_index,
    day_note: d.day_note,
    meals: d.meals,
  }));

  return (
    <div className="space-y-6">
      <FoodSwapGuide />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-sm text-warm-gray">
          {plan.meals_per_day === 3 ? "3 приёма пищи" : "5 приёмов пищи"} · целевые{" "}
          <b className="text-ivory">{plan.target_kcal}</b> ккал
        </p>
        <button
          type="button"
          onClick={() => setShowSetup(true)}
          className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
        >
          <Settings2 className="h-3.5 w-3.5" /> Изменить параметры
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
        swapDishes={swapDishes}
        days={dayEntries}
        targets={{
          kcal: plan.target_kcal,
          protein_g: plan.target_protein_g,
          fat_g: plan.target_fat_g,
          carbs_g: plan.target_carbs_g,
        }}
        mealsPerDay={plan.meals_per_day as 3 | 5}
        editable={false}
      />
    </div>
  );
}
