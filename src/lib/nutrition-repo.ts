import { supabase } from "@/integrations/supabase/client";
import {
  type Dish,
  type DayEntry,
  type MealEntry,
  type Slot,
  type NutritionTargets,
  calcTargets,
  generatePlan,
} from "@/lib/nutrition";

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

export async function loadPlanFor(userId: string): Promise<{ plan: PlanRow | null; days: DayRow[] }> {
  const { data: plan } = await supabase
    .from("nutrition_plans")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
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
  const source = texts.filter(Boolean).join(" ").toLowerCase();
  const map: Array<{ triggers: string[]; tag: string }> = [
    { triggers: ["лактоз", "молоч"], tag: "молочка" },
    { triggers: ["орех"], tag: "орехи" },
    { triggers: ["рыб"], tag: "рыба" },
    { triggers: ["морепрод", "креветк"], tag: "морепродукты" },
    { triggers: ["говядин"], tag: "говядина" },
    { triggers: ["куриц", "куринo", "птиц"], tag: "птица" },
    { triggers: ["яйц", "яичн"], tag: "яйца" },
    { triggers: ["глютен", "клейков"], tag: "цельнозерновое" },
    { triggers: ["бобов"], tag: "бобовые" },
  ];
  const out = new Set<string>();
  for (const m of map) if (m.triggers.some((t) => source.includes(t))) out.add(m.tag);
  return Array.from(out);
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
}): Promise<{ plan: PlanRow; days: DayRow[] }> {
  const { userId, mealsPerDay, preferred, excluded, targets, targetsManual, dishes } = params;

  const days = generatePlan(dishes, {
    mealsPerDay,
    preferredProducts: preferred,
    excludedProducts: excluded,
    targets,
  });

  // upsert plan
  const { data: existing } = await supabase
    .from("nutrition_plans")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    meals_per_day: mealsPerDay,
    preferred_products: preferred,
    excluded_products: excluded,
    target_kcal: targets.kcal,
    target_protein_g: targets.protein_g,
    target_fat_g: targets.fat_g,
    target_carbs_g: targets.carbs_g,
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

  await supabase.from("nutrition_plan_days").delete().eq("plan_id", planId);
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
  const { error } = await supabase
    .from("nutrition_plan_days")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as any)
    .eq("plan_id", planId)
    .eq("day_index", dayIndex);
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
  const g = (oldKcal / per100) * 100;
  return Math.max(60, Math.round(g / 5) * 5);
}

export { calcTargets };
export type { DayEntry, MealEntry, Dish, NutritionTargets };
