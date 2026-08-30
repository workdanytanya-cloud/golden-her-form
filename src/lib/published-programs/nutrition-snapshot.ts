import type { ConstructorDay, MealPlanItem } from "@/lib/nutrition-constructor/types";
import type { Dish, MealEntry } from "@/lib/nutrition";
import type {
  FrozenLegacyMeal,
  FrozenMealItem,
  FrozenNutritionDay,
  MacroTargetsSnapshot,
  NutritionSnapshot,
} from "@/lib/published-programs/types";
import { contentHash } from "@/lib/published-programs/hash";

function freezeMealItem(item: MealPlanItem): FrozenMealItem {
  return {
    slot: item.slot,
    recipe_id: item.recipe_id,
    recipe_name: item.recipe_name,
    requires_cooking: item.requires_cooking,
    prep_time_min: item.prep_time_min,
    steps: [...item.steps],
    weighing_note: item.weighing_note,
    snack_action: item.snack_action ?? null,
    replacements: [],
    ingredients: item.ingredients.map((ing) => ({
      product_id: ing.product_id,
      product_name: ing.product_name,
      grams: String(ing.grams),
      weighing_note: ing.weighing_note,
      measurement_state: ing.weighing_note,
      kcal_per_100g: String(ing.kcal_per_100g),
      protein_per_100g: String(ing.protein_per_100g),
      fat_per_100g: String(ing.fat_per_100g),
      carbs_per_100g: String(ing.carbs_per_100g),
      fiber_per_100g: ing.fiber_per_100g != null ? String(ing.fiber_per_100g) : null,
      kcal: String(ing.kcal),
      protein_g: String(ing.protein_g),
      fat_g: String(ing.fat_g),
      carbs_g: String(ing.carbs_g),
      fiber_g: String(ing.fiber_g),
      sort_order: ing.sort_order,
    })),
    kcal: String(item.kcal),
    protein_g: String(item.protein_g),
    fat_g: String(item.fat_g),
    carbs_g: String(item.carbs_g),
    fiber_g: String(item.fiber_g),
  };
}

export function freezeConstructorDays(days: ConstructorDay[]): FrozenNutritionDay[] {
  return days.map((day) => ({
    day_index: day.day_index,
    day_note: day.day_note,
    items: day.items.map(freezeMealItem),
    kcal: String(day.kcal),
    protein_g: String(day.protein_g),
    fat_g: String(day.fat_g),
    carbs_g: String(day.carbs_g),
    fiber_g: String(day.fiber_g),
  }));
}

export function freezeLegacyMeals(
  meals: MealEntry[],
  dishesById: Map<string, Dish>,
): FrozenLegacyMeal[] {
  return meals.map((m) => {
    const dish = dishesById.get(m.dish_id);
    return {
      slot: m.slot,
      portion_g: m.portion_g,
      note: m.note ?? null,
      dish: {
        id: dish?.id ?? m.dish_id,
        slug: dish?.slug ?? "",
        name: dish?.name ?? "Блюдо",
        meal_type: dish?.meal_type ?? "lunch",
        calories_per_100g: dish?.calories_per_100g ?? 0,
        protein_per_100g: dish?.protein_per_100g ?? 0,
        fat_per_100g: dish?.fat_per_100g ?? 0,
        carbs_per_100g: dish?.carbs_per_100g ?? 0,
        ingredients: dish?.ingredients ?? [],
        steps: dish?.steps ?? [],
        replacements: dish?.replacements ?? [],
        description: dish?.description ?? null,
      },
    };
  });
}

export function buildConstructorNutritionSnapshot(params: {
  days: ConstructorDay[];
  targets: MacroTargetsSnapshot;
  meal_schedule_mode: string;
  primary_meal_slot: string;
  bmr?: number | null;
  tdee?: number | null;
  calorie_adjustment_pct?: number | null;
  notes?: string | null;
  reason?: string | null;
}): NutritionSnapshot {
  return {
    kind: "constructor",
    meal_schedule_mode: params.meal_schedule_mode,
    primary_meal_slot: params.primary_meal_slot,
    meals_per_day: 4,
    targets: params.targets,
    bmr: params.bmr ?? null,
    tdee: params.tdee ?? null,
    calorie_adjustment_pct: params.calorie_adjustment_pct ?? null,
    constructor_days: freezeConstructorDays(params.days),
    legacy_days: [],
    notes: params.notes ?? null,
    reason: params.reason ?? null,
  };
}

export function buildLegacyNutritionSnapshot(params: {
  days: Array<{ day_index: number; day_note: string | null; meals: MealEntry[] }>;
  dishes: Dish[];
  targets: MacroTargetsSnapshot;
  meals_per_day: number;
  notes?: string | null;
  reason?: string | null;
}): NutritionSnapshot {
  const dishesById = new Map(params.dishes.map((d) => [d.id, d]));
  return {
    kind: "legacy",
    meal_schedule_mode: "legacy",
    primary_meal_slot: "lunch",
    meals_per_day: params.meals_per_day,
    targets: params.targets,
    bmr: null,
    tdee: null,
    calorie_adjustment_pct: null,
    constructor_days: [],
    legacy_days: params.days.map((d) => ({
      day_index: d.day_index,
      day_note: d.day_note,
      meals: freezeLegacyMeals(d.meals, dishesById),
    })),
    notes: params.notes ?? null,
    reason: params.reason ?? null,
  };
}

export function nutritionSnapshotHash(snapshot: NutritionSnapshot): string {
  return contentHash(snapshot);
}

