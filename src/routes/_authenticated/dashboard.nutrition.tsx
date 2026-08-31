import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { ClientCoursePicker } from "@/components/panel/ClientCoursePicker";
import { MealSchedulePicker } from "@/components/panel/MealSchedulePicker";
import { NutritionView } from "@/components/panel/NutritionView";
import { ConstructorNutritionView } from "@/components/panel/ConstructorNutritionView";
import { FoodSwapGuide } from "@/components/panel/FoodSwapGuide";
import { useAuth } from "@/lib/auth";
import { useClientCourses } from "@/lib/client-course-context";
import { type DayEntry } from "@/lib/nutrition";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import { loadClientMealSchedulePreference } from "@/lib/nutrition-constructor/client-preference";
import type { MealScheduleMode, PrimaryMealSlot } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { constructorDaysFromSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import { loadPublishedNutritionFor } from "@/lib/published-programs/repo";
import type { NutritionSnapshot } from "@/lib/published-programs/types";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import type { Dish } from "@/lib/nutrition";

export const Route = createFileRoute("/_authenticated/dashboard/nutrition")({
  component: NutritionPage,
});

function NutritionPage() {
  const { selectedCourse } = useClientCourses();
  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow={selectedCourse?.title ?? "Курс"}
        title="Питание"
        description="Индивидуальный рацион от тренера: 4 приёма в день с точными граммовками и KBJU."
      />
      <AccessGate level="active">
        <div className="space-y-6">
          <ClientCoursePicker />
          <NutritionInner />
        </div>
      </AccessGate>
    </div>
  );
}

function NutritionInner() {
  const { effectiveUserId } = useAuth();
  const { selectedCourseId } = useClientCourses();
  const [snapshot, setSnapshot] = useState<NutritionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferredMode, setPreferredMode] = useState<MealScheduleMode>("two_main_two_snacks");
  const [preferredSlot, setPreferredSlot] = useState<PrimaryMealSlot>("lunch");

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const [published, preference] = await Promise.all([
      loadPublishedNutritionFor(effectiveUserId, selectedCourseId),
      loadClientMealSchedulePreference({ userId: effectiveUserId, courseId: selectedCourseId }),
    ]);
    setSnapshot(published?.snapshot ?? null);
    if (preference) {
      setPreferredMode(preference.mode);
      setPreferredSlot(preference.primarySlot);
    } else if (published?.snapshot?.kind === "constructor") {
      setPreferredMode(published.snapshot.meal_schedule_mode as MealScheduleMode);
      setPreferredSlot(published.snapshot.primary_meal_slot as PrimaryMealSlot);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, selectedCourseId]);

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем меню…</div>;

  if (!snapshot) {
    return (
      <div className="space-y-6">
        {effectiveUserId ? (
          <MealSchedulePicker
            userId={effectiveUserId}
            courseId={selectedCourseId}
            value={preferredMode}
            primarySlot={preferredSlot}
            onSaved={(mode, slot) => {
              setPreferredMode(mode);
              setPreferredSlot(slot);
            }}
          />
        ) : null}
        <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center text-warm-gray">
          Меню пока не назначено. Тренер соберёт индивидуальный рацион и опубликует его для вас.
        </div>
      </div>
    );
  }

  if (snapshot.kind === "constructor") {
    const constructorDays: ConstructorDay[] = constructorDaysFromSnapshot(snapshot);
    const targets = snapshot.targets;
    const comparison = comparisonRows(
      {
        kcal: d(targets.kcal),
        protein_g: d(targets.protein_g),
        fat_g: d(targets.fat_g),
        carbs_g: d(targets.carbs_g),
        fiber_g: d(0),
      },
      {
        kcal: d(constructorDays[0]?.kcal ?? targets.kcal),
        protein_g: d(constructorDays[0]?.protein_g ?? targets.protein_g),
        fat_g: d(constructorDays[0]?.fat_g ?? targets.fat_g),
        carbs_g: d(constructorDays[0]?.carbs_g ?? targets.carbs_g),
        fiber_g: d(0),
      },
    );

    return (
      <div className="space-y-6">
        {effectiveUserId ? (
          <MealSchedulePicker
            userId={effectiveUserId}
            courseId={selectedCourseId}
            value={preferredMode}
            primarySlot={preferredSlot}
            publishedMode={snapshot.meal_schedule_mode as MealScheduleMode}
            onSaved={(mode, slot) => {
              setPreferredMode(mode);
              setPreferredSlot(slot);
            }}
          />
        ) : null}
        {snapshot.notes && (
          <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/10 to-transparent p-4 text-sm text-ivory">
            <p className="text-[11px] uppercase tracking-widest text-gold">Комментарий тренера</p>
            <p className="mt-1">{snapshot.notes}</p>
          </div>
        )}
        <ConstructorNutritionView
          days={constructorDays}
          comparison={comparison}
          targets={targets}
          planStatus="assigned"
          mealScheduleMode={snapshot.meal_schedule_mode as MealScheduleMode}
          primaryMealSlot={snapshot.primary_meal_slot as PrimaryMealSlot}
          editable={false}
        />
      </div>
    );
  }

  const dishes: Dish[] = [];
  const seen = new Set<string>();
  for (const day of snapshot.legacy_days) {
    for (const m of day.meals) {
      if (seen.has(m.dish.id)) continue;
      seen.add(m.dish.id);
      dishes.push({
        id: m.dish.id,
        slug: m.dish.slug,
        name: m.dish.name,
        meal_type: m.dish.meal_type as Dish["meal_type"],
        tags: [],
        calories_per_100g: m.dish.calories_per_100g,
        protein_per_100g: m.dish.protein_per_100g,
        fat_per_100g: m.dish.fat_per_100g,
        carbs_per_100g: m.dish.carbs_per_100g,
        portion_weight_g: m.portion_g,
        ingredients: (m.dish.ingredients as Dish["ingredients"]) ?? [],
        steps: m.dish.steps,
        replacements: m.dish.replacements,
        description: m.dish.description,
      });
    }
  }
  const dayEntries: DayEntry[] = snapshot.legacy_days.map((day) => ({
    day_index: day.day_index,
    day_note: day.day_note,
    meals: day.meals.map((m) => ({
      slot: m.slot as DayEntry["meals"][number]["slot"],
      dish_id: m.dish.id,
      portion_g: m.portion_g,
      note: m.note,
    })),
  }));

  return (
    <div className="space-y-6">
      <FoodSwapGuide />
      <p className="text-sm text-warm-gray">
        Целевые <b className="text-ivory">{snapshot.targets.kcal}</b> ккал. Меню зафиксировано
        тренером — блюда и граммовки меняет только тренер новой версией.
      </p>
      {snapshot.notes && (
        <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/10 to-transparent p-4 text-sm text-ivory">
          <p className="text-[11px] uppercase tracking-widest text-gold">Комментарий тренера</p>
          <p className="mt-1">{snapshot.notes}</p>
        </div>
      )}
      <NutritionView
        dishes={dishes}
        swapDishes={dishes}
        days={dayEntries}
        targets={snapshot.targets}
        mealsPerDay={(snapshot.meals_per_day === 3 ? 3 : 5) as 3 | 5}
        preferredProducts={[]}
        excludedProducts={[]}
        editable={false}
      />
    </div>
  );
}
