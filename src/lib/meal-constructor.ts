import { dishMatchesProduct, normalizeFoodTerms } from "@/lib/food-products";
import {
  type Dish,
  type MealEntry,
  type Slot,
  computeMealNutrition,
  slotLabel,
} from "@/lib/nutrition";
import type { MealPattern } from "@/lib/plan-options";
import { scalePortionForSwap } from "@/lib/nutrition-repo";

export type MealOptionKey = "A" | "B" | "C";

export type MealConstructorOption = {
  key: MealOptionKey;
  dish: Dish;
  portion_g: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  isActive: boolean;
};

export type MealConstructorSlot = {
  slot: Slot;
  label: string;
  options: MealConstructorOption[];
};

function slotToMealType(slot: Slot): Dish["meal_type"] {
  if (slot === "breakfast") return "breakfast";
  if (slot === "lunch") return "lunch";
  if (slot === "dinner") return "dinner";
  return "snack";
}

function scoreAlternative(
  candidate: Dish,
  current: Dish,
  preferred: string[],
  excluded: string[],
): number {
  if (candidate.id === current.id) return -Infinity;
  if (excluded.some((term) => dishMatchesProduct(candidate, term))) return -Infinity;

  let score = 0;
  if (current.replacements.includes(candidate.slug)) score += 12;
  for (const term of preferred) {
    if (dishMatchesProduct(candidate, term)) score += 4;
  }
  return score;
}

function pickAlternatives(
  current: Dish,
  pool: Dish[],
  preferred: string[],
  excluded: string[],
  count: number,
): Dish[] {
  const ranked = pool
    .filter((d) => d.id !== current.id)
    .map((d) => ({ dish: d, score: scoreAlternative(d, current, preferred, excluded) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name, "ru"));

  const picked: Dish[] = [];
  const seen = new Set<string>();
  for (const { dish } of ranked) {
    if (seen.has(dish.id)) continue;
    seen.add(dish.id);
    picked.push(dish);
    if (picked.length >= count) break;
  }
  return picked;
}

function buildOption(
  key: MealOptionKey,
  dish: Dish,
  portion_g: number,
  activeDishId: string,
): MealConstructorOption {
  const n = computeMealNutrition(dish, portion_g);
  return {
    key,
    dish,
    portion_g,
    kcal: n.kcal,
    protein_g: n.protein_g,
    fat_g: n.fat_g,
    carbs_g: n.carbs_g,
    isActive: dish.id === activeDishId,
  };
}

export function buildMealConstructorForDay(params: {
  slots: Slot[];
  meals: MealEntry[];
  dishesById: Record<string, Dish>;
  swapPool: Dish[];
  preferredProducts?: string[];
  excludedProducts?: string[];
  mealPattern?: MealPattern;
}): MealConstructorSlot[] {
  const preferred = normalizeFoodTerms(params.preferredProducts ?? []);
  const excluded = normalizeFoodTerms(params.excludedProducts ?? []);
  const pattern = params.mealPattern ?? "standard";
  const bySlug: Record<string, Dish> = {};
  for (const d of params.swapPool) bySlug[d.slug] = d;

  return params.slots.flatMap((slot) => {
    const meal = params.meals.find((m) => m.slot === slot);
    const current = meal ? params.dishesById[meal.dish_id] : null;
    if (!meal || !current) return [];

    const mealType = slotToMealType(slot);
    const sameType = params.swapPool.filter((d) => d.meal_type === mealType);
    const explicit = current.replacements.map((s) => bySlug[s]).filter(Boolean) as Dish[];
    const poolById = new Map<string, Dish>();
    for (const d of [...explicit, ...sameType]) poolById.set(d.id, d);
    const pool = [...poolById.values()];

    const alternatives = pickAlternatives(current, pool, preferred, excluded, 2);
    const keys: MealOptionKey[] = ["A", "B", "C"];
    const dishesForKeys: (Dish | null)[] = [current, alternatives[0] ?? null, alternatives[1] ?? null];

    const options = keys.flatMap((key, i) => {
      const dish = dishesForKeys[i];
      if (!dish) return [];
      const portion_g =
        key === "A" ? meal.portion_g : scalePortionForSwap(current, meal.portion_g, dish);
      return [buildOption(key, dish, portion_g, current.id)];
    });

    if (options.length < 2) return [];

    return [{ slot, label: slotLabel(slot, pattern), options }];
  });
}
