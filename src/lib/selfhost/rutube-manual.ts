import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { normalizeExerciseVideo, requireYoutubeOrRutubeUrl, type ExerciseVideo } from "@/lib/exercise-video";
import type { Exercise } from "@/lib/training";
import { resolveClientCourseIdPg } from "@/lib/selfhost/postgres-courses";
import {
  clientAllowsMaleWorkouts,
  isManualWorkoutCollection,
  type ManualCollection,
  type ManualWorkoutCollection,
} from "@/lib/selfhost/rutube-manual-shared";

export {
  clientAllowsMaleWorkouts,
  isManualWorkoutCollection,
  type ManualCollection,
  type ManualWorkoutCollection,
} from "@/lib/selfhost/rutube-manual-shared";

type Queryable = Pick<Pool | PoolClient, "query">;

export type ManualSection = "warmup" | "exercises" | "cooldown";
export type ManualScope = "workout" | "section" | "set";

export type ManualLibraryItem = {
  exerciseId: string;
  collection: ManualCollection;
  label: string;
  note: string | null;
  url: string;
  embedUrl: string;
};

type DayShape = {
  title: string;
  focus: string | null;
  description: string | null;
  is_rest: boolean;
  warmup: Array<Record<string, unknown>>;
  exercises: Array<Record<string, unknown>>;
  cooldown: Array<Record<string, unknown>>;
  day_note: string | null;
};

const DRAFT_ONLY = "Замена сохраняется только в черновик. Выданная версия не изменена.";

export function manualReplacementDay(
  day: DayShape,
  action: {
    scope: ManualScope;
    exerciseId: string;
    label: string;
    section?: ManualSection;
    setIndex?: number;
  },
): DayShape {
  const blockSet = (reps: string) => ({
    exercise_id: action.exerciseId,
    sets: 1,
    reps,
    rest_seconds: 0,
    tempo: null,
    note: null,
  });
  if (action.scope === "workout") {
    return {
      ...day,
      is_rest: false,
      title: action.label,
      focus: "Тренировка с RUTUBE",
      description: "Целая тренировка заменена в черновике. Выданная версия не изменилась.",
      warmup: [],
      exercises: [blockSet("тренировка")],
      cooldown: [],
    };
  }
  const section = action.section;
  if (!section) {
    throw Object.assign(new Error("Не указан блок для замены. Черновик не изменён."), {
      statusCode: 400,
    });
  }
  if (action.scope === "section") {
    return {
      ...day,
      is_rest: false,
      [section]: [blockSet("блок")],
    };
  }
  const current = [...(day[section] ?? [])];
  const index = action.setIndex;
  if (index == null || index < 0 || index >= current.length) {
    throw Object.assign(new Error("В черновике нет этого упражнения. Выданная версия не изменена."), {
      statusCode: 409,
    });
  }
  current[index] = { ...current[index], exercise_id: action.exerciseId };
  return { ...day, [section]: current };
}

export async function loadRutubeManualLibrary(db: Queryable): Promise<{
  workouts: ManualLibraryItem[];
  maleWorkouts: ManualLibraryItem[];
  pieces: ManualLibraryItem[];
}> {
  const { rows } = await db.query(
    `SELECT exercise_id, collection, label, note, source_url, embed_url
       FROM public.generator_rutube_manual
      ORDER BY collection, label`,
  );
  const workouts: ManualLibraryItem[] = [];
  const maleWorkouts: ManualLibraryItem[] = [];
  const pieces: ManualLibraryItem[] = [];
  for (const raw of rows as Array<{
    exercise_id: string;
    collection: ManualCollection;
    label: string;
    note: string | null;
    source_url: string;
    embed_url: string;
  }>) {
    const item: ManualLibraryItem = {
      exerciseId: raw.exercise_id,
      collection: raw.collection,
      label: raw.label,
      note: raw.note,
      url: raw.source_url,
      embedUrl: raw.embed_url,
    };
    if (item.collection === "workout") workouts.push(item);
    else if (item.collection === "workout_male") maleWorkouts.push(item);
    else pieces.push(item);
  }
  return { workouts, maleWorkouts, pieces };
}

async function setExerciseMaleWorkoutTag(
  db: Queryable,
  exerciseId: string,
  male: boolean,
): Promise<void> {
  if (male) {
    await db.query(
      `UPDATE public.exercises
          SET tags = (
                SELECT ARRAY(SELECT DISTINCT t FROM unnest(COALESCE(tags, '{}'::text[]) || ARRAY['trainer_male','rutube_workout']::text[]) AS t)
              ),
              updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1`,
      [exerciseId],
    );
    return;
  }
  await db.query(
    `UPDATE public.exercises
        SET tags = array_remove(COALESCE(tags, '{}'::text[]), 'trainer_male'),
            updated_at = (now() AT TIME ZONE 'utc')
      WHERE id = $1`,
    [exerciseId],
  );
}

