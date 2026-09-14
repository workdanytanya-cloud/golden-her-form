import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import {
  buildTrainingSnapshot,
  trainingSnapshotHash,
} from "@/lib/published-programs/training-snapshot";
import { withTransaction } from "@/lib/selfhost/db";
import { resolveClientCourseIdPg } from "@/lib/selfhost/postgres-courses";
import type { DayRow, ProgramRow } from "@/lib/training-repo";
import type { Exercise, ExerciseSet, FaqItem, ProgramDay, ProgramInput } from "@/lib/training";

type Queryable = Pool | PoolClient;

const exerciseSetSchema = z.object({
  exercise_id: z.string().uuid(),
  sets: z.number().int().min(0).max(50),
  reps: z.string().max(80),
  rest_seconds: z.number().int().min(0).max(600).nullable().optional(),
  tempo: z.string().max(40).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const trainingDaySchema = z.object({
  week_index: z.number().int().min(0).max(11).default(0),
  day_index: z.number().int().min(0).max(6),
  is_rest: z.boolean().default(false),
  title: z.string().max(200).default(""),
  focus: z.string().max(400).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  warmup: z.array(exerciseSetSchema).default([]),
  exercises: z.array(exerciseSetSchema).default([]),
  cooldown: z.array(exerciseSetSchema).default([]),
  day_note: z.string().max(2000).nullable().optional(),
});

export const trainingPublishSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
  idempotencyKey: z.string().min(8).max(200).optional().nullable(),
});

export const trainingDraftSaveSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  sessions_per_week: z.union([z.literal(3), z.literal(4)]),
  goal: z.string().max(80).nullable().optional(),
  level: z.string().max(40).default("beginner"),
  has_injuries: z.boolean().default(false),
  injuries_details: z.string().max(4000).nullable().optional(),
  equipment: z.array(z.string().max(80)).default([]),
  location: z.string().max(80).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  faq: z.array(z.record(z.string(), z.unknown())).default([]),
  targets_manual: z.boolean().default(true),
  program_weeks: z.number().int().min(1).max(12).default(1),
  days: z.array(trainingDaySchema).default([]),
});

export const trainingDayPatchSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid(),
  weekIndex: z.number().int().min(0).max(11),
  dayIndex: z.number().int().min(0).max(6),
  patch: z.object({
    title: z.string().max(200).optional(),
    focus: z.string().max(400).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    is_rest: z.boolean().optional(),
    warmup: z.array(exerciseSetSchema).optional(),
    exercises: z.array(exerciseSetSchema).optional(),
    cooldown: z.array(exerciseSetSchema).optional(),
    day_note: z.string().max(2000).nullable().optional(),
  }),
});

export const trainingProgramPatchSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid(),
  patch: z.object({
    notes: z.string().max(8000).nullable().optional(),
    faq: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    sessions_per_week: z.union([z.literal(3), z.literal(4)]).optional(),
    goal: z.string().max(80).nullable().optional(),
    level: z.string().max(40).optional(),
    targets_manual: z.boolean().optional(),
    program_weeks: z.number().int().min(1).max(12).optional(),
  }),
});

function mapProgramRow(row: Record<string, unknown>): ProgramRow {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    sessions_per_week: Number(row.sessions_per_week),
    goal: (row.goal as string | null) ?? null,
    level: String(row.level ?? "beginner"),
    has_injuries: Boolean(row.has_injuries),
    injuries_details: (row.injuries_details as string | null) ?? null,
    equipment: (row.equipment as string[] | null) ?? [],
    location: (row.location as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    faq: (row.faq as FaqItem[] | null) ?? [],
    targets_manual: Boolean(row.targets_manual),
    program_weeks: Number(row.program_weeks ?? 1),
    generated_at: row.generated_at
      ? new Date(row.generated_at as string | Date).toISOString()
      : undefined,
  };
}