export function constructorDaysFromSnapshot(snapshot: NutritionSnapshot): ConstructorDay[] {
  return snapshot.constructor_days.map((day) => ({
    day_index: day.day_index,
    day_note: day.day_note,
    items: day.items.map((item) => ({
      slot: item.slot as ConstructorDay["items"][number]["slot"],
      recipe_id: item.recipe_id,
      recipe_name: item.recipe_name,
      requires_cooking: item.requires_cooking,
      prep_time_min: item.prep_time_min,
      steps: item.steps,
      weighing_note: item.weighing_note,
      snack_action: item.snack_action,
      ingredients: item.ingredients.map((ing) => ({
        product_id: ing.product_id,
        product_name: ing.product_name,
        grams: ing.grams,
        weighing_note: ing.weighing_note,
        kcal_per_100g: ing.kcal_per_100g,
        protein_per_100g: ing.protein_per_100g,
        fat_per_100g: ing.fat_per_100g,
        carbs_per_100g: ing.carbs_per_100g,
        fiber_per_100g: ing.fiber_per_100g,
        kcal: ing.kcal,
        protein_g: ing.protein_g,
        fat_g: ing.fat_g,
        carbs_g: ing.carbs_g,
        fiber_g: ing.fiber_g,
        sort_order: ing.sort_order,
      })),
      kcal: item.kcal,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carbs_g: item.carbs_g,
      fiber_g: item.fiber_g,
      is_valid: true,
    })),
    kcal: day.kcal,
    protein_g: day.protein_g,
    fat_g: day.fat_g,
    carbs_g: day.carbs_g,
    fiber_g: day.fiber_g,
    is_valid: true,
  }));
}

/** Масштаб граммовок пропорционально новым ккал, в пределах 20–600 г. */
export function scaleConstructorDaysToKcal(
  days: ConstructorDay[],
  fromKcal: number,
  toKcal: number,
): ConstructorDay[] {
  if (fromKcal <= 0 || toKcal <= 0) return days;
  const ratio = toKcal / fromKcal;
  return days.map((day) => {
    const items = day.items.map((item) => {
      const ingredients = item.ingredients.map((ing) => {
        const next = Math.min(600, Math.max(20, Math.round(Number(ing.grams) * ratio)));
        const factor = next / 100;
        const kcal100 = Number(ing.kcal_per_100g);
        const p100 = Number(ing.protein_per_100g);
        const f100 = Number(ing.fat_per_100g);
        const c100 = Number(ing.carbs_per_100g);
        const fi100 = Number(ing.fiber_per_100g ?? 0);
        return {
          ...ing,
          grams: String(next),
          kcal: String(Math.round(kcal100 * factor * 10000) / 10000),
          protein_g: String(Math.round(p100 * factor * 10000) / 10000),
          fat_g: String(Math.round(f100 * factor * 10000) / 10000),
          carbs_g: String(Math.round(c100 * factor * 10000) / 10000),
          fiber_g: String(Math.round(fi100 * factor * 10000) / 10000),
        };
      });
      const kcal = ingredients.reduce((s, i) => s + Number(i.kcal), 0);
      const protein_g = ingredients.reduce((s, i) => s + Number(i.protein_g), 0);
      const fat_g = ingredients.reduce((s, i) => s + Number(i.fat_g), 0);
      const carbs_g = ingredients.reduce((s, i) => s + Number(i.carbs_g), 0);
      const fiber_g = ingredients.reduce((s, i) => s + Number(i.fiber_g), 0);
      return {
        ...item,
        ingredients,
        kcal: String(kcal),
        protein_g: String(protein_g),
        fat_g: String(fat_g),
        carbs_g: String(carbs_g),
        fiber_g: String(fiber_g),
      };
    });
    const kcal = items.reduce((s, i) => s + Number(i.kcal), 0);
    return {
      ...day,
      items,
      kcal: String(kcal),
      protein_g: String(items.reduce((s, i) => s + Number(i.protein_g), 0)),
      fat_g: String(items.reduce((s, i) => s + Number(i.fat_g), 0)),
      carbs_g: String(items.reduce((s, i) => s + Number(i.carbs_g), 0)),
      fiber_g: String(items.reduce((s, i) => s + Number(i.fiber_g), 0)),
    };
  });
}

export function diffNutritionSnapshots(
  previous: NutritionSnapshot,
  next: NutritionSnapshot,
): {
  old_kcal: number;
  new_kcal: number;
  changed_grams: number;
  replaced_meals: string[];
} {
  let changedGrams = 0;
  const replaced: string[] = [];
  const prevItems = previous.constructor_days.flatMap((d) => d.items);
  const nextItems = next.constructor_days.flatMap((d) => d.items);
  const n = Math.max(prevItems.length, nextItems.length);
  for (let i = 0; i < n; i++) {
    const a = prevItems[i];
    const b = nextItems[i];
    if (!a || !b) continue;
    if (a.recipe_id !== b.recipe_id) replaced.push(`${a.recipe_name} → ${b.recipe_name}`);
    const aGrams = a.ingredients.reduce((s, x) => s + Number(x.grams), 0);
    const bGrams = b.ingredients.reduce((s, x) => s + Number(x.grams), 0);
    if (Math.abs(aGrams - bGrams) >= 1) changedGrams += 1;
  }
  return {
    old_kcal: previous.targets.kcal,
    new_kcal: next.targets.kcal,
    changed_grams: changedGrams,
    replaced_meals: replaced,
  };
}
