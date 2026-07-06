// Nutrition module — pure logic: BMR/TDEE/macro targets and menu generation.

export type Dish = {
  id: string;
  slug: string;
  name: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  tags: string[];
  calories_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  portion_weight_g: number;
  ingredients: Array<{ raw: string; raw_g: number; cooked_g: number }>;
  steps: string[];
  replacements: string[];
  description: string | null;
};

export type Slot = "breakfast" | "snack1" | "lunch" | "snack2" | "dinner";

export type MealEntry = {
  slot: Slot;
  dish_id: string;
  portion_g: number;
  note?: string | null;
};

export type DayEntry = {
  day_index: number;
  day_note: string | null;
  meals: MealEntry[];
};

export type NutritionTargets = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type ProfileInput = {
  gender?: "female" | "male" | null;
  birth_date?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_level?: string | null;
  goal_primary?: string | null;
};

// Mifflin-St Jeor formula. Default: female if unknown.
export function calcTargets(p: ProfileInput): NutritionTargets {
  const weight = p.weight_kg && p.weight_kg > 30 ? p.weight_kg : 65;
  const height = p.height_cm && p.height_cm > 120 ? p.height_cm : 165;
  const age = p.birth_date
    ? Math.max(16, Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000))
    : 30;
  const gender = p.gender ?? "female";
  const bmr =
    gender === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const activityMap: Record<string, number> = {
    sedentary: 1.2,
    low: 1.375,
    light: 1.375,
    moderate: 1.55,
    medium: 1.55,
    high: 1.725,
    very_high: 1.9,
  };
  const factor = activityMap[p.activity_level ?? ""] ?? 1.375;
  const tdee = bmr * factor;

  const goal = (p.goal_primary ?? "").toLowerCase();
  let kcal = tdee;
  if (/(похуд|снижен|жир|weight_loss|lose)/.test(goal)) kcal = tdee * 0.85;
  else if (/(набор|мышц|gain|muscle)/.test(goal)) kcal = tdee * 1.1;

  const protein_g = Math.round(weight * 1.8);
  const fat_g = Math.round(weight * 1.0);
  const carbs_g = Math.max(
    80,
    Math.round((kcal - protein_g * 4 - fat_g * 9) / 4),
  );

  return {
    kcal: Math.round(kcal / 10) * 10,
    protein_g,
    fat_g,
    carbs_g,
  };
}

// Slot distribution of daily kcal
export function slotDistribution(mealsPerDay: 3 | 5): Record<Slot, number> {
  if (mealsPerDay === 3) {
    return { breakfast: 0.28, snack1: 0, lunch: 0.4, snack2: 0, dinner: 0.32 };
  }
  return {
    breakfast: 0.25,
    snack1: 0.1,
    lunch: 0.3,
    snack2: 0.1,
    dinner: 0.25,
  };
}

export function slotsFor(mealsPerDay: 3 | 5): Slot[] {
  return mealsPerDay === 3
    ? ["breakfast", "lunch", "dinner"]
    : ["breakfast", "snack1", "lunch", "snack2", "dinner"];
}

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Завтрак",
  snack1: "Перекус",
  lunch: "Обед",
  snack2: "Перекус",
  dinner: "Ужин",
};

function slotMealType(slot: Slot): Dish["meal_type"] {
  if (slot === "breakfast") return "breakfast";
  if (slot === "lunch") return "lunch";
  if (slot === "dinner") return "dinner";
  return "snack";
}

// Compute nutrition of a portion.
export function computeMealNutrition(dish: Dish, portion_g: number) {
  const k = portion_g / 100;
  return {
    kcal: dish.calories_per_100g * k,
    protein_g: dish.protein_per_100g * k,
    fat_g: dish.fat_per_100g * k,
    carbs_g: dish.carbs_per_100g * k,
  };
}

