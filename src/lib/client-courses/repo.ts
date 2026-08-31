import { supabase } from "@/integrations/supabase/client";
import {
  buildCourseTitleFromISO,
  courseEndDate,
  courseStatusLabel,
  formatCourseTitle,
  parseISODate,
  toISODate,
  type ClientCourseStatus,
} from "@/lib/client-courses/format";

export type ClientCourse = {
  id: string;
  client_id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: ClientCourseStatus;
  created_at: string;
  created_by: string | null;
  notes: string | null;
};

export { courseStatusLabel, formatCourseTitle, buildCourseTitleFromISO };

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return /schema cache|does not exist|PGRST205|relation/i.test(msg) || error.code === "42P01";
}

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return /column.*does not exist|42703/i.test(error.message ?? "");
}

export async function listClientCourses(clientId: string): Promise<ClientCourse[]> {
  const { data, error } = await supabase
    .from("client_courses" as never)
    .select("*")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });

  if (error && (isMissingTable(error) || isMissingColumn(error))) return [];
  if (error) throw error;
  return (data ?? []) as ClientCourse[];
}

export async function getClientCourse(courseId: string): Promise<ClientCourse | null> {
  const { data, error } = await supabase
    .from("client_courses" as never)
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (error && (isMissingTable(error) || isMissingColumn(error))) return null;
  if (error) throw error;
  return (data as ClientCourse | null) ?? null;
}

export async function resolveCourseId(
  clientId: string,
  courseId?: string | null,
): Promise<string | null> {
  if (courseId) return courseId;

  const { data, error } = await supabase.rpc(
    "resolve_client_course_id" as never,
    { p_client_id: clientId, p_course_id: null } as never,
  );
  if (error && (isMissingTable(error) || /Could not find the function/i.test(error.message ?? ""))) {
    return null;
  }
  if (error) throw error;
  return (data as string | null) ?? null;
}