export async function moveRutubeManualWorkoutPg(
  db: Queryable,
  input: { exerciseId: string; collection: ManualWorkoutCollection },
): Promise<ManualLibraryItem> {
  if (!isManualWorkoutCollection(input.collection)) {
    throw Object.assign(new Error("Можно переносить только между папками тренировок."), {
      statusCode: 400,
    });
  }
  const existing = await db.query(
    `SELECT exercise_id, collection, label, note, source_url, embed_url
       FROM public.generator_rutube_manual
      WHERE exercise_id = $1`,
    [input.exerciseId],
  );
  const row = existing.rows[0] as
    | {
        exercise_id: string;
        collection: ManualCollection;
        label: string;
        note: string | null;
        source_url: string;
        embed_url: string;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Ролика нет в подборке тренировок."), { statusCode: 404 });
  }
  if (!isManualWorkoutCollection(row.collection)) {
    throw Object.assign(new Error("Блоки и упражнения в эту папку не переносятся."), {
      statusCode: 400,
    });
  }
  await db.query(`UPDATE public.generator_rutube_manual SET collection = $2 WHERE exercise_id = $1`, [
    input.exerciseId,
    input.collection,
  ]);
  await setExerciseMaleWorkoutTag(db, input.exerciseId, input.collection === "workout_male");
  return {
    exerciseId: row.exercise_id,
    collection: input.collection,
    label: row.label,
    note: row.note,
    url: row.source_url,
    embedUrl: row.embed_url,
  };
}

export async function addRutubeManualWorkoutPg(
  db: Queryable,
  input: { label: string; url: string; collection?: ManualWorkoutCollection },
): Promise<ManualLibraryItem> {
  const collection = input.collection ?? "workout_male";
  if (!isManualWorkoutCollection(collection)) {
    throw Object.assign(new Error("Неизвестная папка тренировок."), { statusCode: 400 });
  }
  const label = input.label.trim();
  if (!label) {
    throw Object.assign(new Error("Укажите название тренировки."), { statusCode: 400 });
  }
  const video = requireYoutubeOrRutubeUrl(input.url);
  if (video.provider !== "rutube" || !video.url || !video.embed_url) {
    throw Object.assign(new Error("Нужна рабочая ссылка RUTUBE."), { statusCode: 400 });
  }
  const videoId = video.url.match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase() ?? "";
  if (!videoId) {
    throw Object.assign(new Error("Не удалось разобрать id ролика RUTUBE."), { statusCode: 400 });
  }

  const existing = await db.query(
    `SELECT exercise_id FROM public.generator_rutube_manual WHERE rutube_video_id = $1`,
    [videoId],
  );
  if (existing.rowCount) {
    const exerciseId = (existing.rows[0] as { exercise_id: string }).exercise_id;
    return moveRutubeManualWorkoutPg(db, { exerciseId, collection });
  }

  const bySlug = await db.query(`SELECT id FROM public.exercises WHERE slug = $1`, [
    `rutube-manual-${videoId}`,
  ]);
  let exerciseId = (bySlug.rows[0] as { id: string } | undefined)?.id;
  if (!exerciseId) {
    exerciseId = randomUUID();
    const tags =
      collection === "workout_male"
        ? ["rutube_workout", "trainer_male"]
        : ["rutube_workout"];
    await db.query(
      `INSERT INTO public.exercises
         (id, slug, name, category, difficulty, tags, description, is_active)
       VALUES ($1, $2, $3, 'strength_full', 'beginner', $4::text[], $5, true)`,
      [exerciseId, `rutube-manual-${videoId}`, label, tags, "Ручная подборка RUTUBE"],
    );
  } else {
    await db.query(
      `UPDATE public.exercises
          SET name = $2, updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1`,
      [exerciseId, label],
    );
    await setExerciseMaleWorkoutTag(db, exerciseId, collection === "workout_male");
  }

  await db.query(
    `INSERT INTO public.generator_rutube_manual
       (exercise_id, collection, label, note, rutube_video_id, source_url, embed_url)
     VALUES ($1, $2, $3, NULL, $4, $5, $6)
     ON CONFLICT (exercise_id) DO UPDATE
       SET collection = EXCLUDED.collection,
           label = EXCLUDED.label,
           rutube_video_id = EXCLUDED.rutube_video_id,
           source_url = EXCLUDED.source_url,
           embed_url = EXCLUDED.embed_url`,
    [exerciseId, collection, label, videoId, video.url, video.embed_url],
  );

  return {
    exerciseId,
    collection,
    label,
    note: null,
    url: video.url,
    embedUrl: video.embed_url,
  };
}

export async function loadManualMediaByExercise(
  db: Queryable,
  exerciseIds: string[],
): Promise<Map<string, { sourceUrl: string; embedUrl: string }>> {
  const map = new Map<string, { sourceUrl: string; embedUrl: string }>();
  if (!exerciseIds.length) return map;
  const { rows } = await db.query(
    `SELECT exercise_id, source_url, embed_url
       FROM public.generator_rutube_manual
      WHERE exercise_id = ANY($1::uuid[])`,
    [exerciseIds],
  );
  for (const row of rows as Array<{ exercise_id: string; source_url: string; embed_url: string }>) {
    map.set(row.exercise_id, { sourceUrl: row.source_url, embedUrl: row.embed_url });
  }
  return map;
}