export function dayTotals(entries: MealEntry[], dishesById: Record<string, Dish>) {
  return entries.reduce(
    (a, m) => {
      const d = dishesById[m.dish_id];
      if (!d) return a;
      const n = computeMealNutrition(d, m.portion_g);
      a.kcal += n.kcal;
      a.protein_g += n.protein_g;
      a.fat_g += n.fat_g;
      a.carbs_g += n.carbs_g;
      return a;
    },
    { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );
}

// --- Generation ---

export type GenerateOptions = {
  mealsPerDay: 3 | 5;
  preferredProducts: string[];
  excludedProducts: string[];
  targets: NutritionTargets;
};

function pickWithScore(
  candidates: Dish[],
  preferred: Set<string>,
  excluded: Set<string>,
  recentUseByDish: Map<string, number>,
  dayIndex: number,
): Dish | null {
  const pool = candidates.filter((d) => {
    // exclude if any tag is in excluded
    if (d.tags.some((t) => excluded.has(t.toLowerCase()))) return false;
    return true;
  });
  if (pool.length === 0) return null;

  const scored = pool.map((d) => {
    const preferredHits = d.tags.reduce(
      (s, t) => (preferred.has(t.toLowerCase()) ? s + 1 : s),
      0,
    );
    const lastUsed = recentUseByDish.get(d.id);
    const recencyPenalty =
      lastUsed !== undefined && dayIndex - lastUsed < 3 ? 5 : 0;
    return {
      dish: d,
      score: preferredHits * 2 - recencyPenalty + Math.random(),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].dish;
}

export function generatePlan(dishes: Dish[], opts: GenerateOptions): DayEntry[] {
  const preferred = new Set(opts.preferredProducts.map((s) => s.toLowerCase()));
  const excluded = new Set(opts.excludedProducts.map((s) => s.toLowerCase()));
  const slots = slotsFor(opts.mealsPerDay);
  const distribution = slotDistribution(opts.mealsPerDay);
  const recentUse = new Map<string, number>();

  const dishesBySlot: Record<Dish["meal_type"], Dish[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const d of dishes) dishesBySlot[d.meal_type].push(d);

  const days: DayEntry[] = [];
  for (let i = 0; i < 7; i++) {
    const meals: MealEntry[] = [];
    for (const slot of slots) {
      const mt = slotMealType(slot);
      const dish = pickWithScore(dishesBySlot[mt], preferred, excluded, recentUse, i);
      if (!dish) continue;
      recentUse.set(dish.id, i);
      // Initial portion aimed at slot's share of daily kcal.
      const targetKcal = opts.targets.kcal * distribution[slot];
      const per100 = Math.max(dish.calories_per_100g, 1);
      const portion_g = Math.max(40, Math.round((targetKcal / per100) * 100));
      meals.push({ slot, dish_id: dish.id, portion_g });
    }

    // Rescale the whole day so total kcal hits the target exactly (±1 kcal).
    // Portions are stored to 1 g precision — no coarse rounding — so displayed
    // totals stay in lock-step with target kcal for any manual setting.
    const dishesById: Record<string, Dish> = {};
    for (const m of meals) {
      const d = dishes.find((x) => x.id === m.dish_id);
      if (d) dishesById[m.dish_id] = d;
    }
    const totalKcal = meals.reduce((s, m) => {
      const d = dishesById[m.dish_id];
      return d ? s + (d.calories_per_100g * m.portion_g) / 100 : s;
    }, 0);
    if (totalKcal > 0) {
      const scale = opts.targets.kcal / totalKcal;
      for (const m of meals) m.portion_g = Math.max(30, Math.round(m.portion_g * scale));
    }
    // Final micro-adjust: nudge the largest meal by 1 g steps until kcal matches.
    const kcalOf = (m: MealEntry) => {
      const d = dishesById[m.dish_id];
      return d ? (d.calories_per_100g * m.portion_g) / 100 : 0;
    };
    let sum = meals.reduce((s, m) => s + kcalOf(m), 0);
    if (meals.length > 0) {
      const largest = meals.reduce((a, b) => (kcalOf(a) >= kcalOf(b) ? a : b));
      const d = dishesById[largest.dish_id];
      if (d && d.calories_per_100g > 0) {
        const diffKcal = opts.targets.kcal - sum;
        const deltaG = Math.round((diffKcal / d.calories_per_100g) * 100);
        largest.portion_g = Math.max(30, largest.portion_g + deltaG);
        sum = meals.reduce((s, m) => s + kcalOf(m), 0);
      }
    }

    days.push({ day_index: i, day_note: null, meals });
  }
  return days;
}


export const PREFERRED_PRODUCT_OPTIONS = [
  { key: "птица", label: "Курица / индейка" },
  { key: "рыба", label: "Рыба" },
  { key: "говядина", label: "Говядина" },
  { key: "яйца", label: "Яйца" },
  { key: "молочка", label: "Молочные продукты" },
  { key: "гречка", label: "Гречка" },
  { key: "рис", label: "Рис" },
  { key: "цельнозерновое", label: "Паста / цельнозерновое" },
  { key: "киноа", label: "Киноа" },
  { key: "овощи", label: "Овощи" },
  { key: "фрукты", label: "Фрукты" },
  { key: "ягоды", label: "Ягоды" },
  { key: "орехи", label: "Орехи" },
  { key: "бобовые", label: "Бобовые" },
  { key: "морепродукты", label: "Морепродукты" },
];

export const WEEKDAY_LABELS = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];
