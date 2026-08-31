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

/** false — таблица client_courses ещё не создана (нужна SQL-миграция). */
export async function isClientCoursesAvailable(): Promise<boolean> {
  const { error } = await supabase.from("client_courses" as never).select("id").limit(1);
  if (error && (isMissingTable(error) || isMissingColumn(error))) return false;
  if (error) throw error;
  return true;
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

import { errorMessage } from "@/lib/error-message";
import { seedTrainingContinuationForCourse } from "@/lib/client-courses/seed-training-continuation";

async function generateTrainingContinuation(
  sourceCourseId: string,
  targetCourseId: string,
  clientId: string,
): Promise<void> {
  await seedTrainingContinuationForCourse({
    clientId,
    sourceCourseId,
    targetCourseId,
  });
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

  const resolveSourceId = async (excludeId?: string) =>
    params.cloneFromCourseId ??
    (
      await listClientCourses(params.clientId).then((list) =>
        list.find((c) => c.id !== excludeId && c.status !== "draft"),
      )
    )?.id ??
    null;

  if (!params.activate) {
    const existingDraft = await findDraftForStart(params.clientId, startIso);
    if (existingDraft) {
      const sourceId = await resolveSourceId(existingDraft.id);
      if (sourceId && !(await courseHasLinkedContent(existingDraft.id))) {
        const cloneErrors = await cloneFromSource(sourceId, existingDraft.id, params.clientId);
        if (cloneErrors.length > 0) {
          throw new Error(`Черновик уже есть, но копирование не удалось (${cloneErrors.join("; ")})`);
        }
      }
      return existingDraft;
    }
  }

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

  const sourceId = await resolveSourceId(created.id);

  if (sourceId) {
    const cloneErrors = await cloneFromSource(sourceId, created.id, params.clientId);
    if (cloneErrors.length > 0) {
      const hasContent = await courseHasLinkedContent(created.id);
      if (!hasContent) {
        await deleteClientCourseRow(created.id);
        throw new Error(`Не удалось создать курс (${cloneErrors.join("; ")})`);
      }
      const err = new Error(
        `Курс создан, но не всё скопировалось (${cloneErrors.join("; ")}).`,
      );
      (err as Error & { partial?: boolean; course?: ClientCourse }).partial = true;
      (err as Error & { partial?: boolean; course?: ClientCourse }).course = created;
      throw err;
    }
  }

  return created;
}

/** Клиент запрашивает продление: новый 4-недельный блок с прогрессией от прошлого курса. */
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

async function findDraftForStart(clientId: string, startIso: string): Promise<ClientCourse | null> {
  const { data, error } = await supabase
    .from("client_courses" as never)
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "draft")
    .eq("start_date", startIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && (isMissingTable(error) || isMissingColumn(error))) return null;
  if (error) throw error;
  return (data as ClientCourse | null) ?? null;
}

async function courseHasLinkedContent(courseId: string): Promise<boolean> {
  const [training, nutrition] = await Promise.all([
    supabase.from("training_programs").select("id").eq("course_id", courseId).limit(1),
    supabase.from("nutrition_plans").select("id").eq("course_id", courseId).limit(1),
  ]);
  if (training.error && !isMissingColumn(training.error)) throw training.error;
  if (nutrition.error && !isMissingColumn(nutrition.error)) throw nutrition.error;
  return Boolean(training.data?.length || nutrition.data?.length);
}

async function deleteClientCourseRow(courseId: string): Promise<void> {
  const { error } = await supabase.from("client_courses" as never).delete().eq("id", courseId);
  if (error) throw error;
}

/** Удалить черновик курса (лишние дубликаты после неудачного создания). */
export async function deleteClientCourseDraft(courseId: string, clientId: string): Promise<void> {
  const course = await getClientCourse(courseId);
  if (!course || course.client_id !== clientId) {
    throw new Error("Курс не найден");
  }
  if (course.status !== "draft") {
    throw new Error("Удалить можно только черновик");
  }
  await deleteClientCourseRow(courseId);
}

async function cloneFromSource(
  sourceId: string,
  targetCourseId: string,
  clientId: string,
): Promise<string[]> {
  const cloneErrors: string[] = [];
  try {
    await generateTrainingContinuation(sourceId, targetCourseId, clientId);
  } catch (e) {
    cloneErrors.push(`тренировки: ${errorMessage(e, "не сгенерированы")}`);
  }
  try {
    await cloneNutritionPlan(sourceId, targetCourseId, clientId);
  } catch (e) {
    cloneErrors.push(`питание: ${errorMessage(e, "не скопировано")}`);
  }
  return cloneErrors;
}
