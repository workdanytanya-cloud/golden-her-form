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
  generateProgram,
  defaultFaq,
  inferGoal,
  inferLevel,
  isImpactOrJumpExercise,
  needsJointCare,
} from "@/lib/training";

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

export async function loadProgramFor(
  userId: string,
): Promise<{ program: ProgramRow | null; days: DayRow[] }> {
  const { data: program } = await supabase
    .from("training_programs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!program) return { program: null, days: [] };
  const { data: days } = await supabase
    .from("training_program_days")
    .select("*")
    .eq("program_id", program.id)
    .order("week_index")
    .order("day_index");
  return {
    program: {
      ...program,
      faq: (program.faq ?? []) as FaqItem[],
      equipment: program.equipment ?? [],
      program_weeks: (program as { program_weeks?: number }).program_weeks ?? 1,
    } as ProgramRow,
    days: (days ?? []).map((d) => ({
      id: d.id,
      program_id: d.program_id,
      week_index: (d as { week_index?: number }).week_index ?? 0,
      day_index: d.day_index,
      is_rest: d.is_rest,
      title: d.title,
      focus: d.focus,
      description: d.description,
      warmup: (d.warmup ?? []) as ExerciseSet[],
      exercises: (d.exercises ?? []) as ExerciseSet[],
      cooldown: (d.cooldown ?? []) as ExerciseSet[],
      day_note: d.day_note,
    })),
  };
}

export async function loadProgramProfile(userId: string) {
  const [onbRes, accessRes, weight_kg] = await Promise.all([
    supabase
      .from("onboarding_responses")
      .select(
        "activity_level, goal_primary, has_injuries, injuries_details, equipment, training_location, training_days_per_week",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("client_access").select("status").eq("user_id", userId).maybeSingle(),
    loadLatestWeightKg(userId),
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
    access_status: accessRes.data?.status ?? null,
  };
}

export async function createOrReplaceProgram(params: {
  userId: string;
  input: ProgramInput;
  exercises: Exercise[];
  preserveNotes?: string | null;
  preserveFaq?: FaqItem[] | null;
  targetsManual?: boolean;
}): Promise<{ program: ProgramRow; days: DayRow[] }> {
  const { userId, input, exercises, preserveNotes, preserveFaq, targetsManual } = params;

  const generatedDays = generateProgram(exercises, input);
  const faq = preserveFaq && preserveFaq.length > 0 ? preserveFaq : defaultFaq(input);

  const { data: existing } = await supabase
    .from("training_programs")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    sessions_per_week: input.sessions_per_week,
    goal: input.goal,
    level: input.level,
    has_injuries: input.has_injuries,
    injuries_details: input.injuries_details ?? null,
    equipment: input.equipment ?? [],
    location: input.location ?? null,
    notes: preserveNotes ?? null,
    faq: faq as unknown as never,
    targets_manual: targetsManual ?? false,
    program_weeks: 1,
    generated_at: new Date().toISOString(),
  };

  let programId: string;
  if (existing) {
    const { data, error } = await supabase
      .from("training_programs")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    programId = data.id;
  } else {
    const { data, error } = await supabase
      .from("training_programs")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    programId = data.id;
  }

  const { error: delErr } = await supabase
    .from("training_program_days")
    .delete()
    .eq("program_id", programId);
  if (delErr) throw delErr;

  const rows = generatedDays.map((d) => ({
    program_id: programId,
    week_index: 0,
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
  const { error: daysErr } = await supabase.from("training_program_days").insert(rows);
  if (daysErr) throw daysErr;

  return loadProgramFor(userId).then((r) => ({ program: r.program!, days: r.days }));
}

/** Заменить программу на кастомный мультинедельный план (напр. из таблицы тренера). */
export async function createOrReplaceCustomProgram(params: {
  userId: string;
  input: ProgramInput;
  days: ProgramDay[];
  programWeeks: number;
  preserveFaq?: FaqItem[] | null;
  notes?: string | null;
  targetsManual?: boolean;
}): Promise<{ program: ProgramRow; days: DayRow[] }> {
  const { userId, input, days, programWeeks, preserveFaq, notes, targetsManual } = params;
  const faq = preserveFaq && preserveFaq.length > 0 ? preserveFaq : defaultFaq(input);

  const { data: existing } = await supabase
    .from("training_programs")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    user_id: userId,
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
    program_weeks: programWeeks,
    generated_at: new Date().toISOString(),
  };

  let programId: string;
  if (existing) {
    const { data, error } = await supabase
      .from("training_programs")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    programId = data.id;
  } else {
    const { data, error } = await supabase
      .from("training_programs")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    programId = data.id;
  }

  const { error: delErr } = await supabase
    .from("training_program_days")
    .delete()
    .eq("program_id", programId);
  if (delErr) throw delErr;

  const rows = days.map((d) => ({
    program_id: programId,
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
  const { error: daysErr } = await supabase.from("training_program_days").insert(rows);
  if (daysErr) throw daysErr;

  return loadProgramFor(userId).then((r) => ({ program: r.program!, days: r.days }));
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
  const { data, error } = await supabase
    .from("training_program_days")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(dbPatch as any)
    .eq("program_id", programId)
    .eq("week_index", weekIndex)
    .eq("day_index", dayIndex)
    .select("id");
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
