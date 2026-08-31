import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server/assert-admin";
import { z } from "zod";
import {
  defaultFaq,
  type Exercise,
  type FaqItem,
  type ProgramDay,
  type ProgramInput,
} from "@/lib/training";
import { COACH_PROGRAM_WEEKS, resolveDefaultTrainingProgram } from "@/lib/coach-sheet-program";
import { persistProgramWithDaysForClient } from "@/lib/training-persist";

const programInputSchema = z.object({
  sessions_per_week: z.union([z.literal(3), z.literal(4)]),
  goal: z.enum(["weight_loss", "tone", "muscle_gain", "rehab", "maintain"]),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  has_injuries: z.boolean(),
  injuries_details: z.string().nullable().optional(),
  equipment: z.array(z.string()).optional(),
  location: z.string().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  gender: z.enum(["female", "male"]).nullable().optional(),
});

function mapDayRows(days: ProgramDay[]) {
  return days.map((d) => ({
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
}

async function resolveTrainingPlanAdmin(
  _supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  _clientId: string,
  _courseId: string | null,
  exercises: Exercise[],
  input: ProgramInput,
  mode: "fresh" | "continuation" = "fresh",
) {
  if (mode === "continuation") {
    try {
      const { resolveTrainingPlanForCourse } = await import(
        "@/lib/client-courses/seed-training-continuation"
      );
      return await resolveTrainingPlanForCourse({
        clientId: _clientId,
        courseId: _courseId,
        exercises,
        input,
      });
    } catch {
      // fallback ниже
    }
  }
  return resolveDefaultTrainingProgram(exercises, input);
}

/** Сгенерировать 4-недельный черновик на сервере (service role) и сохранить. */
export const adminRegenerateTrainingProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const schema = z.object({
      userId: z.string().uuid(),
      courseId: z.string().uuid().nullable().optional(),
      input: programInputSchema,
      notes: z.string().nullable().optional(),
      preserveFaq: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
      targetsManual: z.boolean().optional(),
      mode: z.enum(["fresh", "continuation"]).optional(),
    });
    return schema.parse(input);
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: exercises, error: exErr } = await supabaseAdmin.from("exercises").select("*");
    if (exErr) throw exErr;

    let resolvedCourseId = data.courseId ?? null;
    if (!resolvedCourseId) {
      const { data: courseId, error } = await supabaseAdmin.rpc(
        "resolve_client_course_id" as never,
        { p_client_id: data.userId, p_course_id: null } as never,
      );
      if (error && !/Could not find the function/i.test(error.message ?? "")) throw error;
      resolvedCourseId = (courseId as string | null) ?? null;
    }

    const input = data.input as ProgramInput;
    const plan = await resolveTrainingPlanAdmin(
      supabaseAdmin,
      data.userId,
      resolvedCourseId,
      (exercises ?? []) as Exercise[],
      input,
      data.mode ?? "fresh",
    );

    if (!plan.days.length) {
      throw new Error("Пустой план: нечего сохранять");
    }

    const faq =
      data.preserveFaq && data.preserveFaq.length > 0
        ? (data.preserveFaq as FaqItem[])
        : defaultFaq(input);

    const generatedAt = new Date().toISOString();
    const basePayload = {
      user_id: data.userId,
      ...(resolvedCourseId ? { course_id: resolvedCourseId } : {}),
      sessions_per_week: input.sessions_per_week,
      goal: input.goal,
      level: input.level,
      has_injuries: input.has_injuries,
      injuries_details: input.injuries_details ?? null,
      equipment: input.equipment ?? [],
      location: input.location ?? null,
      notes: data.notes ?? plan.coachNotes ?? null,
      faq: faq as unknown as never,
      targets_manual: data.targetsManual ?? true,
      generated_at: generatedAt,
    };

    const weeks = Math.max(1, plan.programWeeks || COACH_PROGRAM_WEEKS);
    const dayRows = mapDayRows(plan.days);
    const { programId, multiWeek } = await persistProgramWithDaysForClient(
      supabaseAdmin,
      data.userId,
      resolvedCourseId,
      basePayload,
      weeks,
      dayRows,
      { skipRpc: true, skipDraftRpc: true },
    );

    return {
      multiWeek,
      programWeeks: weeks,
      dayCount: plan.days.length,
      programId,
      generatedAt,
    };
  });

export const adminSaveTrainingProgramDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const schema = z.object({
      userId: z.string().uuid(),
      courseId: z.string().uuid().nullable().optional(),
      input: z.record(z.unknown()),
      days: z.array(z.record(z.unknown())),
      programWeeks: z.number().int().min(1).max(52),
      notes: z.string().nullable().optional(),
      preserveFaq: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
      targetsManual: z.boolean().optional(),
    });
    return schema.parse(input);
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!Array.isArray(data.days) || data.days.length === 0) {
      throw new Error("Пустой план: нечего сохранять");
    }

    let resolvedCourseId = data.courseId ?? null;
    if (!resolvedCourseId) {
      const { data: courseId, error } = await supabaseAdmin.rpc(
        "resolve_client_course_id" as never,
        { p_client_id: data.userId, p_course_id: null } as never,
      );
      if (error && !/Could not find the function/i.test(error.message ?? "")) throw error;
      resolvedCourseId = (courseId as string | null) ?? null;
    }

    const input = data.input as ProgramInput;
    const faq =
      data.preserveFaq && data.preserveFaq.length > 0
        ? (data.preserveFaq as FaqItem[])
        : defaultFaq(input);

    const basePayload = {
      user_id: data.userId,
      ...(resolvedCourseId ? { course_id: resolvedCourseId } : {}),
      sessions_per_week: input.sessions_per_week,
      goal: input.goal,
      level: input.level,
      has_injuries: input.has_injuries,
      injuries_details: input.injuries_details ?? null,
      equipment: input.equipment ?? [],
      location: input.location ?? null,
      notes: data.notes ?? null,
      faq: faq as unknown as never,
      targets_manual: data.targetsManual ?? true,
      generated_at: new Date().toISOString(),
    };

    const rows = (data.days as ProgramDay[]).map((d) => ({
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

    const weeks = Math.max(1, data.programWeeks || COACH_PROGRAM_WEEKS);
    const { multiWeek } = await persistProgramWithDaysForClient(
      supabaseAdmin,
      data.userId,
      resolvedCourseId,
      basePayload,
      weeks,
      rows,
      { skipRpc: true, skipDraftRpc: true },
    );

    return { multiWeek, programWeeks: weeks };
  });

export const adminPatchTrainingProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const schema = z.object({
      programId: z.string().uuid(),
      patch: z.object({
        notes: z.string().nullable().optional(),
        faq: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
        sessions_per_week: z.union([z.literal(3), z.literal(4)]).optional(),
        goal: z.string().optional(),
        level: z.string().optional(),
        targets_manual: z.boolean().optional(),
      }),
    });
    return schema.parse(input);
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dbPatch: Record<string, unknown> = { ...data.patch };
    if (dbPatch.faq != null) dbPatch.faq = dbPatch.faq as never;
    const { error } = await supabaseAdmin
      .from("training_programs")
      .update(dbPatch as never)
      .eq("id", data.programId);
    if (error) throw error;
    return { ok: true };
  });

export const adminPatchTrainingDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const schema = z.object({
      programId: z.string().uuid(),
      weekIndex: z.number().int().min(0),
      dayIndex: z.number().int().min(0).max(6),
      patch: z.object({
        title: z.string().optional(),
        focus: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        is_rest: z.boolean().optional(),
        warmup: z.array(z.unknown()).optional(),
        exercises: z.array(z.unknown()).optional(),
        cooldown: z.array(z.unknown()).optional(),
        day_note: z.string().nullable().optional(),
      }),
      lockManual: z.boolean().optional(),
    });
    return schema.parse(input);
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dbPatch: Record<string, unknown> = { ...data.patch };
    let query = supabaseAdmin
      .from("training_program_days")
      .update(dbPatch as never)
      .eq("program_id", data.programId)
      .eq("day_index", data.dayIndex)
      .eq("week_index", data.weekIndex);
    const { data: rows, error } = await query.select("id");
    if (error) throw error;
    if (!rows?.length) throw new Error("День программы не найден — изменения не сохранились");

    if (data.lockManual !== false) {
      const { error: lockErr } = await supabaseAdmin
        .from("training_programs")
        .update({ targets_manual: true })
        .eq("id", data.programId);
      if (lockErr) throw lockErr;
    }
    return { ok: true };
  });
