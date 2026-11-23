/**
 * Заполняет ручную подборку из локальных файлов. Ссылки в консоль и в Git не пишет.
 * Существующие карточки каталога не изменяет.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { normalizeExerciseVideo } from "../../src/lib/exercise-video";
import { applyMigrations } from "../../src/lib/selfhost/migrate";

const WORKOUT_TITLES = new Set([
  "Мини тренировка на все тело",
  "Тренировка 1",
  "Тренировка 2",
  "Тренировка 3",
  "Тренировка",
  "Тренировка круговая_2",
  "Тренировка сентябрь_5",
  "Тренировка круговая _1",
  "Тренировка круговая _3",
  "Тренировка в подъезде",
]);

const BLOCKS = [
  { title: "Разминка", label: "Разминка — версия 1", category: "warmup", note: "Мобильность, без активации" },
  { title: "Разминка_", label: "Разминка — версия 2", category: "warmup", note: null },
  { title: "заминка", label: "Заминка — версия 1", category: "cooldown", note: null },
  { title: "Заминка", label: "Заминка — версия 2", category: "cooldown", note: null },
] as const;

type Clip = { title: string; url: string };

function isWorkoutTitle(title: string): boolean {
  return WORKOUT_TITLES.has(title) || title.startsWith("Тренировка «между дел");
}

function videoOf(url: string, title: string) {
  const video = normalizeExerciseVideo({ url, title });
  const videoId = video.url?.match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase() ?? "";
  if (video.provider !== "rutube" || !video.url || !video.embed_url || !videoId) {
    throw new Error(`Ролик не разобран: ${title}`);
  }
  return { videoId, sourceUrl: video.url, embedUrl: video.embed_url };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const clipsPath = process.argv[2];
  const bindingsPath = process.argv[3];
  if (!databaseUrl || !clipsPath || !bindingsPath) {
    throw new Error("Нужны DATABASE_URL, файл роликов и файл подтверждённых упражнений");
  }
  const clips = (
    JSON.parse(readFileSync(clipsPath, "utf8").replace(/^\uFEFF/, "")) as { videos: Clip[] }
  ).videos;
  const bindings = (
    JSON.parse(readFileSync(bindingsPath, "utf8").replace(/^\uFEFF/, "")) as {
      items: Array<{ exerciseId: string; exerciseName: string; sourceUrl: string }>;
    }
  ).items;

  const pool = new pg.Pool({ connectionString: databaseUrl });
  await applyMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let pieces = 0;
    for (const item of bindings) {
      const found = await client.query(`SELECT id FROM public.exercises WHERE id = $1`, [item.exerciseId]);
      if (!found.rowCount) throw new Error(`В каталоге нет упражнения: ${item.exerciseName}`);
      const video = videoOf(item.sourceUrl, item.exerciseName);
      await upsert(client, {
        exerciseId: item.exerciseId,
        collection: "piece",
        label: item.exerciseName,
        note: null,
        ...video,
      });
      pieces += 1;
    }

    let blocks = 0;
    for (const block of BLOCKS) {
      const matches = clips.filter((clip) => clip.title === block.title);
      if (matches.length !== 1) throw new Error(`Не один ролик блока: ${block.label}`);
      const video = videoOf(matches[0].url, block.label);
      const exerciseId = await ensureTaggedExercise(client, {
        slug: `rutube-manual-${video.videoId}`,
        name: block.label,
        category: block.category,
        tag: "ready_block",
        existingName: block.label,
      });
      await upsert(client, {
        exerciseId,
        collection: "piece",
        label: block.label,
        note: block.note,
        ...video,
      });
      blocks += 1;
    }

    const workoutClips = clips.filter((clip) => isWorkoutTitle(clip.title));
    const seen = new Map<string, number>();
    let workouts = 0;
    for (const clip of workoutClips) {
      const next = (seen.get(clip.title) ?? 0) + 1;
      seen.set(clip.title, next);
      const same = workoutClips.filter((item) => item.title === clip.title).length;
      const label = same > 1 ? `${clip.title} — вариант ${next}` : clip.title;
      const video = videoOf(clip.url, label);
      const exerciseId = await ensureTaggedExercise(client, {
        slug: `rutube-manual-${video.videoId}`,
        name: label,
        category: "strength_full",
        tag: "rutube_workout",
        existingName: label,
      });
      await upsert(client, {
        exerciseId,
        collection: "workout",
        label,
        note: null,
        ...video,
      });
      workouts += 1;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ pieces, blocks, workouts }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureTaggedExercise(
  client: pg.PoolClient,
  input: { slug: string; name: string; category: string; tag: string; existingName: string },
): Promise<string> {
  const bySlug = await client.query(`SELECT id FROM public.exercises WHERE slug = $1`, [input.slug]);
  if (bySlug.rows[0]) return (bySlug.rows[0] as { id: string }).id;
  const byName = await client.query(
    `SELECT id FROM public.exercises WHERE name = $1 AND $2 = ANY(tags) LIMIT 1`,
    [input.existingName, input.tag],
  );
  if (byName.rows[0]) return (byName.rows[0] as { id: string }).id;
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.exercises
       (id, slug, name, category, difficulty, tags, description, is_active)
     VALUES ($1, $2, $3, $4, 'beginner', $5::text[], $6, true)`,
    [id, input.slug, input.name, input.category, [input.tag], "Ручная подборка RUTUBE"],
  );
  return id;
}

async function upsert(
  client: pg.PoolClient,
  row: {
    exerciseId: string;
    collection: "workout" | "workout_male" | "piece";
    label: string;
    note: string | null;
    videoId: string;
    sourceUrl: string;
    embedUrl: string;
  },
): Promise<void> {
  await client.query(
    `DELETE FROM public.generator_rutube_manual
      WHERE exercise_id = $1 OR rutube_video_id = $2`,
    [row.exerciseId, row.videoId],
  );
  await client.query(
    `INSERT INTO public.generator_rutube_manual
       (exercise_id, collection, label, note, rutube_video_id, source_url, embed_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.exerciseId, row.collection, row.label, row.note, row.videoId, row.sourceUrl, row.embedUrl],
  );
}

void main();