export function overlayManualLibraryVideos(
  exercises: Exercise[],
  media: Map<string, { sourceUrl: string; embedUrl: string }>,
): Exercise[] {
  return exercises.map((exercise) => {
    const row = media.get(exercise.id);
    if (!row) return exercise;
    const video: ExerciseVideo = normalizeExerciseVideo({
      url: row.sourceUrl,
      title: exercise.name,
    });
    return { ...exercise, video_url: video.url, video };
  });
}

export async function applyRutubeManualReplacementPg(
  db: Pool,
  input: {
    clientId: string;
    programId: string;
    weekIndex: number;
    dayIndex: number;
    scope: ManualScope;
    itemId: string;
    section?: ManualSection;
    setIndex?: number;
  },
): Promise<{ ok: true }> {
  const { withTransaction } = await import("@/lib/selfhost/db");
  return withTransaction(async (client) => {
    const program = await client.query(
      `SELECT id, course_id FROM public.training_programs WHERE id = $1 AND user_id = $2`,
      [input.programId, input.clientId],
    );
    const owned = program.rows[0] as { id: string; course_id: string } | undefined;
    if (!owned) {
      throw Object.assign(new Error(`Это не черновик выбранной программы. ${DRAFT_ONLY}`), {
        statusCode: 409,
      });
    }
    const courseId = await resolveClientCourseIdPg(client, input.clientId, owned.course_id);
    if (courseId !== owned.course_id) {
      throw Object.assign(new Error(`Черновик не принадлежит этому клиенту. ${DRAFT_ONLY}`), {
        statusCode: 403,
      });
    }
    const item = await client.query(
      `SELECT exercise_id, collection, label
         FROM public.generator_rutube_manual
        WHERE exercise_id = $1`,
      [input.itemId],
    );
    const picked = item.rows[0] as
      | { exercise_id: string; collection: ManualCollection; label: string }
      | undefined;
    if (!picked) {
      throw Object.assign(new Error(`Этого ролика нет в подборке. ${DRAFT_ONLY}`), {
        statusCode: 404,
      });
    }
    if (input.scope === "workout" && !isManualWorkoutCollection(picked.collection)) {
      throw Object.assign(new Error("Для целой тренировки нужна подборка тренировок RUTUBE."), {
        statusCode: 400,
      });
    }
    if (input.scope === "workout" && picked.collection === "workout_male") {
      const genderRow = await client.query(`SELECT gender FROM public.profiles WHERE id = $1`, [
        input.clientId,
      ]);
      const gender = (genderRow.rows[0] as { gender?: string } | undefined)?.gender ?? null;
      if (!clientAllowsMaleWorkouts(gender as "female" | "male" | null)) {
        throw Object.assign(
          new Error(
            "Мужские тренировки не подставляются клиентам с женским полом или без пола в анкете.",
          ),
          { statusCode: 403 },
        );
      }
    }
    if (input.scope !== "workout" && picked.collection !== "piece") {
      throw Object.assign(new Error("Целая тренировка не подменяет отдельное упражнение."), {
        statusCode: 400,
      });
    }
    const dayRow = await client.query(
      `SELECT title, focus, description, is_rest, warmup, exercises, cooldown, day_note
         FROM public.training_program_days
        WHERE program_id = $1 AND week_index = $2 AND day_index = $3
        FOR UPDATE`,
      [input.programId, input.weekIndex, input.dayIndex],
    );
    const current = dayRow.rows[0] as DayShape | undefined;
    if (!current) {
      throw Object.assign(new Error("День черновика не найден. Выданная версия не изменена."), {
        statusCode: 404,
      });
    }
    const next = manualReplacementDay(current, {
      scope: input.scope,
      exerciseId: picked.exercise_id,
      label: picked.label,
      section: input.section,
      setIndex: input.setIndex,
    });
    await client.query(
      `UPDATE public.training_program_days
          SET title = $4,
              focus = $5,
              description = $6,
              is_rest = $7,
              warmup = $8::jsonb,
              exercises = $9::jsonb,
              cooldown = $10::jsonb,
              updated_at = (now() AT TIME ZONE 'utc')
        WHERE program_id = $1 AND week_index = $2 AND day_index = $3`,
      [
        input.programId,
        input.weekIndex,
        input.dayIndex,
        next.title,
        next.focus,
        next.description,
        next.is_rest,
        JSON.stringify(next.warmup),
        JSON.stringify(next.exercises),
        JSON.stringify(next.cooldown),
      ],
    );
    await client.query(
      `UPDATE public.training_programs
          SET targets_manual = true, updated_at = (now() AT TIME ZONE 'utc')
        WHERE id = $1`,
      [input.programId],
    );
    return { ok: true as const };
  });
}