async function cloneTrainingProgram(
  sourceCourseId: string,
  targetCourseId: string,
  clientId: string,
): Promise<void> {
  const { data: src } = await supabase
    .from("training_programs")
    .select("*")
    .eq("course_id", sourceCourseId)
    .maybeSingle();
  if (!src) return;

  const { data: created, error: insErr } = await supabase
    .from("training_programs")
    .insert({
      user_id: clientId,
      course_id: targetCourseId,
      sessions_per_week: src.sessions_per_week,
      goal: src.goal,
      level: src.level,
      has_injuries: src.has_injuries,
      injuries_details: src.injuries_details,
      equipment: src.equipment,
      location: src.location,
      notes: src.notes,
      faq: src.faq,
      targets_manual: src.targets_manual,
      program_weeks: (src as { program_weeks?: number }).program_weeks ?? 4,
      generated_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();
  if (insErr) throw insErr;

  const { data: days } = await supabase
    .from("training_program_days")
    .select("*")
    .eq("program_id", src.id);
  if (!days?.length) return;

  const rows = days.map((d) => ({
    program_id: created.id,
    week_index: d.week_index ?? 0,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup,
    exercises: d.exercises,
    cooldown: d.cooldown,
    day_note: d.day_note,
  }));
  const { error: daysErr } = await supabase.from("training_program_days").insert(rows as never);
  if (daysErr) throw daysErr;
}

async function cloneNutritionPlan(
  sourceCourseId: string,
  targetCourseId: string,
  clientId: string,
): Promise<void> {
  const { data: src } = await supabase
    .from("nutrition_plans")
    .select("*")
    .eq("course_id", sourceCourseId)
    .maybeSingle();
  if (!src) return;

  const { data: created, error: insErr } = await supabase
    .from("nutrition_plans")
    .insert({
      user_id: clientId,
      course_id: targetCourseId,
      meals_per_day: src.meals_per_day,
      preferred_products: src.preferred_products,
      excluded_products: src.excluded_products,
      target_kcal: src.target_kcal,
      target_protein_g: src.target_protein_g,
      target_fat_g: src.target_fat_g,
      target_carbs_g: src.target_carbs_g,
      targets_manual: src.targets_manual,
      notes: src.notes,
      plan_mode: (src as { plan_mode?: string }).plan_mode ?? "legacy",
      plan_days_count: (src as { plan_days_count?: number }).plan_days_count ?? 7,
      plan_status: "draft",
      meal_schedule_mode: (src as { meal_schedule_mode?: string }).meal_schedule_mode,
      primary_meal_slot: (src as { primary_meal_slot?: string }).primary_meal_slot,
      bmr: (src as { bmr?: number }).bmr,
      tdee: (src as { tdee?: number }).tdee,
      calorie_adjustment_pct: (src as { calorie_adjustment_pct?: number }).calorie_adjustment_pct,
      generated_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();
  if (insErr) throw insErr;

  const { data: planDays } = await supabase
    .from("nutrition_plan_days")
    .select("*")
    .eq("plan_id", src.id);
  if (!planDays?.length) return;

  for (const day of planDays) {
    const { data: newDay, error: dayErr } = await supabase
      .from("nutrition_plan_days")
      .insert({
        plan_id: created.id,
        day_index: day.day_index,
        day_note: day.day_note,
        meals: day.meals,
      } as never)
      .select("id")
      .single();
    if (dayErr) throw dayErr;

    const { data: items } = await supabase
      .from("meal_plan_items" as never)
      .select("*")
      .eq("plan_day_id", day.id);
    if (!items?.length) continue;

    for (const item of items as Array<Record<string, unknown>>) {
      const { data: newItem, error: itemErr } = await supabase
        .from("meal_plan_items" as never)
        .insert({
          plan_day_id: newDay.id,
          slot: item.slot,
          recipe_id: item.recipe_id,
          recipe_name: item.recipe_name,
          requires_cooking: item.requires_cooking,
          prep_time_min: item.prep_time_min,
          steps: item.steps,
          weighing_note: item.weighing_note,
          snack_action: item.snack_action,
          kcal: item.kcal,
          protein_g: item.protein_g,
          fat_g: item.fat_g,
          carbs_g: item.carbs_g,
          fiber_g: item.fiber_g,
          sort_order: item.sort_order,
        } as never)
        .select("id")
        .single();
      if (itemErr && !isMissingTable(itemErr)) throw itemErr;
      if (itemErr || !newItem) continue;

      const mealItemId = (newItem as { id: string }).id;

      const { data: ings } = await supabase
        .from("meal_plan_item_ingredients" as never)
        .select("*")
        .eq("meal_item_id", item.id as string);
      if (!ings?.length) continue;

      const ingRows = (ings as Array<Record<string, unknown>>).map((ig) => ({
        meal_item_id: mealItemId,
        product_id: ig.product_id,
        product_name: ig.product_name,
        grams: ig.grams,
        weighing_note: ig.weighing_note,
        kcal_per_100g: ig.kcal_per_100g,
        protein_per_100g: ig.protein_per_100g,
        fat_per_100g: ig.fat_per_100g,
        carbs_per_100g: ig.carbs_per_100g,
        fiber_per_100g: ig.fiber_per_100g,
        kcal: ig.kcal,
        protein_g: ig.protein_g,
        fat_g: ig.fat_g,
        carbs_g: ig.carbs_g,
        fiber_g: ig.fiber_g,
        sort_order: ig.sort_order,
      }));
      const { error: ingErr } = await supabase
        .from("meal_plan_item_ingredients" as never)
        .insert(ingRows as never);
      if (ingErr && !isMissingTable(ingErr)) throw ingErr;
    }
  }
}

export async function createClientCourse(params: {
  clientId: string;
  startDate?: string;
  createdBy?: string | null;
  cloneFromCourseId?: string | null;
  activate?: boolean;
  notes?: string | null;
}): Promise<ClientCourse> {
  const start = params.startDate ? parseISODate(params.startDate) : new Date();
  const startIso = toISODate(start);
  const endIso = toISODate(courseEndDate(start));
  const title = formatCourseTitle(start, courseEndDate(start));
  const status: ClientCourseStatus = params.activate ? "active" : "draft";

  if (params.activate) {
    await supabase
      .from("client_courses" as never)
      .update({ status: "completed" } as never)
      .eq("client_id", params.clientId)
      .eq("status", "active");
  }

  const { data: course, error } = await supabase
    .from("client_courses" as never)
    .insert({
      client_id: params.clientId,
      title,
      start_date: startIso,
      end_date: endIso,
      status,
      created_by: params.createdBy ?? null,
      notes: params.notes ?? null,
    } as never)
    .select("*")
    .single();

  if (error) throw error;
  const created = course as ClientCourse;

  const sourceId =
    params.cloneFromCourseId ??
    (
      await listClientCourses(params.clientId).then((list) =>
        list.find((c) => c.id !== created.id && c.status !== "draft"),
      )
    )?.id ??
    null;

  if (sourceId) {
    await cloneTrainingProgram(sourceId, created.id, params.clientId);
    await cloneNutritionPlan(sourceId, created.id, params.clientId);
  }

  return created;
}

/** Клиент запрашивает продление: новый 4-недельный курс-черновик с копией прошлого контента. */
export async function renewClientCourse(clientId: string): Promise<ClientCourse> {
  return createClientCourse({
    clientId,
    startDate: toISODate(new Date()),
    createdBy: clientId,
    activate: false,
    notes: "Запрос на продление от клиента",
  });
}

export async function activateClientCourse(courseId: string, clientId: string): Promise<void> {
  await supabase
    .from("client_courses" as never)
    .update({ status: "completed" } as never)
    .eq("client_id", clientId)
    .eq("status", "active");

  const { error } = await supabase
    .from("client_courses" as never)
    .update({ status: "active" } as never)
    .eq("id", courseId);
  if (error) throw error;
}

export async function archiveClientCourse(courseId: string): Promise<void> {
  const { error } = await supabase
    .from("client_courses" as never)
    .update({ status: "archived" } as never)
    .eq("id", courseId);
  if (error) throw error;
}