function mapDayRow(row: Record<string, unknown>): DayRow {
  return {
    id: row.id as string,
    program_id: row.program_id as string,
    week_index: Number(row.week_index ?? 0),
    day_index: Number(row.day_index),
    is_rest: Boolean(row.is_rest),
    title: String(row.title ?? ""),
    focus: (row.focus as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    warmup: (row.warmup as ExerciseSet[] | null) ?? [],
    exercises: (row.exercises as ExerciseSet[] | null) ?? [],
    cooldown: (row.cooldown as ExerciseSet[] | null) ?? [],
    day_note: (row.day_note as string | null) ?? null,
  };
}

function collectExerciseIds(days: Array<{ warmup: ExerciseSet[]; exercises: ExerciseSet[]; cooldown: ExerciseSet[] }>) {
  const ids = new Set<string>();
  for (const day of days) {
    for (const set of [...day.warmup, ...day.exercises, ...day.cooldown]) {
      if (set.exercise_id) ids.add(set.exercise_id);
    }
  }
  return [...ids];
}

export async function listTrainingExercisesPg(db: Queryable): Promise<Exercise[]> {
  const { rows } = await db.query(
    `SELECT e.*,
            b.provider AS bind_provider,
            b.source_url AS bind_source_url,
            b.embed_url AS bind_embed_url,
            b.title AS bind_title,
            b.status AS bind_status,
            b.fallback_text AS bind_fallback
       FROM public.exercises e
       LEFT JOIN public.exercise_media_bindings b ON b.exercise_id = e.id
      WHERE e.is_active = true AND e.archived_at IS NULL
      ORDER BY e.name`,
  );
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const video = normalizeExerciseVideo({
      video_url: (r.bind_source_url as string | null) ?? (r.video_url as string | null),
      video: {
        provider: (r.bind_provider as string | null) ?? (r.video_provider as string | null),
        url: (r.bind_source_url as string | null) ?? (r.video_url as string | null),
        embed_url: (r.bind_embed_url as string | null) ?? (r.video_embed_url as string | null),
        title: (r.bind_title as string | null) ?? (r.video_title as string | null),
        status: (r.bind_status as string | null) ?? (r.video_status as string | null),
        fallback_text:
          (r.bind_fallback as string | null) ?? (r.video_fallback_text as string | null),
      },
    });
    return {
      id: r.id as string,
      slug: r.slug as string,
      name: r.name as string,
      category: r.category as Exercise["category"],
      muscle_groups: (r.muscle_groups as string[]) ?? [],
      equipment: (r.equipment as string[]) ?? [],
      difficulty: r.difficulty as Exercise["difficulty"],
      tags: (r.tags as string[]) ?? [],
      description: (r.description as string | null) ?? null,
      cues: (r.cues as string[]) ?? [],
      common_mistakes: (r.common_mistakes as string[]) ?? [],
      gif_url: (r.gif_url as string | null) ?? null,
      video_url: video.url,
      video,
      default_sets: Number(r.default_sets ?? 3),
      default_reps: String(r.default_reps ?? "10-12"),
      tempo: (r.tempo as string | null) ?? null,
      rest_seconds: Number(r.rest_seconds ?? 60),
    } satisfies Exercise;
  });
}

async function assertExercisesExist(db: Queryable, ids: string[]) {
  if (!ids.length) return;
  const { rows } = await db.query(
    `SELECT id FROM public.exercises
      WHERE id = ANY($1::uuid[]) AND is_active = true AND archived_at IS NULL`,
    [ids],
  );
  const found = new Set(rows.map((r) => (r as { id: string }).id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw Object.assign(
      new Error(`В черновике есть неизвестные или архивные упражнения (${missing.length})`),
      { statusCode: 400 },
    );
  }
}

async function assertProgramOwned(
  db: Queryable,
  programId: string,
  clientId: string,
  courseId: string,
) {
  const { rows } = await db.query(
    `SELECT id FROM public.training_programs
      WHERE id = $1 AND user_id = $2 AND course_id = $3`,
    [programId, clientId, courseId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Черновик тренировок не принадлежит этому курсу"), {
      statusCode: 403,
    });
  }
}

