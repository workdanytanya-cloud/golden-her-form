import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DbClient = SupabaseClient<Database>;

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

function isMissingRpc(error: { message?: string }): boolean {
  return /function|schema cache|PGRST202|Could not find/i.test(error.message ?? "");
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

type SaveDraftRpcResult = {
  program_id: string;
  multi_week: boolean;
};

async function saveProgramDraftViaRpc(
  sb: DbClient,
  userId: string,
  courseId: string | null | undefined,
  payload: Record<string, unknown>,
  programWeeks: number,
  rows: Record<string, unknown>[],
): Promise<{ programId: string; multiWeek: boolean } | null> {
  const { data, error } = await sb.rpc("save_client_training_program_draft", {
    p_user_id: userId,
    p_course_id: courseId ?? null,
    p_program: payload as unknown as never,
    p_days: rows as unknown as never,
    p_program_weeks: programWeeks,
  });
  if (!error && data) {
    const parsed = data as SaveDraftRpcResult;
    if (parsed.program_id) {
      return { programId: parsed.program_id, multiWeek: Boolean(parsed.multi_week) };
    }
  }
  if (error && !isMissingRpc(error)) throw error;
  return null;
}

async function upsertTrainingProgram(
  sb: DbClient,
  existingId: string | null,
  payload: Record<string, unknown>,
  programWeeks: number,
): Promise<string> {
  const withWeeks = { ...payload, program_weeks: programWeeks };

  if (existingId) {
    const { data, error } = await sb
      .from("training_programs")
      .update(withWeeks as never)
      .eq("id", existingId)
      .select("id")
      .single();
    if (!error && data) return data.id;
    if (error && !isMissingSchemaColumn(error, "program_weeks")) throw error;

    const { data: legacy, error: legacyErr } = await sb
      .from("training_programs")
      .update(payload as never)
      .eq("id", existingId)
      .select("id")
      .single();
    if (legacyErr) throw legacyErr;
    return legacy.id;
  }

  const { data, error } = await sb
    .from("training_programs")
    .insert(withWeeks as never)
    .select("id")
    .single();
  if (!error && data) return data.id;
  if (error && !isMissingSchemaColumn(error, "program_weeks")) throw error;

  const { data: legacy, error: legacyErr } = await sb
    .from("training_programs")
    .insert(payload as never)
    .select("id")
    .single();
  if (legacyErr) throw legacyErr;
  return legacy.id;
}

async function replaceProgramDays(
  sb: DbClient,
  programId: string,
  rows: Record<string, unknown>[],
  options?: { skipRpc?: boolean },
): Promise<{ multiWeek: boolean }> {
  const needsMultiWeek = rows.some((r) => asWeekIndex(r.week_index) > 0);

  if (needsMultiWeek && !options?.skipRpc) {
    const { data: rpcCount, error: rpcErr } = await sb.rpc("replace_training_program_days", {
      p_program_id: programId,
      p_rows: rows as unknown as never,
    });
    if (!rpcErr && typeof rpcCount === "number") {
      return { multiWeek: true };
    }
  }

  const { error: delErr } = await sb
    .from("training_program_days")
    .delete()
    .eq("program_id", programId);
  if (delErr) throw delErr;

  if (needsMultiWeek) {
    const fullRows = rows.map((d) => dayInsertRow(programId, d, true));
    const { error } = await sb.from("training_program_days").insert(fullRows as never);
    if (!error) return { multiWeek: true };
    if (!isMissingSchemaColumn(error, "week_index")) throw error;

    const week0Rows = rows
      .filter((r) => asWeekIndex(r.week_index) === 0)
      .map((d) => dayInsertRow(programId, d, false));
    const { error: fallbackErr } = await sb.from("training_program_days").insert(week0Rows as never);
    if (fallbackErr) throw fallbackErr;
    return { multiWeek: false };
  }

  const legacyRows = rows.map((d) => dayInsertRow(programId, d, false));
  const { error: daysErr } = await sb.from("training_program_days").insert(legacyRows as never);
  if (daysErr) throw daysErr;
  return { multiWeek: false };
}

/** Сохранить черновик программы и дни. Service role обходит RLS recursion. */
export async function persistProgramWithDaysForClient(
  sb: DbClient,
  userId: string,
  courseId: string | null | undefined,
  payload: Record<string, unknown>,
  programWeeks: number,
  rows: Record<string, unknown>[],
  options?: { skipRpc?: boolean; skipDraftRpc?: boolean },
): Promise<{ programId: string; multiWeek: boolean }> {
  if (!options?.skipDraftRpc) {
    const rpcResult = await saveProgramDraftViaRpc(sb, userId, courseId, payload, programWeeks, rows);
    if (rpcResult) return rpcResult;
  }

  let existingQuery = sb.from("training_programs").select("id").eq("user_id", userId);
  if (courseId) {
    existingQuery = existingQuery.eq("course_id", courseId);
  } else {
    existingQuery = existingQuery.is("course_id", null);
  }
  const existingRes = await existingQuery.limit(1);
  let existing = existingRes.data?.[0] ?? null;

  // Старая схема: одна строка на user_id без course_id — обновляем её.
  if (!existing?.id) {
    const legacy = await sb
      .from("training_programs")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    existing = legacy.data?.[0] ?? null;
  }

  const programId = await upsertTrainingProgram(sb, existing?.id ?? null, payload, programWeeks);
  const { multiWeek } = await replaceProgramDays(sb, programId, rows, options);

  const { count, error: countErr } = await sb
    .from("training_program_days")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  if (countErr) throw countErr;
  if ((count ?? 0) < rows.length) {
    throw new Error(
      `Дни программы не сохранились полностью (${count ?? 0} из ${rows.length}). Проверьте миграции week_index в Supabase.`,
    );
  }

  return { programId, multiWeek };
}
