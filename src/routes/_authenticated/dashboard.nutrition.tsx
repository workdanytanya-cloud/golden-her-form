import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { NutritionView } from "@/components/panel/NutritionView";
import { NutritionSetup } from "@/components/panel/NutritionSetup";
import { useAuth } from "@/lib/auth";
import {
  loadDishes,
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
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [suggested, setSuggested] = useState({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const [d, p, prof] = await Promise.all([
      loadDishes(),
      loadPlanFor(effectiveUserId),
      loadTargetProfile(effectiveUserId),
    ]);
    setDishes(d);
    setPlan(p.plan);
    setDays(p.days);
    setSuggested(calcTargets(prof));
    setAutoExcluded(extractExcludedFromText(prof.allergies, prof.disliked_foods));
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
        dishes,
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
      <NutritionSetup
        initialMeals={(plan?.meals_per_day as 3 | 5) ?? 5}
        initialPreferred={plan?.preferred_products}
        suggestedTargets={suggested}
        autoExcluded={autoExcluded}
        onCancel={plan ? () => setShowSetup(false) : undefined}
        onSubmit={handleGenerate}
        submitLabel={plan ? "Пересобрать меню" : "Сгенерировать меню"}
      />
    );
  }

  const dayEntries: DayEntry[] = days.map((d) => ({
    day_index: d.day_index,
    day_note: d.day_note,
    meals: d.meals,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