export async function loadTrainingDraftPg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<{ program: ProgramRow | null; days: DayRow[] }> {
  const resolved = await resolveClientCourseIdPg(db, clientId, courseId);
  if (!resolved) return { program: null, days: [] };
  const { rows } = await db.query(
    `SELECT * FROM public.training_programs WHERE user_id = $1 AND course_id = $2`,
    [clientId, resolved],
  );
  const programRaw = rows[0] as Record<string, unknown> | undefined;
  if (!programRaw) return { program: null, days: [] };
  const program = mapProgramRow(programRaw);
  const daysRes = await db.query(
    `SELECT * FROM public.training_program_days
      WHERE program_id = $1
      ORDER BY week_index, day_index`,
    [program.id],
  );
  return {
    program,
    days: daysRes.rows.map((r) => mapDayRow(r as Record<string, unknown>)),
  };
}

export async function loadTrainingProfilePg(
  db: Queryable,
  clientId: string,
): Promise<{
  sessions_per_week: 3 | 4;
  goal: ProgramInput["goal"];
  level: ProgramInput["level"];
  has_injuries: boolean;
  injuries_details: string | null;
  equipment: string[];
  location: string | null;
  weight_kg: number | null;
  gender: "female" | "male" | null;
  access_status: string | null;
}> {
  const [onb, access, weight, profile] = await Promise.all([
    db.query(
      `SELECT activity_level, goal_primary, has_injuries, injuries_details, equipment,
              training_location, training_days_per_week
         FROM public.onboarding_responses WHERE user_id = $1`,
      [clientId],
    ),
    db.query(`SELECT status FROM public.client_access WHERE user_id = $1`, [clientId]),
    db.query(
      `SELECT weight_kg FROM public.measurements
        WHERE user_id = $1 AND weight_kg IS NOT NULL
        ORDER BY measured_on DESC, created_at DESC LIMIT 1`,
      [clientId],
    ),
    db.query(`SELECT gender FROM public.profiles WHERE id = $1`, [clientId]),
  ]);
  const o = onb.rows[0] as
    | {
        activity_level?: string | null;
        goal_primary?: string | null;
        has_injuries?: boolean;
        injuries_details?: string | null;
        equipment?: string[] | null;
        training_location?: string | null;
        training_days_per_week?: number | null;
      }
    | undefined;
  const rawSessions = Number(o?.training_days_per_week ?? 3);
  const goalRaw = (o?.goal_primary ?? "maintain").toLowerCase();
  const goalMap: Record<string, ProgramInput["goal"]> = {
    weight_loss: "weight_loss",
    lose_weight: "weight_loss",
    tone: "tone",
    muscle_gain: "muscle_gain",
    rehab: "rehab",
    maintain: "maintain",
  };
  const levelRaw = (o?.activity_level ?? "beginner").toLowerCase();
  const levelMap: Record<string, ProgramInput["level"]> = {
    beginner: "beginner",
    intermediate: "intermediate",
    advanced: "advanced",
    low: "beginner",
    moderate: "intermediate",
    high: "advanced",
  };
  return {
    sessions_per_week: rawSessions >= 4 ? 4 : 3,
    goal: goalMap[goalRaw] ?? "maintain",
    level: levelMap[levelRaw] ?? "beginner",
    has_injuries: Boolean(o?.has_injuries),
    injuries_details: o?.injuries_details ?? null,
    equipment: o?.equipment ?? [],
    location: o?.training_location ?? null,
    weight_kg:
      (weight.rows[0] as { weight_kg?: number | string } | undefined)?.weight_kg != null
        ? Number((weight.rows[0] as { weight_kg: number | string }).weight_kg)
        : null,
    gender:
      ((profile.rows[0] as { gender?: string } | undefined)?.gender as "female" | "male" | null) ??
      null,
    access_status:
      ((access.rows[0] as { status?: string } | undefined)?.status as string | null) ?? null,
  };
}

