import { supabase } from "@/integrations/supabase/client";
import {
  buildConstructorNutritionSnapshot,
  buildLegacyNutritionSnapshot,
  constructorDaysFromSnapshot,
  diffNutritionSnapshots,
  nutritionSnapshotHash,
  scaleConstructorDaysToKcal,
} from "@/lib/published-programs/nutrition-snapshot";
import {
  buildTrainingSnapshot,
  exercisesFromTrainingSnapshot,
  programDaysFromSnapshot,
  trainingSnapshotHash,
} from "@/lib/published-programs/training-snapshot";
import {
  CLIENT_NUTRITION_UPDATED_MESSAGE,
  PUBLISHED_IMMUTABLE_ERROR,
} from "@/lib/published-programs/config";
import type {
  NutritionRecommendation,
  NutritionSnapshot,
  TrainingSnapshot,
  VersionMeta,
} from "@/lib/published-programs/types";
import {
  loadConstructorPlanFor,
  saveConstructorPlan,
  type ConstructorPlanRow,
} from "@/lib/nutrition-constructor/repo";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import { loadDishes, loadPlanFor, type DayRow, type PlanRow } from "@/lib/nutrition-repo";
import {
  loadExercises,
  loadProgramFor,
  createOrReplaceCustomProgram,
  type DayRow as TrainingDayRow,
  type ProgramRow,
} from "@/lib/training-repo";
import type { Exercise, ProgramDay, ProgramInput } from "@/lib/training";
import type { Dish } from "@/lib/nutrition";

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    /Could not find the function|schema cache|PGRST202|does not exist/i.test(msg) ||
    error.code === "PGRST202"
  );
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return /schema cache|does not exist|PGRST205|relation/i.test(msg) || error.code === "42P01";
}

export type PublishedNutritionView = {
  version: VersionMeta | null;
  snapshot: NutritionSnapshot;
  source: "published" | "legacy_fallback";
};

export type PublishedTrainingView = {
  version: VersionMeta | null;
  snapshot: TrainingSnapshot;
  program: ProgramRow;
  days: TrainingDayRow[];
  exercises: Exercise[];
  source: "published" | "legacy_fallback";
};

