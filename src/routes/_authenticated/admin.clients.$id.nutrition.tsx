import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { NutritionView } from "@/components/panel/NutritionView";
import { NutritionSetup } from "@/components/panel/NutritionSetup";
import { supabase } from "@/integrations/supabase/client";
import {
  loadDishes,
  loadPlanFor,
  loadTargetProfile,
  extractExcludedFromText,
  createOrReplacePlan,
  updateDayMeals,
  replaceMeal,
  scalePortionForSwap,
  type PlanRow,
  type DayRow,
  type Dish,
} from "@/lib/nutrition-repo";
import { calcTargets, type Slot, type NutritionTargets } from "@/lib/nutrition";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/nutrition")({
  component: AdminNutritionPage,
});

function AdminNutritionPage() {
  const { id } = Route.useParams();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [suggested, setSuggested] = useState<NutritionTargets>({
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
  });
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

  const reload = async () => {
    setLoading(true);
    const [d, p, prof, profRow] = await Promise.all([
      loadDishes(),
      loadPlanFor(id),
      loadTargetProfile(id),
      supabase.from("profiles").select("full_name").eq("id", id).maybeSingle(),
    ]);
    setDishes(d);
    setPlan(p.plan);
    setDays(p.days);
    setSuggested(calcTargets(prof));
    setAutoExcluded(extractExcludedFromText(prof.allergies, prof.disliked_foods));
    setProfileName(profRow.data?.full_name ?? "Клиент");
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleGenerate = async (opts: { mealsPerDay: 3 | 5; preferred: string[] }) => {
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
        userId: id,
        mealsPerDay: opts.mealsPerDay,
        preferred: opts.preferred,
        excluded: autoExcluded,
        targets,
        targetsManual: plan?.targets_manual,
        dishes,
      });
      await reload();
      setShowSetup(false);
      toast.success("Меню обновлено");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const dishesById = Object.fromEntries(dishes.map((d) => [d.id, d]));

  const patchDay = async (dayIndex: number, mutator: (meals: DayRow["meals"]) => DayRow["meals"], note?: string) => {
    if (!plan) return;
    const day = days.find((d) => d.day_index === dayIndex);
    if (!day) return;
    const nextMeals = mutator(day.meals);
    await updateDayMeals(plan.id, dayIndex, nextMeals, note);
    setDays((cur) =>
      cur.map((d) =>
        d.day_index === dayIndex ? { ...d, meals: nextMeals, day_note: note ?? d.day_note } : d,
      ),
    );
  };

  const handleSwap = async (dayIndex: number, slot: Slot, newDishId: string) => {
    const day = days.find((d) => d.day_index === dayIndex);
    const meal = day?.meals.find((m) => m.slot === slot);
    const oldDish = meal ? dishesById[meal.dish_id] : null;
    const newDish = dishesById[newDishId];
    if (!meal || !oldDish || !newDish) return;
    const portion = scalePortionForSwap(oldDish, meal.portion_g, newDish);
    await patchDay(dayIndex, (meals) =>
      replaceMeal(meals, slot, { dish_id: newDishId, portion_g: portion, note: null }),
    );
    toast.success("Блюдо заменено");
  };

  const handlePortion = async (dayIndex: number, slot: Slot, portion_g: number) => {
    await patchDay(dayIndex, (meals) => replaceMeal(meals, slot, { portion_g }));
    toast.success("Порция обновлена");
  };

  const handleMealNote = async (dayIndex: number, slot: Slot, note: string) => {
    await patchDay(dayIndex, (meals) => replaceMeal(meals, slot, { note: note || null }));
    toast.success("Заметка сохранена");
  };

  const handleDayNote = async (dayIndex: number, note: string) => {
    const day = days.find((d) => d.day_index === dayIndex);
    if (!day) return;
    await patchDay(dayIndex, (meals) => meals, note);
  };

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем…</div>;

  return (
    <div className="space-y-8">
      <Link
        to="/admin/clients/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-sm text-warm-gray hover:text-ivory"
      >
        <ArrowLeft className="h-4 w-4" /> К карточке клиента
      </Link>

      <PanelHeader
        eyebrow="Меню"
        title={profileName}
        description="Индивидуальный план питания. Замены и порции пересчитывают КБЖУ дня автоматически."
        action={
          plan && (
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
            >
              <Sparkles className="h-3.5 w-3.5" /> Пересобрать целиком
            </button>
          )
        }
      />

      {plan && (
        <TargetsEditor
          plan={plan}
          suggested={suggested}
          onSave={async (targets, manual, notes) => {
            // Save the new targets + notes first
            const { error } = await supabase
              .from("nutrition_plans")
              .update({
                target_kcal: targets.kcal,
                target_protein_g: targets.protein_g,
                target_fat_g: targets.fat_g,
                target_carbs_g: targets.carbs_g,
                targets_manual: manual,
                notes,
              })
              .eq("id", plan.id);
            if (error) {
              toast.error(error.message);
              return;
            }

            // If any target actually changed, regenerate the menu so KБЖУ per day
            // matches the new targets and totals stay consistent.
            const changed =
              targets.kcal !== plan.target_kcal ||
              targets.protein_g !== plan.target_protein_g ||
              targets.fat_g !== plan.target_fat_g ||
              targets.carbs_g !== plan.target_carbs_g;

            if (changed) {
              try {
                await createOrReplacePlan({
                  userId: id,
                  mealsPerDay: (plan.meals_per_day as 3 | 5) ?? 5,
                  preferred: plan.preferred_products ?? [],
                  excluded: [...(plan.excluded_products ?? []), ...autoExcluded],
                  targets,
                  targetsManual: manual,
                  dishes,
                });
                toast.success("Параметры сохранены — меню пересчитано");
              } catch (e) {
                toast.error(`Меню не пересобралось: ${(e as Error).message}`);
              }
            } else {
              toast.success("Параметры сохранены");
            }
            await reload();
          }}
        />
      )}


      {!plan || showSetup ? (
        <NutritionSetup
          initialMeals={(plan?.meals_per_day as 3 | 5) ?? 5}
          initialPreferred={plan?.preferred_products}
          suggestedTargets={suggested}
          autoExcluded={autoExcluded}
          onCancel={plan ? () => setShowSetup(false) : undefined}
          onSubmit={handleGenerate}
          submitLabel={plan ? "Пересобрать меню" : "Сгенерировать меню"}
        />
      ) : (
        <NutritionView
          dishes={dishes}
          days={days.map((d) => ({ day_index: d.day_index, day_note: d.day_note, meals: d.meals }))}
          targets={{
            kcal: plan.target_kcal,
            protein_g: plan.target_protein_g,
            fat_g: plan.target_fat_g,
            carbs_g: plan.target_carbs_g,
          }}
          mealsPerDay={plan.meals_per_day as 3 | 5}
          editable={true}
          onSwap={handleSwap}
          onPortionChange={handlePortion}
          onMealNote={handleMealNote}
          onDayNote={handleDayNote}
          onRegenerate={() => {
            setShowSetup(true);
            return Promise.resolve();
          }}
        />
      )}
    </div>
  );
}