export async function saveTrainingDraftPg(
  db: Pool,
  input: z.infer<typeof trainingDraftSaveSchema>,
): Promise<{ program: ProgramRow; days: DayRow[] }> {
  const parsedDays = input.days.map((d) => trainingDaySchema.parse(d));
  await assertExercisesExist(db, collectExerciseIds(parsedDays));

  return withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    if (!courseId) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    const ownedCourse = await client.query(
      `SELECT id FROM public.client_courses WHERE id = $1 AND client_id = $2`,
      [courseId, input.clientId],
    );
    if (!ownedCourse.rowCount) {
      throw Object.assign(new Error("Курс не принадлежит клиенту"), { statusCode: 403 });
    }

    const existing = await client.query(
      `SELECT id FROM public.training_programs WHERE user_id = $1 AND course_id = $2`,
      [input.clientId, courseId],
    );
    let programId: string;
    if (existing.rows[0]) {
      programId = (existing.rows[0] as { id: string }).id;
      await client.query(
        `UPDATE public.training_programs SET
           sessions_per_week=$3, goal=$4, level=$5, has_injuries=$6, injuries_details=$7,
           equipment=$8::text[], location=$9, notes=$10, faq=$11::jsonb, targets_manual=$12,
           program_weeks=$13, generated_at=(now() AT TIME ZONE 'utc'),
           updated_at=(now() AT TIME ZONE 'utc')
         WHERE id=$1 AND user_id=$2 AND course_id=$14`,
        [
          programId,
          input.clientId,
          input.sessions_per_week,
          input.goal ?? null,
          input.level,
          input.has_injuries,
          input.injuries_details ?? null,
          input.equipment,
          input.location ?? null,
          input.notes ?? null,
          JSON.stringify(input.faq ?? []),
          input.targets_manual,
          input.program_weeks,
          courseId,
        ],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO public.training_programs (
           user_id, course_id, sessions_per_week, goal, level, has_injuries, injuries_details,
           equipment, location, notes, faq, targets_manual, program_weeks
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11::jsonb,$12,$13)
         RETURNING id`,
        [
          input.clientId,
          courseId,
          input.sessions_per_week,
          input.goal ?? null,
          input.level,
          input.has_injuries,
          input.injuries_details ?? null,
          input.equipment,
          input.location ?? null,
          input.notes ?? null,
          JSON.stringify(input.faq ?? []),
          input.targets_manual,
          input.program_weeks,
        ],
      );
      programId = (inserted.rows[0] as { id: string }).id;
    }

    await client.query(`DELETE FROM public.training_program_days WHERE program_id = $1`, [
      programId,
    ]);
    for (const day of parsedDays) {
      await client.query(
        `INSERT INTO public.training_program_days (
           program_id, week_index, day_index, is_rest, title, focus, description,
           warmup, exercises, cooldown, day_note
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
        [
          programId,
          day.week_index,
          day.day_index,
          day.is_rest,
          day.title,
          day.focus ?? null,
          day.description ?? null,
          JSON.stringify(day.warmup),
          JSON.stringify(day.exercises),
          JSON.stringify(day.cooldown),
          day.day_note ?? null,
        ],
      );
    }
    const loaded = await loadTrainingDraftPg(client, input.clientId, courseId);
    if (!loaded.program) {
      throw Object.assign(new Error("Не удалось сохранить черновик тренировок"), { statusCode: 500 });
    }
    return { program: loaded.program, days: loaded.days };
  });
}

