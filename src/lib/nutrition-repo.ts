import { supabase } from "@/integrations/supabase/client";
import {
  type Dish,
  type DayEntry,
  type MealEntry,
  type Slot,
  type NutritionTargets,
  calcTargets,
  generatePlan,
  filterDishesForMedicalTable,
} from "@/lib/nutrition";
import { MEDICAL_DIET_NONE } from "@/lib/medical-diet-tables";
import {
  parseFoodList,
  normalizeFoodTerms,
  mergeUnique,
} from "@/lib/food-products";
import {
  decodePlanMeta,
  encodePlanMeta,
  stripPlanMeta,
  type MealPattern,
  type RecipeComplexity,
} from "@/lib/plan-options";
import { roundTargetsForDb } from "@/lib/nutrition-constructor/decimal-math";

export type PlanRow = {
  id: string;
  user_id: string;
  meals_per_day: number;
  preferred_products: string[];
  excluded_products: string[];
  target_kcal: number;
  target_protein_g: number;
  target_fat_g: number;
  target_carbs_g: number;
  targets_manual: boolean;
  notes: string | null;
};

export type DayRow = {
  id: string;
  plan_id: string;
  day_index: number;
  day_note: string | null;
  meals: MealEntry[];
};

export async function loadDishes(): Promise<Dish[]> {
  const { data, error } = await supabase
    .from("dishes")
    .select(
      "id, slug, name, meal_type, tags, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, portion_weight_g, ingredients, steps, replacements, description",
    );
  if (error) throw error;
  return (data ?? []).map((d) => ({
    ...d,
    ingredients: (d.ingredients ?? []) as Dish["ingredients"],
    steps: (d.steps ?? []) as string[],
  })) as Dish[];
}

/** Стол Певзнера из поля extra анкеты (medical_diet_table). */
export async function loadMedicalDietTable(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("onboarding_responses")
    .select("extra")
    .eq("user_id", userId)
    .maybeSingle();
  const extra =
    data?.extra && typeof data.extra === "object" && !Array.isArray(data.extra)
      ? (data.extra as Record<string, unknown>)
      : null;
  const raw = typeof extra?.medical_diet_table === "string" ? extra.medical_diet_table : null;
  if (!raw || raw === MEDICAL_DIET_NONE) return null;
  return raw;
}

/**
 * Пул блюд для клиента: general ИЛИ только выбранный стол.
 * Блюда из плана, которых нет в пуле, добавляются только для отображения
 * (чтобы старое меню не «ломалось»), но не для новых замен — см. swapPool.
 */
export async function loadDishesForClient(
  userId: string,
  planMealDishIds: string[] = [],
): Promise<{ pool: Dish[]; all: Dish[]; medicalTable: string | null }> {
  const [all, medicalTable] = await Promise.all([loadDishes(), loadMedicalDietTable(userId)]);
  const pool = filterDishesForMedicalTable(all, medicalTable);
  const poolIds = new Set(pool.map((d) => d.id));
  const orphans = all.filter((d) => planMealDishIds.includes(d.id) && !poolIds.has(d.id));
  return { pool, all: [...pool, ...orphans], medicalTable };
}

export async function loadPlanFor(
  userId: string,
  courseId?: string | null,
): Promise<{ plan: PlanRow | null; days: DayRow[] }> {
  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));

  let planQuery = supabase.from("nutrition_plans").select("*").eq("user_id", userId);
  if (resolvedCourseId) planQuery = planQuery.eq("course_id", resolvedCourseId);
  const { data: plan } = await planQuery.maybeSingle();
  if (!plan) return { plan: null, days: [] };
  const { data: days } = await supabase
    .from("nutrition_plan_days")
    .select("*")
    .eq("plan_id", plan.id)
    .order("day_index");
  return {
    plan: plan as PlanRow,
    days: (days ?? []).map((d) => ({
      id: d.id,
      plan_id: d.plan_id,
      day_index: d.day_index,
      day_note: d.day_note,
      meals: (d.meals as unknown as MealEntry[]) ?? [],
    })),
  };
}

