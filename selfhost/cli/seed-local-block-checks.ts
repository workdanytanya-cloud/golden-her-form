/**
 * Локальные тестовые тренировки и кабинет для редактора ссылки.
 * Пишет только в 127.0.0.1 / panovapro_player_preview. Ссылки в консоль не печатает.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { normalizeExerciseVideo } from "../../src/lib/exercise-video";
import { trainingSnapshotHash } from "../../src/lib/published-programs/training-snapshot";
import type { TrainingSnapshot } from "../../src/lib/published-programs/types";
import { applyMigrations } from "../../src/lib/selfhost/migrate";
import { hashPasswordArgon2id } from "../../src/lib/selfhost/passwords";

const ASSESSMENT = [
  {
    title: "Разминка",
    label: "Разминка — версия 1",
    kind: "warmup" as const,
    coversMobility: true,
    coversActivation: false,
    equipment: ["mat"],
  },
  {
    title: "Разминка_",
    label: "Разминка — версия 2",
    kind: "warmup" as const,
    coversMobility: true,
    coversActivation: true,
    equipment: ["mat", "chair"],
  },
  {
    title: "заминка",
    label: "Заминка — версия 1",
    kind: "cooldown" as const,
    coversMobility: false,
    coversActivation: false,
    equipment: ["mat"],
  },
  {
    title: "Заминка",
    label: "Заминка — версия 2",
    kind: "cooldown" as const,
    coversMobility: false,
    coversActivation: false,
    equipment: ["mat"],
  },
];

function assertLocal(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/panovapro_player_preview") {
    throw new Error("Скрипт пишет только в локальную проверочную базу");
  }
}

function frozen(
  id: string,
  name: string,
  category: string,
  sourceUrl: string | null,
) {
  const video = sourceUrl ? normalizeExerciseVideo({ url: sourceUrl, title: name }) : null;
  return {
    id,
    slug: `preview-${id}`,
    name,
    category,
    muscle_groups: [] as string[],
    equipment: [] as string[],
    difficulty: "beginner",
    tags: [] as string[],
    description: null,
    cues: [] as string[],
    common_mistakes: [] as string[],
    gif_url: null,
    video_url: video?.url ?? null,
    video: video ?? undefined,
    default_sets: 1,
    default_reps: "10",
    tempo: null,
    rest_seconds: 30,
  };
}

function setOf(exercise: ReturnType<typeof frozen>) {
  return {
    exercise_id: exercise.id,
    sets: 1,
    reps: "10",
    rest_seconds: 30,
    tempo: null,
    note: null,
    exercise,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const listPath = process.argv[2];
  const outPath = process.argv[3];
  if (!databaseUrl || !listPath || !outPath) throw new Error("Нужны DATABASE_URL, список роликов и путь манифеста");
  assertLocal(databaseUrl);
  const videos = (
    JSON.parse(readFileSync(listPath, "utf8").replace(/^\uFEFF/, "")) as {
      videos: Array<{ title: string; url: string }>;
    }
  ).videos;
  const clips = ASSESSMENT.map((item) => {
    const found = videos.filter((video) => video.title === item.title);
    if (found.length !== 1) throw new Error(`Не однозначное название блока: ${item.title}`);
    const video = normalizeExerciseVideo({ url: found[0].url, title: item.label });
    if (!video.embed_url || !video.url) throw new Error(`Не собрался плеер блока: ${item.label}`);
    return { ...item, id: randomUUID(), sourceUrl: video.url, embedUrl: video.embed_url, videoId: video.url.match(/[a-f0-9]{32}/i)?.[0] ?? "" };
  });

  const pool = new pg.Pool({ connectionString: databaseUrl });
  await applyMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(`SELECT id FROM public.users WHERE email = 'player-check@panovapro.local'`);
    const clientId = (user.rows[0] as { id: string } | undefined)?.id;
    if (!clientId) throw new Error("Локальный клиент не найден");

    const titles = [
      "Проверка набора 1",
      "Проверка набора 2",
      "Пустое видео",
      "YouTube в другой программе",
    ];
    await client.query(
      `DELETE FROM public.snapshot_exercise_media_bindings
        WHERE version_id IN (
          SELECT v.id FROM public.training_program_versions v
          JOIN public.client_courses c ON c.id = v.course_id
         WHERE c.client_id = $1 AND c.title = ANY($2::text[])
        )`,
      [clientId, titles],
    );
    await client.query(
      `DELETE FROM public.client_program_assignments
        WHERE course_id IN (
          SELECT id FROM public.client_courses WHERE client_id = $1 AND title = ANY($2::text[])
        )`,
      [clientId, titles],
    );
    await client.query(
      `DELETE FROM public.training_program_versions
        WHERE course_id IN (
          SELECT id FROM public.client_courses WHERE client_id = $1 AND title = ANY($2::text[])
        )`,
      [clientId, titles],
    );
    await client.query(
      `DELETE FROM public.client_courses WHERE client_id = $1 AND title = ANY($2::text[])`,
      [clientId, titles],
    );
    await client.query(
      `DELETE FROM public.snapshot_exercise_media_bindings
        WHERE exercise_id IN (SELECT id FROM public.exercises WHERE 'ready_block' = ANY(tags))`,
    );
    await client.query(`DELETE FROM public.generator_ready_blocks`);
    await client.query(`DELETE FROM public.exercises WHERE 'ready_block' = ANY(tags)`);
    await client.query(
      `DELETE FROM public.sessions
        WHERE user_id IN (SELECT id FROM public.users WHERE email = 'video-admin@panovapro.local')`,
    );
    await client.query(`DELETE FROM public.users WHERE email = 'video-admin@panovapro.local'`);

    for (const clip of clips) {
      await client.query(
        `INSERT INTO public.exercises
           (id, slug, name, category, difficulty, equipment, tags, description, is_active)
         VALUES ($1, $2, $3, $4, 'beginner', $5, '{ready_block}', $6, true)
         ON CONFLICT (id) DO NOTHING`,
        [
          clip.id,
          `block-${clip.id}`,
          clip.label,
          clip.kind,
          clip.equipment,
          "Готовый блок для новых программ",
        ],
      );
      await client.query(
        `INSERT INTO public.generator_ready_blocks
           (id, kind, label, covers_mobility, covers_activation, equipment, rutube_video_id, source_url, embed_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          clip.id,
          clip.kind,
          clip.label,
          clip.coversMobility,
          clip.coversActivation,
          clip.equipment,
          clip.videoId,
          clip.sourceUrl,
          clip.embedUrl,
        ],
      );
    }

    const mains = await client.query(
      `SELECT DISTINCT ON (e.category) e.id, e.name, e.category, p.source_url
         FROM public.exercises e
         JOIN public.generator_rutube_pool p ON p.exercise_id = e.id
        WHERE e.category IN ('strength_lower', 'strength_upper', 'core')
          AND e.name NOT IN ('Планка')
        ORDER BY e.category, e.name`,
    );
    const shared = await client.query(
      `SELECT e.id, e.name, e.category
         FROM public.exercises e
        WHERE e.name = 'Планка'
        LIMIT 1`,
    );
    const sharedRow = shared.rows[0] as { id: string; name: string; category: string } | undefined;
    if (!sharedRow || mains.rows.length < 3) throw new Error("В локальном пуле не хватает упражнений для проверки");

    const byKind = (kind: "warmup" | "cooldown", label: string) => {
      const clip = clips.find((item) => item.kind === kind && item.label === label);
      if (!clip) throw new Error(label);
      return clip;
    };

    const courses = [
      {
        title: "Проверка набора 1",
        note: "Набор роликов 1. Разминка закрывает мобильность и не закрывает активацию, поэтому это не полноценный профиль.",
        warmup: byKind("warmup", "Разминка — версия 1"),
        cooldown: byKind("cooldown", "Заминка — версия 1"),
        includeMain: true,
        mode: "blocks" as const,
      },
      {
        title: "Проверка набора 2",
        note: "Набор роликов 2. Разминка закрывает мобильность и активацию. Кардио этим блоком не заменяется.",
        warmup: byKind("warmup", "Разминка — версия 2"),
        cooldown: byKind("cooldown", "Заминка — версия 2"),
        includeMain: true,
        mode: "blocks" as const,
      },
    ];

    const created: Array<{ title: string; courseId: string; versionId: string; hash: string }> = [];
    const versionRow = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS n FROM public.training_program_versions WHERE client_id = $1`,
      [clientId],
    );
    let nextVersion = Number((versionRow.rows[0] as { n: number }).n);
    for (const course of courses) {
      nextVersion += 1;
      const courseId = randomUUID();
      const versionId = randomUUID();
      const warmup = frozen(course.warmup.id, course.warmup.label, "warmup", course.warmup.sourceUrl);
      const cooldown = frozen(course.cooldown.id, course.cooldown.label, "cooldown", course.cooldown.sourceUrl);
      const mainSets = (mains.rows as Array<{ id: string; name: string; category: string; source_url: string }>).map(
        (row) => setOf(frozen(row.id, row.name, row.category, row.source_url)),
      );
      const snapshot: TrainingSnapshot = {
        name: course.title,
        sessions_per_week: 3,
        goal: "muscle_gain",
        level: "beginner",
        has_injuries: false,
        injuries_details: null,
        equipment: ["bodyweight", "mat", "chair"],
        location: "home",
        notes: course.note,
        faq: [],
        program_weeks: 1,
        days: [
          {
            week_index: 0,
            day_index: 0,
            is_rest: false,
            title: course.title,
            focus: "Проверка блоков",
            description: course.note,
            warmup: [setOf(warmup)],
            exercises: mainSets,
            cooldown: [setOf(cooldown)],
            day_note: null,
          },
        ],
      };
      const hash = trainingSnapshotHash(snapshot);
      await client.query(
        `INSERT INTO public.client_courses
           (id, client_id, title, start_date, end_date, status, program_scope)
         VALUES ($1, $2, $3, '2026-11-01', '2026-12-31', 'completed', 'training')`,
        [courseId, clientId, course.title],
      );
      await client.query(
        `INSERT INTO public.training_program_versions
           (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
         VALUES ($1, $2, $3, $6, 'published', $4::jsonb, $5, now())`,
        [versionId, clientId, courseId, JSON.stringify(snapshot), hash, nextVersion],
      );
      await client.query(
        `INSERT INTO public.client_program_assignments
           (client_id, kind, course_id, active_version_id)
         VALUES ($1, 'training', $2, $3)`,
        [clientId, courseId, versionId],
      );
      await client.query(
        `INSERT INTO public.snapshot_exercise_media_bindings
           (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer, source_url, embed_url)
         VALUES ($1, '0:0:warmup:0', $2, true, $3, $4),
                ($1, '0:0:cooldown:0', $5, true, $6, $7)`,
        [
          versionId,
          course.warmup.id,
          course.warmup.sourceUrl,
          course.warmup.embedUrl,
          course.cooldown.id,
          course.cooldown.sourceUrl,
          course.cooldown.embedUrl,
        ],
      );
      created.push({ title: course.title, courseId, versionId, hash });
    }

    const emptyCourseId = randomUUID();
    const emptyVersionId = randomUUID();
    const youtubeCourseId = randomUUID();
    const youtubeVersionId = randomUUID();
    const emptyExercise = frozen(sharedRow.id, sharedRow.name, sharedRow.category, null);
    const youtubeUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
    const youtubeExercise = frozen(sharedRow.id, sharedRow.name, sharedRow.category, youtubeUrl);
    const emptySnapshot: TrainingSnapshot = {
      name: "Пустое видео",
      sessions_per_week: 3,
      goal: "tone",
      level: "beginner",
      has_injuries: false,
      injuries_details: null,
      equipment: [],
      location: "home",
      notes: "Проверка добавления ссылки. В другой программе это же упражнение не должно измениться.",
      faq: [],
      program_weeks: 1,
      days: [
        {
          week_index: 0,
          day_index: 0,
          is_rest: false,
          title: "Пустое видео",
          focus: null,
          description: null,
          warmup: [],
          exercises: [setOf(emptyExercise)],
          cooldown: [],
          day_note: null,
        },
      ],
    };
    const youtubeSnapshot: TrainingSnapshot = {
      ...emptySnapshot,
      name: "YouTube в другой программе",
      notes: "Нерабочий YouTube. Замена ссылки должна остаться только здесь.",
      days: [
        {
          ...emptySnapshot.days[0],
          title: "YouTube в другой программе",
          exercises: [setOf(youtubeExercise)],
        },
      ],
    };
    const emptyHash = trainingSnapshotHash(emptySnapshot);
    const youtubeHash = trainingSnapshotHash(youtubeSnapshot);
    for (const item of [
      { id: emptyCourseId, versionId: emptyVersionId, title: "Пустое видео", snapshot: emptySnapshot, hash: emptyHash },
      {
        id: youtubeCourseId,
        versionId: youtubeVersionId,
        title: "YouTube в другой программе",
        snapshot: youtubeSnapshot,
        hash: youtubeHash,
      },
    ]) {
      await client.query(
        `INSERT INTO public.client_courses
           (id, client_id, title, start_date, end_date, status, program_scope)
         VALUES ($1, $2, $3, '2026-11-01', '2026-12-31', 'completed', 'training')`,
        [item.id, clientId, item.title],
      );
      nextVersion += 1;
      await client.query(
        `INSERT INTO public.training_program_versions
           (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
         VALUES ($1, $2, $3, $6, 'published', $4::jsonb, $5, now())`,
        [item.versionId, clientId, item.id, JSON.stringify(item.snapshot), item.hash, nextVersion],
      );
      await client.query(
        `INSERT INTO public.client_program_assignments
           (client_id, kind, course_id, active_version_id)
         VALUES ($1, 'training', $2, $3)`,
        [clientId, item.id, item.versionId],
      );
    }

    const adminId = randomUUID();
    const adminPassword = randomUUID();
    await client.query(
      `INSERT INTO public.users (id, email, password_hash, status)
       VALUES ($1, 'video-admin@panovapro.local', $2, 'active')`,
      [adminId, await hashPasswordArgon2id(adminPassword)],
    );
    await client.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [adminId]);
    await client.query("COMMIT");

    const credPath = "C:/Users/User/Desktop/Ермак/player-preview.local.txt";
    const previous = readFileSync(credPath, "utf8");
    writeFileSync(
      credPath,
      `${previous.trim()}\nadminEmail=video-admin@panovapro.local\nadminPassword=${adminPassword}\nclientId=${clientId}\n`,
      "utf8",
    );
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          clientId,
          adminId,
          sharedExerciseId: sharedRow.id,
          sharedExerciseName: sharedRow.name,
          emptyVersionId,
          youtubeVersionId,
          emptyHash,
          youtubeHash,
          firstRutube: clips[0].sourceUrl,
          secondRutube: clips[1].sourceUrl,
          courses: created,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(
      JSON.stringify({
        blocks: clips.map((clip) => ({
          label: clip.label,
          coversMobility: clip.coversMobility,
          coversActivation: clip.coversActivation,
        })),
        courses: created.map((item) => item.title),
        sharedExercise: sharedRow.name,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/https?:\/\/\S+/g, "[ссылка скрыта]"));
  process.exit(1);
});