export async function patchTrainingDayPg(
  db: Pool,
  input: z.infer<typeof trainingDayPatchSchema>,
): Promise<{ ok: true }> {
  const sets = [
    ...(input.patch.warmup ?? []),
    ...(input.patch.exercises ?? []),
    ...(input.patch.cooldown ?? []),
  ];
  if (sets.length) {
    await assertExercisesExist(db, [...new Set(sets.map((s) => s.exercise_id))]);
  }

  return withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    if (!courseId) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    await assertProgramOwned(client, input.programId, input.clientId, courseId);

    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };
    if (input.patch.title !== undefined) push("title", input.patch.title);
    if (input.patch.focus !== undefined) push("focus", input.patch.focus);
    if (input.patch.description !== undefined) push("description", input.patch.description);
    if (input.patch.is_rest !== undefined) push("is_rest", input.patch.is_rest);
    if (input.patch.warmup !== undefined) push("warmup", JSON.stringify(input.patch.warmup));
    if (input.patch.exercises !== undefined)
      push("exercises", JSON.stringify(input.patch.exercises));
    if (input.patch.cooldown !== undefined) push("cooldown", JSON.stringify(input.patch.cooldown));
    if (input.patch.day_note !== undefined) push("day_note", input.patch.day_note);
    if (!fields.length) return { ok: true as const };

    values.push(input.programId, input.weekIndex, input.dayIndex);
    const updated = await client.query(
      `UPDATE public.training_program_days
          SET ${fields.join(", ")}, updated_at = (now() AT TIME ZONE 'utc')
        WHERE program_id = $${values.length - 2}
          AND week_index = $${values.length - 1}
          AND day_index = $${values.length}
        RETURNING id`,
      values,
    );
    if (!updated.rowCount) {
      throw Object.assign(new Error("День программы не найден — изменения не сохранились"), {
        statusCode: 404,
      });
    }
    await client.query(
      `UPDATE public.training_programs
          SET targets_manual = true, updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1`,
      [input.programId],
    );
    return { ok: true as const };
  });
}

export async function patchTrainingProgramPg(
  db: Pool,
  input: z.infer<typeof trainingProgramPatchSchema>,
): Promise<{ ok: true }> {
  return withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    if (!courseId) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    await assertProgramOwned(client, input.programId, input.clientId, courseId);

    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      fields.push(`${col} = $${values.length}`);
    };
    if (input.patch.notes !== undefined) push("notes", input.patch.notes);
    if (input.patch.faq !== undefined) push("faq", JSON.stringify(input.patch.faq ?? []));
    if (input.patch.sessions_per_week !== undefined)
      push("sessions_per_week", input.patch.sessions_per_week);
    if (input.patch.goal !== undefined) push("goal", input.patch.goal);
    if (input.patch.level !== undefined) push("level", input.patch.level);
    if (input.patch.targets_manual !== undefined) push("targets_manual", input.patch.targets_manual);
    if (input.patch.program_weeks !== undefined) push("program_weeks", input.patch.program_weeks);
    if (!fields.length) return { ok: true as const };

    values.push(input.programId);
    await client.query(
      `UPDATE public.training_programs
          SET ${fields.join(", ")}, updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $${values.length}`,
      values,
    );
    return { ok: true as const };
  });
}

