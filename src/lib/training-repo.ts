import { supabase } from "@/integrations/supabase/client";
import {
  type Exercise,
  type ExerciseCategory,
  type ExerciseSet,
  type ProgramDay,
  type ProgramInput,
  type ProgramGoal,
  type ProgramLevel,
  type FaqItem,
  defaultFaq,
  inferGoal,
  inferLevel,
  isImpactOrJumpExercise,
  needsJointCare,
} from "@/lib/training";
import { COACH_PROGRAM_WEEKS, resolveDefaultTrainingProgram } from "@/lib/coach-sheet-program";
import { persistProgramWithDaysForClient } from "@/lib/training-persist";

async function loadLatestWeightKg(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from("measurements")
    .select("weight_kg")
    .eq("user_id", userId)
    .not("weight_kg", "is", null)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const w = data?.weight_kg;
  return typeof w === "number" && Number.isFinite(w) ? w : w != null ? Number(w) : null;
}

export type ProgramRow = {
  id: string;
  user_id: string;
  sessions_per_week: number;
  goal: string | null;
  level: string;
  has_injuries: boolean;
  injuries_details: string | null;
  equipment: string[];
  location: string | null;
  notes: string | null;
  faq: FaqItem[];
  targets_manual: boolean;
  program_weeks: number;
};

export type DayRow = {
  id: string;
  program_id: string;
  week_index: number;
  day_index: number;
  is_rest: boolean;
  title: string;
  focus: string | null;
  description: string | null;
  warmup: ExerciseSet[];
  exercises: ExerciseSet[];
  cooldown: ExerciseSet[];
  day_note: string | null;
};

export async function loadExercises(): Promise<Exercise[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .order("name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows.map((e) => ({
    ...e,
    cues: (e.cues ?? []) as string[],
    common_mistakes: (e.common_mistakes ?? []) as string[],
    muscle_groups: (e.muscle_groups as string[]) ?? [],
    equipment: (e.equipment as string[]) ?? [],
    tags: (e.tags as string[]) ?? [],
    category: e.category as ExerciseCategory,
    difficulty: e.difficulty as Exercise["difficulty"],
  })) as Exercise[];
}

function asWeekIndex(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function isMissingSchemaColumn(error: { message?: string }, column: string): boolean {
  const msg = error.message ?? "";
  return (
    new RegExp(column, "i").test(msg) &&
    /schema cache|could not find|PGRST204|column/i.test(msg)
  );
}

function dayInsertRow(
  programId: string,
  d: Record<string, unknown>,
  withWeekIndex: boolean,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    program_id: programId,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup,
    exercises: d.exercises,
    cooldown: d.cooldown,
    day_note: d.day_note,
  };
  if (withWeekIndex) row.week_index = asWeekIndex(d.week_index);
  return row;
}

function inferProgramWeeks(days: Array<{ week_index?: number }>): number {
  if (days.length === 0) return 1;
  const maxWeek = Math.max(...days.map((d) => asWeekIndex(d.week_index)));
  return maxWeek > 0 ? maxWeek + 1 : 1;
}

function mapDayRow(d: Record<string, unknown>): DayRow {
  return {
    id: d.id as string,
    program_id: d.program_id as string,
    week_index: asWeekIndex(d.week_index),
    day_index: d.day_index as number,
    is_rest: d.is_rest as boolean,
    title: d.title as string,
    focus: (d.focus as string | null) ?? null,
    description: (d.description as string | null) ?? null,
    warmup: (d.warmup ?? []) as ExerciseSet[],
    exercises: (d.exercises ?? []) as ExerciseSet[],
    cooldown: (d.cooldown ?? []) as ExerciseSet[],
    day_note: (d.day_note as string | null) ?? null,
  };
}

async function loadDaysForProgram(programId: string): Promise<DayRow[]> {
  const { data, error } = await supabase
    .from("training_program_days")
    .select("*")
    .eq("program_id", programId)
    .order("week_index", { ascending: true })
    .order("day_index", { ascending: true });

  if (error) {
    // Старая схема без week_index
    if (isMissingSchemaColumn(error, "week_index")) {
      const legacy = await supabase
        .from("training_program_days")
        .select("*")
        .eq("program_id", programId)
        .order("day_index", { ascending: true });
      if (legacy.error) throw legacy.error;
      return (legacy.data ?? []).map((d) => mapDayRow(d as Record<string, unknown>));
    }
    throw error;
  }
  return (data ?? []).map((d) => mapDayRow(d as Record<string, unknown>));
}

