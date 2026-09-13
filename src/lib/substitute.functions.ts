import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server/assert-admin";
import { buildClientProfile } from "@/lib/personalization/client-profile";
import { suggestExerciseSubstitutes, type SubstituteReason } from "@/lib/personalization/substitute-engine";
import type { Exercise, ExerciseSet } from "@/lib/training";

const reasonSchema = z.enum(["too_hard", "discomfort", "equipment", "preference"]);

const suggestInputSchema = z.object({
  userId: z.string().uuid().optional(),
  exerciseId: z.string().uuid(),
  reason: reasonSchema.default("too_hard"),
  limit: z.number().int().min(1).max(5).optional(),
});

const applyInputSchema = z.object({
  userId: z.string().uuid().optional(),
  weekIndex: z.number().int().min(0).default(0),
  dayIndex: z.number().int().min(0).max(6),
  section: z.enum(["warmup", "exercises", "cooldown"]),
  setIndex: z.number().int().min(0),
  newExerciseId: z.string().uuid(),
});

async function resolveTargetUserId(
  context: { userId: string; supabase: Parameters<typeof assertAdmin>[0]["supabase"] },
  requested?: string,
): Promise<string> {
  if (!requested || requested === context.userId) return context.userId;
  await assertAdmin(context);
  return requested;
}

function mapExercise(row: Record<string, unknown>): Exercise {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    category: row.category as Exercise["category"],
    muscle_groups: (row.muscle_groups as string[]) ?? [],
    equipment: (row.equipment as string[]) ?? [],
    difficulty: row.difficulty as Exercise["difficulty"],
    tags: (row.tags as string[]) ?? [],
    description: (row.description as string) ?? null,
    cues: (row.cues as string[]) ?? [],
    common_mistakes: (row.common_mistakes as string[]) ?? [],
    gif_url: (row.gif_url as string) ?? null,
    video_url: (row.video_url as string) ?? null,
    default_sets: Number(row.default_sets ?? 3),
    default_reps: String(row.default_reps ?? "10-12"),
    tempo: (row.tempo as string) ?? null,
    rest_seconds: Number(row.rest_seconds ?? 60),
  };
}

async function loadProfileForUser(supabase: { from: Function }, userId: string) {
  const { data: onb } = await supabase
    .from("onboarding_responses")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: prof } = await supabase
    .from("profiles")
    .select("gender, birth_date, height_cm")
    .eq("id", userId)
    .maybeSingle();

  const { data: meas } = await supabase
    .from("measurements")
    .select("weight_kg")
    .eq("user_id", userId)
    .not("weight_kg", "is", null)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!onb) {
    return buildClientProfile(
      { user_id: userId, equipment: [], focus_areas: [] },
      {
        gender: (prof?.gender as "female" | "male") ?? null,
        birth_date: prof?.birth_date ?? null,
        height_cm: prof?.height_cm ?? null,
        weight_kg: meas?.weight_kg != null ? Number(meas.weight_kg) : null,
      },
    );
  }

  return buildClientProfile(
    { user_id: userId, ...(onb as object) },
    {
      gender: (prof?.gender as "female" | "male") ?? null,
      birth_date: prof?.birth_date ?? null,
      height_cm: prof?.height_cm ?? null,
      weight_kg: meas?.weight_kg != null ? Number(meas.weight_kg) : null,
    },
  );
}

export const suggestExerciseSubstitutesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => suggestInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const targetUserId = await resolveTargetUserId(context, data.userId);

    const { data: exerciseRow, error: exErr } = await context.supabase
      .from("exercises")
      .select("*")
      .eq("id", data.exerciseId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (!exerciseRow) throw new Error("Упражнение не найдено в базе");

    const { data: catalogRows, error: catErr } = await context.supabase
      .from("exercises")
      .select("*")
      .order("name");
    if (catErr) throw new Error(catErr.message);

    const catalog = (catalogRows ?? []).map((r) => mapExercise(r as Record<string, unknown>));
    const current = mapExercise(exerciseRow as Record<string, unknown>);
    const profile = await loadProfileForUser(context.supabase, targetUserId);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const llm = apiKey
      ? {
          apiKey,
          model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
          baseUrl: process.env.OPENAI_API_BASE?.trim(),
        }
      : null;

    const result = await suggestExerciseSubstitutes({
      current,
      catalog,
      profile,
      reason: data.reason as SubstituteReason,
      llm,
      limit: data.limit ?? 3,
    });

    return {
      ...result,
      from_exercise: { id: current.id, name: current.name },
    };
  });

export const applyExerciseSubstituteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => applyInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const targetUserId = await resolveTargetUserId(context, data.userId);

    const { data: program, error: pErr } = await context.supabase
      .from("training_programs")
      .select("id, targets_manual")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!program) throw new Error("Программа не найдена");
    if (program.targets_manual) {
      throw new Error("Программа закреплена тренером — замену нужно сделать вручную");
    }

    const { data: newEx, error: nErr } = await context.supabase
      .from("exercises")
      .select("id, tempo")
      .eq("id", data.newExerciseId)
      .maybeSingle();
    if (nErr) throw new Error(nErr.message);
    if (!newEx) throw new Error("Новое упражнение не найдено в базе");

    const { data: dayRow, error: dErr } = await context.supabase
      .from("training_program_days")
      .select("id, warmup, exercises, cooldown")
      .eq("program_id", program.id)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dayRow) throw new Error("День программы не найден");

    const block = [...((dayRow[data.section] as ExerciseSet[]) ?? [])];
    const target = block[data.setIndex];
    if (!target) throw new Error("Сет не найден");

    block[data.setIndex] = {
      ...target,
      exercise_id: data.newExerciseId,
      tempo: newEx.tempo ?? target.tempo,
      note: target.note ?? "Замена по рекомендации системы",
    };

    const { error: uErr } = await context.supabase
      .from("training_program_days")
      .update({ [data.section]: block as unknown as never })
      .eq("id", dayRow.id);
    if (uErr) throw new Error(uErr.message);

    return { ok: true };
  });