export async function publishTrainingVersionPg(
  db: Pool,
  input: {
    clientId: string;
    courseId?: string | null;
    actorId: string;
    reason?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<{ versionId: string; contentHash: string; idempotent: boolean }> {
  return withTransaction(async (client) => {
    const courseId = await resolveClientCourseIdPg(client, input.clientId, input.courseId);
    if (!courseId) throw Object.assign(new Error("Курс не найден"), { statusCode: 400 });
    await client.query(`SELECT id FROM public.client_courses WHERE id = $1 FOR UPDATE`, [courseId]);

    const owned = await client.query(
      `SELECT id FROM public.training_programs WHERE user_id = $1 AND course_id = $2`,
      [input.clientId, courseId],
    );
    if (!owned.rowCount) {
      throw Object.assign(new Error("Черновик тренировок не принадлежит этому курсу"), {
        statusCode: 403,
      });
    }

    const draft = await loadTrainingDraftPg(client, input.clientId, courseId);
    if (!draft.program || draft.days.length === 0) {
      throw Object.assign(new Error("Нельзя опубликовать пустой черновик тренировок"), {
        statusCode: 400,
      });
    }
    await assertExercisesExist(client, collectExerciseIds(draft.days));

    const exercises = await listTrainingExercisesPg(client);
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const needed = collectExerciseIds(draft.days);
    const freezeList = needed.map((id) => byId.get(id)).filter(Boolean) as Exercise[];

    const programDays: ProgramDay[] = draft.days.map((d) => ({
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
      sessions_per_week: draft.program.sessions_per_week,
      goal: draft.program.goal,
      level: draft.program.level,
      has_injuries: draft.program.has_injuries,
      injuries_details: draft.program.injuries_details,
      equipment: draft.program.equipment,
      location: draft.program.location,
      notes: draft.program.notes,
      faq: draft.program.faq,
      program_weeks: draft.program.program_weeks,
      days: programDays,
      exercises: freezeList,
    });
    const hash = trainingSnapshotHash(snapshot);

    if (input.idempotencyKey) {
      const prior = await client.query(
        `SELECT i.version_id, v.content_hash
           FROM public.training_publish_idempotency i
           JOIN public.training_program_versions v ON v.id = i.version_id
          WHERE i.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0] as { version_id: string; content_hash: string };
        if (row.content_hash !== hash) {
          throw Object.assign(
            new Error("Idempotency key уже использован с другим содержимым публикации"),
            { statusCode: 409 },
          );
        }
        return {
          versionId: row.version_id,
          contentHash: row.content_hash,
          idempotent: true,
        };
      }
    }

    const prev = await client.query(
      `SELECT a.active_version_id, v.version
         FROM public.client_program_assignments a
         JOIN public.training_program_versions v ON v.id = a.active_version_id
        WHERE a.course_id = $1 AND a.kind = 'training'
        FOR UPDATE OF a`,
      [courseId],
    );
    const prevId =
      (prev.rows[0] as { active_version_id?: string } | undefined)?.active_version_id ?? null;
    const prevVer = (prev.rows[0] as { version?: number } | undefined)?.version ?? 0;
    const max = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS n FROM public.training_program_versions WHERE client_id = $1`,
      [input.clientId],
    );
    const newVer = prevId
      ? Math.max(prevVer + 1, Number((max.rows[0] as { n: number }).n))
      : Number((max.rows[0] as { n: number }).n);

    if (prevId) {
      await client.query(
        `UPDATE public.training_program_versions
            SET status = 'superseded'
          WHERE id = $1 AND status = 'published'`,
        [prevId],
      );
    }

    const inserted = await client.query(
      `INSERT INTO public.training_program_versions (
         client_id, course_id, version, status, snapshot, content_hash,
         parent_version_id, created_by, published_at, published_by
       ) VALUES ($1,$2,$3,'published',$4::jsonb,$5,$6,$7,(now() AT TIME ZONE 'utc'),$7)
       RETURNING id`,
      [input.clientId, courseId, newVer, JSON.stringify(snapshot), hash, prevId, input.actorId],
    );
    const versionId = (inserted.rows[0] as { id: string }).id;

    await client.query(
      `INSERT INTO public.client_program_assignments (client_id, course_id, kind, active_version_id, updated_by)
       VALUES ($1,$2,'training',$3,$4)
       ON CONFLICT (client_id, kind, course_id) DO UPDATE SET
         active_version_id = EXCLUDED.active_version_id,
         updated_at = (now() AT TIME ZONE 'utc'),
         updated_by = EXCLUDED.updated_by`,
      [input.clientId, courseId, versionId, input.actorId],
    );
    await client.query(
      `INSERT INTO public.program_change_log (client_id, kind, action, actor_id, from_version_id, to_version_id, diff)
       VALUES ($1,'training','publish',$2,$3,$4,$5::jsonb)`,
      [
        input.clientId,
        input.actorId,
        prevId,
        versionId,
        JSON.stringify({ reason: input.reason ?? null, content_hash: hash, course_id: courseId }),
      ],
    );
    await client.query(
      `INSERT INTO public.client_notifications (user_id, type, message, link)
       VALUES ($1,'training_published',$2,'/dashboard/training')`,
      [input.clientId, "Тренер обновил вашу программу тренировок"],
    );
    if (input.idempotencyKey) {
      await client.query(
        `INSERT INTO public.training_publish_idempotency (idempotency_key, client_id, course_id, version_id)
         VALUES ($1,$2,$3,$4)`,
        [input.idempotencyKey, input.clientId, courseId, versionId],
      );
    }
    return { versionId, contentHash: hash, idempotent: false };
  });
}