async function replaceProgramDays(
  programId: string,
  rows: Record<string, unknown>[],
): Promise<{ multiWeek: boolean }> {
  const needsMultiWeek = rows.some((r) => asWeekIndex(r.week_index) > 0);

  // Атомарная замена через RPC (если миграция применена)
  if (needsMultiWeek) {
    const { data: rpcCount, error: rpcErr } = await supabase.rpc(
      "replace_training_program_days",
      {
        p_program_id: programId,
        p_rows: rows as unknown as never,
      },
    );
    if (!rpcErr && typeof rpcCount === "number") {
      return { multiWeek: true };
    }
    // RPC нет или ошибка схемы — fallback ниже
    if (
      rpcErr &&
      !/function|schema cache|PGRST202|Could not find/i.test(rpcErr.message ?? "") &&
      !isMissingSchemaColumn(rpcErr, "week_index")
    ) {
      // Недоступ по RLS и т.п. — пробуем прямой insert
    }
  }

  const { error: delErr } = await supabase
    .from("training_program_days")
    .delete()
    .eq("program_id", programId);
  if (delErr) throw delErr;

  if (needsMultiWeek) {
    const fullRows = rows.map((d) => dayInsertRow(programId, d, true));
    const { error } = await supabase.from("training_program_days").insert(fullRows as never);
    if (!error) return { multiWeek: true };
    if (!isMissingSchemaColumn(error, "week_index")) throw error;

    const week0Rows = rows
      .filter((r) => asWeekIndex(r.week_index) === 0)
      .map((d) => dayInsertRow(programId, d, false));
    const { error: fallbackErr } = await supabase
      .from("training_program_days")
      .insert(week0Rows as never);
    if (fallbackErr) throw fallbackErr;
    return { multiWeek: false };
  }

  const legacyRows = rows.map((d) => dayInsertRow(programId, d, false));
  const { error: daysErr } = await supabase
    .from("training_program_days")
    .insert(legacyRows as never);
  if (daysErr) throw daysErr;
  return { multiWeek: false };
}

export async function loadProgramFor(
  userId: string,
  courseId?: string | null,
): Promise<{ program: ProgramRow | null; days: DayRow[] }> {
  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));

  let programQuery = supabase.from("training_programs").select("*").eq("user_id", userId);
  if (resolvedCourseId) {
    programQuery = programQuery.eq("course_id", resolvedCourseId);
  }
  let { data: program, error: programError } = await programQuery.maybeSingle();
  if (programError) throw programError;
  if (!program && resolvedCourseId) {
    const legacy = await supabase
      .from("training_programs")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    program = legacy.data;
  }
  if (!program) return { program: null, days: [] };

  const mappedDays = await loadDaysForProgram(program.id);
  const dbWeeks = Number((program as { program_weeks?: number }).program_weeks);
  const inferred = inferProgramWeeks(mappedDays);

  return {
    program: {
      ...program,
      faq: (program.faq ?? []) as FaqItem[],
      equipment: program.equipment ?? [],
      program_weeks: Math.max(
        Number.isFinite(dbWeeks) && dbWeeks > 0 ? dbWeeks : 1,
        inferred,
      ),
    } as ProgramRow,
    days: mappedDays,
  };
}

export async function loadProgramProfile(userId: string) {
  const [onbRes, accessRes, weight_kg, profileRes] = await Promise.all([
    supabase
      .from("onboarding_responses")
      .select(
        "activity_level, goal_primary, has_injuries, injuries_details, equipment, training_location, training_days_per_week",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("client_access").select("status").eq("user_id", userId).maybeSingle(),
    loadLatestWeightKg(userId),
    supabase.from("profiles").select("gender").eq("id", userId).maybeSingle(),
  ]);
  const rawSessions = (onbRes.data?.training_days_per_week ?? 3) as number;
  const sessions_per_week: 3 | 4 = rawSessions >= 4 ? 4 : 3;
  return {
    sessions_per_week,
    goal: inferGoal(onbRes.data?.goal_primary),
    level: inferLevel(onbRes.data?.activity_level),
    has_injuries: Boolean(onbRes.data?.has_injuries),
    injuries_details: onbRes.data?.injuries_details ?? null,
    equipment: (onbRes.data?.equipment ?? []) as string[],
    location: onbRes.data?.training_location ?? null,
    weight_kg,
    gender: (profileRes.data?.gender as "female" | "male" | null) ?? null,
    access_status: accessRes.data?.status ?? null,
  };
}

export async function createOrReplaceProgram(params: {
  userId: string;
  courseId?: string | null;
  input: ProgramInput;
  exercises: Exercise[];
  preserveNotes?: string | null;
  preserveFaq?: FaqItem[] | null;
  targetsManual?: boolean;
  /** Если дни уже сгенерированы и провалидированы снаружи. */
  preGeneratedDays?: ProgramDay[];
}): Promise<{ program: ProgramRow; days: DayRow[]; multiWeek: boolean }> {
  const { userId, courseId, input, exercises, preserveNotes, preserveFaq, targetsManual, preGeneratedDays } =
    params;
  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));

  let generatedDays: ProgramDay[];
  let programWeeks: number;
  let notes: string | null = preserveNotes ?? null;

  if (preGeneratedDays && preGeneratedDays.length > 0) {
    generatedDays = preGeneratedDays;
    programWeeks = Math.max(1, inferProgramWeeks(preGeneratedDays));
  } else {
    const plan = resolveDefaultTrainingProgram(exercises, input);
    generatedDays = plan.days;
    programWeeks = plan.programWeeks;
    if (!notes) notes = plan.coachNotes;
  }

  const faq = preserveFaq && preserveFaq.length > 0 ? preserveFaq : defaultFaq(input);

  const basePayload = {
    user_id: userId,
    ...(resolvedCourseId ? { course_id: resolvedCourseId } : {}),
    sessions_per_week: input.sessions_per_week,
    goal: input.goal,
    level: input.level,
    has_injuries: input.has_injuries,
    injuries_details: input.injuries_details ?? null,
    equipment: input.equipment ?? [],
    location: input.location ?? null,
    notes,
    faq: faq as unknown as never,
    targets_manual: targetsManual ?? false,
    generated_at: new Date().toISOString(),
  };

  const rows = generatedDays.map((d) => ({
    week_index: d.week_index ?? 0,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup as unknown as never,
    exercises: d.exercises as unknown as never,
    cooldown: d.cooldown as unknown as never,
    day_note: d.day_note,
  }));
  const { multiWeek } = await persistProgramWithDaysForClient(
    supabase,
    userId,
    resolvedCourseId,
    basePayload,
    programWeeks,
    rows,
  );

  return loadProgramFor(userId, resolvedCourseId).then((r) => ({
    program: r.program!,
    days: r.days,
    multiWeek,
  }));
}

