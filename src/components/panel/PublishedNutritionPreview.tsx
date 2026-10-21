import { ConstructorNutritionView } from "@/components/panel/ConstructorNutritionView";
import { NutritionView } from "@/components/panel/NutritionView";
import type { DayEntry, Dish } from "@/lib/nutrition";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { resolveDisplayMealScheduleMode } from "@/lib/nutrition-constructor/plan-kbju-status";
import type { PrimaryMealSlot } from "@/lib/nutrition-constructor/config";
import { constructorDaysFromSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import type { NutritionSnapshot } from "@/lib/published-programs/types";

export function PublishedNutritionPreview({ snapshot }: { snapshot: NutritionSnapshot }) {
  if (snapshot.kind === "constructor") {
    const days = constructorDaysFromSnapshot(snapshot);
    const displayMode = resolveDisplayMealScheduleMode(days, snapshot.meal_schedule_mode);
    const targets = snapshot.targets;
    const first = days[0];
    const comparison = comparisonRows(
      {
        kcal: d(targets.kcal),
        protein_g: d(targets.protein_g),
        fat_g: d(targets.fat_g),
        carbs_g: d(targets.carbs_g),
        fiber_g: d(0),
      },
      {
        kcal: d(first?.kcal ?? targets.kcal),
        protein_g: d(first?.protein_g ?? targets.protein_g),
        fat_g: d(first?.fat_g ?? targets.fat_g),
        carbs_g: d(first?.carbs_g ?? targets.carbs_g),
        fiber_g: d(0),
      },
    );
    return (
      <ConstructorNutritionView
        days={days}
        comparison={comparison}
        targets={targets}
        planStatus="assigned"
        mealScheduleMode={displayMode}
        primaryMealSlot={snapshot.primary_meal_slot as PrimaryMealSlot}
        editable={false}
        swapCatalog={[]}
      />
    );
  }

  const dishes: Dish[] = [];
  const seen = new Set<string>();
  for (const day of snapshot.legacy_days) {
    for (const meal of day.meals) {
      if (seen.has(meal.dish.id)) continue;
      seen.add(meal.dish.id);
      dishes.push({
        id: meal.dish.id,
        slug: meal.dish.slug,
        name: meal.dish.name,
        meal_type: meal.dish.meal_type as Dish["meal_type"],
        tags: [],
        calories_per_100g: meal.dish.calories_per_100g,
        protein_per_100g: meal.dish.protein_per_100g,
        fat_per_100g: meal.dish.fat_per_100g,
        carbs_per_100g: meal.dish.carbs_per_100g,
        portion_weight_g: meal.portion_g,
        ingredients: (meal.dish.ingredients as Dish["ingredients"]) ?? [],
        steps: meal.dish.steps,
        replacements: meal.dish.replacements,
        description: meal.dish.description,
      });
    }
  }
  const days: DayEntry[] = snapshot.legacy_days.map((day) => ({
    day_index: day.day_index,
    day_note: day.day_note,
    meals: day.meals.map((meal) => ({
      slot: meal.slot as DayEntry["meals"][number]["slot"],
      dish_id: meal.dish.id,
      portion_g: meal.portion_g,
      note: meal.note,
    })),
  }));
  return (
    <NutritionView
      dishes={dishes}
      swapDishes={dishes}
      days={days}
      targets={snapshot.targets}
      mealsPerDay={(snapshot.meals_per_day === 3 ? 3 : 5) as 3 | 5}
      preferredProducts={[]}
      excludedProducts={[]}
      editable={false}
    />
  );
}
