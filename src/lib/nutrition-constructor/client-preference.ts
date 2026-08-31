import { supabase } from "@/integrations/supabase/client";
import type { MealScheduleMode, PrimaryMealSlot } from "@/lib/nutrition-constructor/config";
import { resolveCourseId } from "@/lib/client-courses/repo";

export async function loadClientMealSchedulePreference(params: {
  userId: string;
  courseId?: string | null;
}): Promise<{ mode: MealScheduleMode; primarySlot: PrimaryMealSlot } | null> {
  const courseId = await resolveCourseId(params.userId, params.courseId);

  let query = supabase
    .from("nutrition_plans")
    .select("meal_schedule_mode, primary_meal_slot, plan_mode")
    .eq("user_id", params.userId);
  if (courseId) query = query.eq("course_id", courseId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || (data as { plan_mode?: string }).plan_mode !== "constructor") return null;

  return {
    mode:
      ((data as { meal_schedule_mode?: MealScheduleMode }).meal_schedule_mode as MealScheduleMode) ??
      "two_main_two_snacks",
    primarySlot:
      ((data as { primary_meal_slot?: PrimaryMealSlot }).primary_meal_slot as PrimaryMealSlot) ??
      "lunch",
  };
}

export async function saveClientMealSchedulePreference(params: {
  userId: string;
  courseId?: string | null;
  mode: MealScheduleMode;
  primarySlot: PrimaryMealSlot;
  /** Режим в опубликованном меню — если отличается, уведомим тренера. */
  publishedMode?: MealScheduleMode | null;
}): Promise<void> {
  const courseId = await resolveCourseId(params.userId, params.courseId);

  let query = supabase.from("nutrition_plans").select("id").eq("user_id", params.userId);
  if (courseId) query = query.eq("course_id", courseId);
  const { data: plan, error: loadErr } = await query.maybeSingle();
  if (loadErr) throw loadErr;

  if (!plan?.id) {
    throw new Error("План питания ещё не создан. Дождитесь, пока тренер назначит рацион.");
  }

  const { error } = await supabase
    .from("nutrition_plans")
    .update({
      meal_schedule_mode: params.mode,
      primary_meal_slot: params.primarySlot,
    })
    .eq("id", plan.id);
  if (error) throw error;

  const needsTrainer =
    params.publishedMode != null && params.publishedMode !== params.mode;

  if (needsTrainer) {
    await supabase.from("admin_notifications").insert({
      type: "nutrition_schedule_preference",
      client_id: params.userId,
      message:
        params.mode === "one_main_three_snacks"
          ? "Клиент выбрал формат «На бегу» (1 основной + 3 перекуса без готовки). Соберите и опубликуйте меню."
          : "Клиент выбрал классический формат (2 основных + 2 перекуса). Соберите и опубликуйте меню.",
      link: `/admin/clients/${params.userId}/nutrition${courseId ? `?course=${courseId}` : ""}`,
    } as never);
  }
}