export async function loadTargetProfile(userId: string) {
  const [profileRes, measRes, onbRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("gender, birth_date, height_cm")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("measurements")
      .select("weight_kg")
      .eq("user_id", userId)
      .order("measured_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("onboarding_responses")
      .select("activity_level, goal_primary, allergies, disliked_foods")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    gender: (profileRes.data?.gender ?? null) as "female" | "male" | null,
    birth_date: profileRes.data?.birth_date ?? null,
    height_cm: profileRes.data?.height_cm ?? null,
    weight_kg: measRes.data?.weight_kg ?? null,
    activity_level: onbRes.data?.activity_level ?? null,
    goal_primary: onbRes.data?.goal_primary ?? null,
    allergies: onbRes.data?.allergies ?? "",
    disliked_foods: onbRes.data?.disliked_foods ?? "",
  };
}

export function extractExcludedFromText(...texts: (string | null | undefined)[]): string[] {
  const source = texts.filter(Boolean).join(", ");
  const map: Array<{ triggers: string[]; tag: string }> = [
    { triggers: ["лактоз", "молоч", "творог", "кефир", "йогурт", "сметан"], tag: "молочка" },
    { triggers: ["орех", "миндал", "арахис", "кэшью", "кешью", "фундук"], tag: "орехи" },
    { triggers: ["рыб", "лосос", "треск", "сёмг", "семг"], tag: "рыба" },
    { triggers: ["морепрод", "креветк", "кальмар", "мидии"], tag: "морепродукты" },
    { triggers: ["говядин", "телятин"], tag: "говядина" },
    { triggers: ["свин"], tag: "свинина" },
    { triggers: ["куриц", "курино", "птиц", "индейк"], tag: "птица" },
    { triggers: ["яйц", "яичн"], tag: "яйца" },
    { triggers: ["глютен", "клейков", "пшениц", "макарон"], tag: "цельнозерновое" },
    { triggers: ["бобов", "чечевиц", "нут", "фасол", "горох"], tag: "бобовые" },
    { triggers: ["гриб"], tag: "грибы" },
  ];
  const low = source.toLowerCase();
  const fromTriggers: string[] = [];
  for (const m of map) if (m.triggers.some((t) => low.includes(t))) fromTriggers.push(m.tag);

  // Свободный список из анкеты (через запятую) → нормализованные продукты
  const fromFree = normalizeFoodTerms(parseFoodList(source));
  return mergeUnique(fromTriggers, fromFree);
}

// Create or replace plan and days.
export async function createOrReplacePlan(params: {
  userId: string;
  mealsPerDay: 3 | 5;
  preferred: string[];
  excluded: string[];
  targets: NutritionTargets;
  targetsManual?: boolean;
  dishes: Dish[];
  recipeComplexity?: RecipeComplexity;
  mealPattern?: MealPattern;
  /** Пересборка только из уже подобранных блюд плана (клиентский «пересобрать»). */
  restrictToDishIds?: string[];
}): Promise<{ plan: PlanRow; days: DayRow[] }> {
  const {
    userId,
    mealsPerDay,
    preferred,
    excluded,
    targets,
    targetsManual,
    dishes,
    recipeComplexity,
    mealPattern,
    restrictToDishIds,
  } = params;

  const meta = decodePlanMeta(preferred);
  const complexity = recipeComplexity ?? meta.complexity;
  const pattern = mealPattern ?? meta.pattern;
  const foods = stripPlanMeta(preferred);
  const preferredStored = encodePlanMeta(foods, { complexity, pattern });

  const medicalTable = await loadMedicalDietTable(userId);
  let pool = filterDishesForMedicalTable(dishes, medicalTable);
  if (restrictToDishIds && restrictToDishIds.length > 0) {
    const allow = new Set(restrictToDishIds);
    const narrowed = pool.filter((d) => allow.has(d.id));
    if (narrowed.length >= 3) pool = narrowed;
  }
  if (pool.length === 0) {
    throw new Error(
      medicalTable
        ? `Нет блюд для ${medicalTable}. Добавьте рационы этого стола в библиотеку.`
        : "Нет блюд общей библиотеки (тег general). Рационы лечебных столов без выбора стола не используются.",
    );
  }

  const days = generatePlan(pool, {
    mealsPerDay,
    preferredProducts: foods,
    excludedProducts: excluded,
    targets,
    recipeComplexity: complexity,
    mealPattern: pattern,
  });

  // upsert plan
  const { data: existing } = await supabase
    .from("nutrition_plans")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const dbTargets = roundTargetsForDb(targets);
  const payload = {
    user_id: userId,
    meals_per_day: mealsPerDay,
    preferred_products: preferredStored,
    excluded_products: excluded,
    target_kcal: dbTargets.kcal,
    target_protein_g: dbTargets.protein_g,
    target_fat_g: dbTargets.fat_g,
    target_carbs_g: dbTargets.carbs_g,
    targets_manual: targetsManual ?? false,
    generated_at: new Date().toISOString(),
  };

  let planId: string;
  if (existing) {
    const { data, error } = await supabase
      .from("nutrition_plans")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    planId = data.id;
  } else {
    const { data, error } = await supabase
      .from("nutrition_plans")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    planId = data.id;
  }

  const { error: delErr } = await supabase
    .from("nutrition_plan_days")
    .delete()
    .eq("plan_id", planId);
  if (delErr) throw delErr;
  const dayRows = days.map((d) => ({
    plan_id: planId,
    day_index: d.day_index,
    day_note: d.day_note,
    meals: d.meals as unknown as never,
  }));
  const { error: daysErr } = await supabase.from("nutrition_plan_days").insert(dayRows);
  if (daysErr) throw daysErr;

  return await loadPlanFor(userId).then((res) => ({ plan: res.plan!, days: res.days }));
}

export async function updateDayMeals(
  planId: string,
  dayIndex: number,
  meals: MealEntry[],
  dayNote?: string,
) {
  const patch: Record<string, unknown> = { meals: meals as unknown };
  if (dayNote !== undefined) patch.day_note = dayNote;
  const { data, error } = await supabase
    .from("nutrition_plan_days")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("plan_id", planId)
    .eq("day_index", dayIndex)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("День меню не найден — изменения не сохранились");
}

/** Правка тренера фиксирует план: клиентский кабинет больше не пересобирает меню. */
export function dishIdsFromPlanDays(days: { meals: MealEntry[] }[]): string[] {
  const ids = new Set<string>();
  for (const d of days) {
    for (const m of d.meals ?? []) {
      if (m?.dish_id) ids.add(m.dish_id);
    }
  }
  return [...ids];
}

export async function lockPlanManual(planId: string) {
  const { error } = await supabase
    .from("nutrition_plans")
    .update({ targets_manual: true })
    .eq("id", planId);
  if (error) throw error;
}

export function replaceMeal(
  meals: MealEntry[],
  slot: Slot,
  patch: Partial<MealEntry>,
): MealEntry[] {
  return meals.map((m) => (m.slot === slot ? { ...m, ...patch } : m));
}

export function scalePortionForSwap(oldDish: Dish, oldPortion: number, newDish: Dish): number {
  const oldKcal = (oldDish.calories_per_100g * oldPortion) / 100;
  const per100 = Math.max(newDish.calories_per_100g, 1);
  // 1 г точность — та же ккал-логика, что у генерации дня (без шага 5 г).
  const exact = (oldKcal / per100) * 100;
  const rounded = Math.max(60, Math.round(exact));
  const floor = Math.max(60, Math.floor(exact));
  const ceil = Math.max(60, Math.ceil(exact));
  const err = (g: number) => Math.abs((per100 * g) / 100 - oldKcal);
  let best = rounded;
  if (err(floor) < err(best)) best = floor;
  if (err(ceil) < err(best)) best = ceil;
  return best;
}

export { calcTargets, filterDishesForMedicalTable };
export type { DayEntry, MealEntry, Dish, NutritionTargets };