function TargetsEditor({
  plan,
  suggested,
  onSave,
}: {
  plan: PlanRow;
  suggested: NutritionTargets;
  onSave: (t: NutritionTargets, manual: boolean, notes: string | null) => Promise<void>;
}) {
  const [t, setT] = useState<NutritionTargets>({
    kcal: plan.target_kcal,
    protein_g: plan.target_protein_g,
    fat_g: plan.target_fat_g,
    carbs_g: plan.target_carbs_g,
  });
  const [manual, setManual] = useState(plan.targets_manual);
  const [notes, setNotes] = useState(plan.notes ?? "");

  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">Целевые КБЖУ</p>
          <p className="mt-1 text-sm text-warm-gray">
            Автосчёт по анкете: <b className="text-ivory">{suggested.kcal}</b> ккал · Б{" "}
            {suggested.protein_g} · Ж {suggested.fat_g} · У {suggested.carbs_g}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-warm-gray">
          <input
            type="checkbox"
            checked={manual}
            onChange={(e) => setManual(e.target.checked)}
            className="h-4 w-4 rounded border-gold/40 bg-background"
          />
          Ручная корректировка
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["kcal", "protein_g", "fat_g", "carbs_g"] as const).map((k) => (
          <label key={k} className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
              {k === "kcal" ? "Ккал" : k === "protein_g" ? "Белки" : k === "fat_g" ? "Жиры" : "Углеводы"}
            </span>
            <input
              type="number"
              value={t[k]}
              disabled={!manual}
              onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })}
              className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory disabled:opacity-60"
            />
          </label>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
          Общий комментарий к плану
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          placeholder="Например: пьём 2 л воды в день, соль ограничиваем"
        />
      </label>

      <button
        type="button"
        onClick={() => void onSave(t, manual, notes || null)}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background hover:scale-[1.02]"
      >
        <Save className="h-3.5 w-3.5" /> Сохранить настройки
      </button>
    </section>
  );
}