/** Заменить программу на кастомный мультинедельный план. */
export async function createOrReplaceCustomProgram(params: {
  userId: string;
  courseId?: string | null;
  input: ProgramInput;
  days: ProgramDay[];
  programWeeks: number;
  preserveFaq?: FaqItem[] | null;
  notes?: string | null;
  targetsManual?: boolean;
}): Promise<{ program: ProgramRow; days: DayRow[]; multiWeek: boolean }> {
  const { userId, courseId, input, days, programWeeks, preserveFaq, notes, targetsManual } = params;
  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));
  const faq = preserveFaq && preserveFaq.length > 0 ? preserveFaq : defaultFaq(input);

  const basePayload = {
    user_id: userId,
    ...(resolvedCourseId ? { course_id: resolvedCourseId } : {}),
    sessions_per_week: input.sessions_per_week,
    goal: input.goal,
    level: input.level,
    has_injuries: input.has_injuries,
    injuries_details: input.injuries_details ?? null,
    equipment: input.equipment ?? [],
    location: input.location ?? null,
    notes: notes ?? null,
    faq: faq as unknown as never,
    targets_manual: targetsManual ?? true,
    generated_at: new Date().toISOString(),
  };

  const rows = days.map((d) => ({
    week_index: d.week_index ?? 0,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup as unknown as never,
    exercises: d.exercises as unknown as never,
    cooldown: d.cooldown as unknown as never,
    day_note: d.day_note,
  }));
  const weeks = Math.max(1, programWeeks || COACH_PROGRAM_WEEKS);
  const { multiWeek } = await persistProgramWithDaysForClient(
    supabase,
    userId,
    resolvedCourseId,
    basePayload,
    weeks,
    rows,
  );

  return loadProgramFor(userId, resolvedCourseId).then((r) => ({
    program: r.program!,
    days: r.days,
    multiWeek,
  }));
}

export async function updateDayPatch(
  programId: string,
  weekIndex: number,
  dayIndex: number,
  patch: Partial<
    Pick<
      DayRow,
      | "title"
      | "focus"
      | "description"
      | "warmup"
      | "exercises"
      | "cooldown"
      | "day_note"
      | "is_rest"
    >
  >,
) {
  const dbPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) dbPatch[k] = v as unknown;

  let query = supabase
    .from("training_program_days")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(dbPatch as any)
    .eq("program_id", programId)
    .eq("day_index", dayIndex)
    .eq("week_index", weekIndex);

  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("День программы не найден — изменения не сохранились");
}

/** Любая правка тренера фиксирует программу: клиентский кабинет больше не пересобирает её. */
export async function lockProgramManual(programId: string) {
  const { error } = await supabase
    .from("training_programs")
    .update({ targets_manual: true })
    .eq("id", programId);
  if (error) throw error;
}

export async function updateProgramPatch(
  programId: string,
  patch: Partial<{
    notes: string | null;
    faq: FaqItem[];
    sessions_per_week: number;
    goal: string;
    level: string;
    targets_manual: boolean;
  }>,
) {
  const dbPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch))
    dbPatch[k] = k === "faq" ? (v as unknown) : (v as unknown);
  const { error } = await supabase
    .from("training_programs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(dbPatch as any)
    .eq("id", programId);
  if (error) throw error;
}

export type { Exercise, ExerciseSet, ProgramDay, ProgramInput, ProgramGoal, ProgramLevel, FaqItem };
export { isImpactOrJumpExercise, needsJointCare };