function mapVersionMeta(row: Record<string, unknown>): VersionMeta {
  return {
    id: row.id as string,
    client_id: row.client_id as string,
    version: row.version as number,
    status: row.status as VersionMeta["status"],
    content_hash: row.content_hash as string,
    parent_version_id: (row.parent_version_id as string | null) ?? null,
    created_at: row.created_at as string,
    created_by: (row.created_by as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    published_by: (row.published_by as string | null) ?? null,
  };
}

export async function loadPublishedNutritionFor(
  clientId: string,
): Promise<PublishedNutritionView | null> {
  const { data: assignment, error: aErr } = await supabase
    .from("client_program_assignments" as never)
    .select("active_version_id")
    .eq("client_id", clientId)
    .eq("kind", "nutrition")
    .maybeSingle();

  if (aErr && isMissingTable(aErr)) {
    return loadNutritionLegacyFallback(clientId);
  }
  if (aErr) throw aErr;

  const activeId = (assignment as { active_version_id?: string } | null)?.active_version_id;
  if (activeId) {
    const { data: ver, error: vErr } = await supabase
      .from("nutrition_plan_versions" as never)
      .select("*")
      .eq("id", activeId)
      .eq("status", "published")
      .maybeSingle();
    if (vErr) throw vErr;
    if (ver) {
      const row = ver as Record<string, unknown>;
      return {
        version: mapVersionMeta(row),
        snapshot: row.snapshot as NutritionSnapshot,
        source: "published",
      };
    }
  }

  // Таблица версий есть, назначения нет — черновик клиенту не показываем.
  return null;
}

async function loadNutritionLegacyFallback(
  clientId: string,
): Promise<PublishedNutritionView | null> {
  const ctor = await loadConstructorPlanFor(clientId);
  if (ctor.plan && ctor.plan.plan_status === "assigned" && ctor.days.length > 0) {
    const days: ConstructorDay[] = ctor.days.map((row) => ({
      day_index: row.day_index,
      day_note: row.day_note,
      items: row.items,
      kcal: row.kcal,
      protein_g: row.protein_g,
      fat_g: row.fat_g,
      carbs_g: row.carbs_g,
      fiber_g: row.fiber_g,
      is_valid: row.is_valid,
    }));
    const snapshot = buildConstructorNutritionSnapshot({
      days,
      targets: {
        kcal: ctor.plan.target_kcal,
        protein_g: ctor.plan.target_protein_g,
        fat_g: ctor.plan.target_fat_g,
        carbs_g: ctor.plan.target_carbs_g,
      },
      meal_schedule_mode: ctor.plan.meal_schedule_mode,
      primary_meal_slot: ctor.plan.primary_meal_slot,
      bmr: ctor.plan.bmr,
      tdee: ctor.plan.tdee,
      calorie_adjustment_pct: ctor.plan.calorie_adjustment_pct,
      notes: ctor.plan.notes,
      reason: "legacy_fallback",
    });
    return { version: null, snapshot, source: "legacy_fallback" };
  }

  const legacy = await loadPlanFor(clientId);
  if (!legacy.plan || legacy.days.length === 0) return null;
  // Только «назначенное» legacy-меню: targets_manual или просто наличие плана.
  // Черновик без дней уже отфильтрован.
  const dishes = await loadDishes();
  const snapshot = buildLegacyNutritionSnapshot({
    days: legacy.days.map((d) => ({
      day_index: d.day_index,
      day_note: d.day_note,
      meals: d.meals,
    })),
    dishes,
    targets: {
      kcal: legacy.plan.target_kcal,
      protein_g: legacy.plan.target_protein_g,
      fat_g: legacy.plan.target_fat_g,
      carbs_g: legacy.plan.target_carbs_g,
    },
    meals_per_day: legacy.plan.meals_per_day,
    notes: legacy.plan.notes,
    reason: "legacy_fallback",
  });
  return { version: null, snapshot, source: "legacy_fallback" };
}

export async function loadPublishedTrainingFor(
  clientId: string,
): Promise<PublishedTrainingView | null> {
  const { data: assignment, error: aErr } = await supabase
    .from("client_program_assignments" as never)
    .select("active_version_id")
    .eq("client_id", clientId)
    .eq("kind", "training")
    .maybeSingle();

  if (aErr && isMissingTable(aErr)) {
    return loadTrainingLegacyFallback(clientId);
  }
  if (aErr) throw aErr;

  const activeId = (assignment as { active_version_id?: string } | null)?.active_version_id;
  if (activeId) {
    const { data: ver, error: vErr } = await supabase
      .from("training_program_versions" as never)
      .select("*")
      .eq("id", activeId)
      .eq("status", "published")
      .maybeSingle();
    if (vErr) throw vErr;
    if (ver) {
      const row = ver as Record<string, unknown>;
      const snapshot = row.snapshot as TrainingSnapshot;
      const exercises = exercisesFromTrainingSnapshot(snapshot);
      const daysRaw = programDaysFromSnapshot(snapshot);
      const program: ProgramRow = {
        id: row.id as string,
        user_id: row.client_id as string,
        sessions_per_week: snapshot.sessions_per_week,
        goal: snapshot.goal,
        level: snapshot.level,
        has_injuries: snapshot.has_injuries,
        injuries_details: snapshot.injuries_details,
        equipment: snapshot.equipment,
        location: snapshot.location,
        notes: snapshot.notes,
        faq: (snapshot.faq as ProgramRow["faq"]) ?? [],
        targets_manual: true,
        program_weeks: snapshot.program_weeks,
      };
      const days: TrainingDayRow[] = daysRaw.map((d, i) => ({
        id: `${row.id}-${i}`,
        program_id: row.id as string,
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
      return {
        version: mapVersionMeta(row),
        snapshot,
        program,
        days,
        exercises,
        source: "published",
      };
    }
  }

  // Таблица версий есть — без назначения клиент не видит черновик.
  return null;
}

async function loadTrainingLegacyFallback(clientId: string): Promise<PublishedTrainingView | null> {
  const [ex, p] = await Promise.all([loadExercises(), loadProgramFor(clientId)]);
  if (!p.program || p.days.length === 0) return null;
  const days: ProgramDay[] = p.days.map((d) => ({
    week_index: d.week_index,
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
  const snapshot = buildTrainingSnapshot({
    sessions_per_week: p.program.sessions_per_week,
    goal: p.program.goal,
    level: p.program.level,
    has_injuries: p.program.has_injuries,
    injuries_details: p.program.injuries_details,
    equipment: p.program.equipment,
    location: p.program.location,
    notes: p.program.notes,
    faq: p.program.faq,
    program_weeks: p.program.program_weeks,
    days,
    exercises: ex,
  });
  return {
    version: null,
    snapshot,
    program: p.program,
    days: p.days,
    exercises: ex,
    source: "legacy_fallback",
  };
}

export async function publishConstructorNutrition(params: {
  userId: string;
  days: ConstructorDay[];
  plan: Pick<
    ConstructorPlanRow,
    | "target_kcal"
    | "target_protein_g"
    | "target_fat_g"
    | "target_carbs_g"
    | "bmr"
    | "tdee"
    | "calorie_adjustment_pct"
    | "meal_schedule_mode"
    | "primary_meal_slot"
    | "notes"
    | "plan_days_count"
  >;
  reason?: string | null;
}): Promise<{ versionId: string | null; usedRpc: boolean }> {
  const snapshot = buildConstructorNutritionSnapshot({
    days: params.days,
    targets: {
      kcal: params.plan.target_kcal,
      protein_g: params.plan.target_protein_g,
      fat_g: params.plan.target_fat_g,
      carbs_g: params.plan.target_carbs_g,
    },
    meal_schedule_mode: params.plan.meal_schedule_mode,
    primary_meal_slot: params.plan.primary_meal_slot,
    bmr: params.plan.bmr,
    tdee: params.plan.tdee,
    calorie_adjustment_pct: params.plan.calorie_adjustment_pct,
    notes: params.plan.notes,
    reason: params.reason ?? "trainer_publish",
  });
  const hash = nutritionSnapshotHash(snapshot);

  // Сначала сохраняем workspace (черновик/зеркало), затем публикуем атомарно
  await saveConstructorPlan({
    userId: params.userId,
    days: params.days,
    targets: {
      kcal: params.plan.target_kcal,
      protein_g: params.plan.target_protein_g,
      fat_g: params.plan.target_fat_g,
      carbs_g: params.plan.target_carbs_g,
    },
    plan_days_count: params.plan.plan_days_count as 1 | 7 | 14 | 28,
    plan_status: "assigned",
    bmr: params.plan.bmr ?? undefined,
    tdee: params.plan.tdee ?? undefined,
    calorie_adjustment_pct: params.plan.calorie_adjustment_pct ?? undefined,
    notes: params.plan.notes,
    meal_schedule_mode: params.plan.meal_schedule_mode,
    primary_meal_slot: params.plan.primary_meal_slot,
    targets_manual: true,
  });

  const { data, error } = await supabase.rpc(
    "publish_nutrition_version" as never,
    {
      p_client_id: params.userId,
      p_snapshot: snapshot as never,
      p_content_hash: hash,
      p_reason: params.reason ?? null,
      p_measurement_id: null,
      p_recommendation_id: null,
    } as never,
  );

  if (error && isMissingRpc(error)) {
    return { versionId: null, usedRpc: false };
  }
  if (error) throw error;
  return { versionId: (data as string) ?? null, usedRpc: true };
}

export async function publishLegacyNutrition(params: {
  userId: string;
  plan: PlanRow;
  days: DayRow[];
  dishes: Dish[];
  reason?: string | null;
}): Promise<{ versionId: string | null; usedRpc: boolean }> {
  const snapshot = buildLegacyNutritionSnapshot({
    days: params.days.map((d) => ({
      day_index: d.day_index,
      day_note: d.day_note,
      meals: d.meals,
    })),
    dishes: params.dishes,
    targets: {
      kcal: params.plan.target_kcal,
      protein_g: params.plan.target_protein_g,
      fat_g: params.plan.target_fat_g,
      carbs_g: params.plan.target_carbs_g,
    },
    meals_per_day: params.plan.meals_per_day,
    notes: params.plan.notes,
    reason: params.reason ?? "trainer_publish",
  });
  const hash = nutritionSnapshotHash(snapshot);
  const { data, error } = await supabase.rpc(
    "publish_nutrition_version" as never,
    {
      p_client_id: params.userId,
      p_snapshot: snapshot as never,
      p_content_hash: hash,
      p_reason: params.reason ?? null,
      p_measurement_id: null,
      p_recommendation_id: null,
    } as never,
  );
  if (error && isMissingRpc(error)) return { versionId: null, usedRpc: false };
  if (error) throw error;
  return { versionId: (data as string) ?? null, usedRpc: true };
}

export async function publishTrainingProgram(params: {
  userId: string;
  input: ProgramInput;
  days: ProgramDay[];
  programWeeks: number;
  notes?: string | null;
  faq?: unknown;
  exercises: Exercise[];
  name?: string;
}): Promise<{ versionId: string | null; usedRpc: boolean }> {
  // Workspace (черновик) — клиент читает только published assignment
  await createOrReplaceCustomProgram({
    userId: params.userId,
    input: params.input,
    days: params.days,
    programWeeks: params.programWeeks,
    notes: params.notes,
    targetsManual: true,
  });

  const snapshot = buildTrainingSnapshot({
    name: params.name,
    sessions_per_week: params.input.sessions_per_week,
    goal: params.input.goal,
    level: params.input.level,
    has_injuries: params.input.has_injuries,
    injuries_details: params.input.injuries_details ?? null,
    equipment: params.input.equipment ?? [],
    location: params.input.location ?? null,
    notes: params.notes ?? null,
    faq: params.faq ?? [],
    program_weeks: params.programWeeks,
    days: params.days,
    exercises: params.exercises,
  });
  const hash = trainingSnapshotHash(snapshot);
  const { data, error } = await supabase.rpc(
    "publish_training_version" as never,
    {
      p_client_id: params.userId,
      p_snapshot: snapshot as never,
      p_content_hash: hash,
      p_reason: "trainer_publish",
    } as never,
  );
  if (error && isMissingRpc(error)) return { versionId: null, usedRpc: false };
  if (error) throw error;
  return { versionId: (data as string) ?? null, usedRpc: true };
}

export async function loadPendingNutritionRecommendation(
  clientId: string,
): Promise<NutritionRecommendation | null> {
  const { data, error } = await supabase
    .from("nutrition_recommendations" as never)
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "pending_trainer_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && isMissingTable(error)) return null;
  if (error) throw error;
  return (data as NutritionRecommendation | null) ?? null;
}

export async function createNutritionCorrectionDraft(params: {
  userId: string;
  recommendation: NutritionRecommendation;
}): Promise<{
  days: ConstructorDay[];
  snapshot: NutritionSnapshot;
  diff: ReturnType<
    typeof import("@/lib/published-programs/nutrition-snapshot").diffNutritionSnapshots
  >;
}> {
  const published = await loadPublishedNutritionFor(params.userId);
  if (!published || published.snapshot.kind !== "constructor") {
    throw new Error("Корректировка доступна для конструкторского меню");
  }
  const oldDays = constructorDaysFromSnapshot(published.snapshot);
  const scaled = scaleConstructorDaysToKcal(
    oldDays,
    published.snapshot.targets.kcal,
    params.recommendation.recommended_kcal,
  );
  const nextSnapshot = buildConstructorNutritionSnapshot({
    days: scaled,
    targets: {
      kcal: params.recommendation.recommended_kcal,
      protein_g: params.recommendation.recommended_protein_g,
      fat_g: params.recommendation.recommended_fat_g,
      carbs_g: params.recommendation.recommended_carbs_g,
    },
    meal_schedule_mode: published.snapshot.meal_schedule_mode,
    primary_meal_slot: published.snapshot.primary_meal_slot,
    bmr: params.recommendation.bmr,
    tdee: params.recommendation.tdee,
    notes: published.snapshot.notes,
    reason: `Корректировка по замерам ${params.recommendation.measurement_id ?? ""}`.trim(),
  });
  const planDays = Math.max(1, scaled.length) as 1 | 7 | 14 | 28;
  await saveConstructorPlan({
    userId: params.userId,
    days: scaled,
    targets: nextSnapshot.targets,
    plan_days_count: ([1, 7, 14, 28].includes(planDays) ? planDays : 7) as 1 | 7 | 14 | 28,
    plan_status: "draft",
    bmr: params.recommendation.bmr,
    tdee: params.recommendation.tdee,
    notes: nextSnapshot.notes,
    meal_schedule_mode: published.snapshot.meal_schedule_mode as never,
    primary_meal_slot: published.snapshot.primary_meal_slot as never,
    targets_manual: true,
    review_reason: nextSnapshot.reason,
  });

  await supabase
    .from("nutrition_recommendations" as never)
    .update({ status: "accepted" } as never)
    .eq("id", params.recommendation.id as string);

  return {
    days: scaled,
    snapshot: nextSnapshot,
    diff: diffNutritionSnapshots(published.snapshot, nextSnapshot),
  };
}

export function forbidDirectPublishedMutation(): never {
  throw new Error(PUBLISHED_IMMUTABLE_ERROR);
}

export { CLIENT_NUTRITION_UPDATED_MESSAGE };
