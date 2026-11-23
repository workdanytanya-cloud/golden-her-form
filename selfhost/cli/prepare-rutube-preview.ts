/**
 * Локальная подготовка пула новых программ и страницы выбора разминки/заминки.
 * Закрытые ссылки пишет только в файлы вне репозитория. В консоль их не печатает.
 * База — только 127.0.0.1 и только имя panovapro_player_preview.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { normalizeExerciseVideo, rutubeVideoId } from "../../src/lib/exercise-video";
import { applyMigrations } from "../../src/lib/selfhost/migrate";
import { hashPasswordArgon2id } from "../../src/lib/selfhost/passwords";
import {
  matchStudioClips,
  normalizeExerciseTitle,
  type CatalogCard,
  type StudioClip,
} from "../../src/lib/rutube-catalog-match";

const PREVIEW_DB = "panovapro_player_preview";
const PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);

type CatalogRow = CatalogCard & {
  slug?: string;
  difficulty?: string;
  muscle_groups?: string[];
  tags?: string[];
};

type StudioVideo = { title: string; url: string };

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function privateParam(raw: string): string | null {
  const url = new URL(raw);
  return url.searchParams.get("p");
}

function assertLocalPreview(databaseUrl: string): URL {
  const url = new URL(databaseUrl);
  if (!PREVIEW_HOSTS.has(url.hostname) || url.pathname !== `/${PREVIEW_DB}`) {
    throw new Error("Скрипт пишет только в локальную базу panovapro_player_preview");
  }
  return url;
}

async function recreatePreviewDatabase(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [PREVIEW_DB],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${PREVIEW_DB}`);
  await admin.query(`CREATE DATABASE ${PREVIEW_DB}`);
  await admin.end();
}

function chooserHtml(sections: Array<{ heading: string; items: Array<{ label: string; embed: string }> }>): string {
  const blocks = sections
    .map((section) => {
      const cards = section.items
        .map(
          (item, index) => `<article>
  <h2>${escapeHtml(section.heading)} — версия ${index + 1}</h2>
  <p>Название в Студии: «${escapeHtml(item.label)}»</p>
  <iframe src="${escapeHtml(item.embed)}" title="${escapeHtml(item.label)}"
    allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
    sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>
</article>`,
        )
        .join("\n");
      return cards;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Выбор разминки и заминки</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #16120f; color: #f4efe6; }
    main { max-width: 920px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 28px; }
    p.note { color: #c8bba6; }
    article { margin: 28px 0 40px; }
    iframe { width: 100%; aspect-ratio: 16/9; border: 0; background: #000; }
  </style>
</head>
<body>
<main>
  <h1>Выбор разминки и заминки</h1>
  <p class="note">Локальная страница для выбора. На рабочий сайт ничего не выложено. Напишите, какую версию разминки и какую версию заминки оставить.</p>
  ${blocks}
</main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const catalogPath = process.argv[2];
  const listPath = process.argv[3];
  const outDir = process.argv[4];
  if (!catalogPath || !listPath || !outDir) {
    throw new Error("Нужны пути: каталог, список роликов, папка вне репозитория");
  }
  mkdirSync(outDir, { recursive: true });

  const catalog = readJson<CatalogRow[]>(catalogPath);
  const videos = readJson<{ videos: StudioVideo[] }>(listPath).videos;
  const cards: CatalogCard[] = catalog.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    equipment: row.equipment ?? [],
    archived: Boolean(row.archived),
    description: row.description ?? "",
  }));
  const byVideoId = new Map<string, StudioVideo>();
  const clips: StudioClip[] = videos.map((video) => {
    const videoId = video.url.match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase() ?? video.title;
    byVideoId.set(videoId, video);
    return { title: video.title, videoId };
  });
  const decisions = matchStudioClips(clips, cards);
  const binds = decisions.filter((item) => item.kind === "bind");
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const items = binds.flatMap((item) => {
    if (item.kind !== "bind") return [];
    const video = byVideoId.get(item.videoId);
    const card = byId.get(item.exerciseId);
    if (!video || !card) return [];
    const normalized = normalizeExerciseVideo({ url: video.url, title: card.name });
    if (!normalized.embed_url || !rutubeVideoId(new URL(video.url)) || !privateParam(video.url)) {
      return [];
    }
    return [
      {
        exerciseId: card.id,
        exerciseName: card.name,
        category: card.category,
        difficulty: card.difficulty ?? "beginner",
        equipment: card.equipment ?? [],
        muscleGroups: card.muscle_groups ?? [],
        tags: card.tags ?? [],
        studioTitle: video.title,
        sourceUrl: video.url,
        embedUrl: normalized.embed_url,
        videoId: item.videoId,
      },
    ];
  });

  const bindingsPath = path.join(outDir, "rutube-new-program-bindings.json");
  writeFileSync(
    bindingsPath,
    JSON.stringify(
      {
        purpose: "Только новые программы. Общие привязки и выданные тренировки не менялись.",
        count: items.length,
        items: items.map((item) => ({
          exerciseId: item.exerciseId,
          exerciseName: item.exerciseName,
          category: item.category,
          studioTitle: item.studioTitle,
          sourceUrl: item.sourceUrl,
          embedUrl: item.embedUrl,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const pair = (normalized: string) =>
    videos
      .filter((video) => normalizeExerciseTitle(video.title) === normalized)
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const warmups = pair("разминка");
  const cooldowns = pair("заминка");
  const toCard = (video: StudioVideo) => {
    const normalized = normalizeExerciseVideo({ url: video.url, title: video.title });
    if (!normalized.embed_url) throw new Error("Не собрался локальный плеер для выбранной пары");
    return { label: video.title, embed: normalized.embed_url };
  };
  const htmlPath = path.join(outDir, "vybor-razminka-zaminka.html");
  writeFileSync(
    htmlPath,
    chooserHtml([
      { heading: "Разминка", items: warmups.map(toCard) },
      { heading: "Заминка", items: cooldowns.map(toCard) },
    ]),
    "utf8",
  );

  const categories = new Map<string, number>();
  for (const item of items) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);

  let playerExercise = "";
  if (process.env.SEED_LOCAL === "1") {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Для локального кабинета нужен DATABASE_URL");
    const preview = assertLocalPreview(databaseUrl);
    const admin = new URL(preview.toString());
    admin.pathname = "/panovapro";
    await recreatePreviewDatabase(admin.toString());
    const pool = new pg.Pool({ connectionString: preview.toString() });
    await applyMigrations(pool);
    const password = randomBytes(18).toString("base64url");
    const passwordHash = await hashPasswordArgon2id(password);
    const userId = randomUUID();
    const courseId = randomUUID();
    const versionId = randomUUID();
    const player =
      items.find((item) => /планка/i.test(item.exerciseName)) ??
      items.find((item) => /кошка/i.test(item.exerciseName)) ??
      items[0];
    if (!player) throw new Error("Нет подтверждённых привязок для проверки плеера");
    playerExercise = player.exerciseName;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO public.users (id, email, password_hash, status)
         VALUES ($1, $2, $3, 'active')`,
        [userId, "player-check@panovapro.local", passwordHash],
      );
      await client.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'client')`, [userId]);
      await client.query(`INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)`, [
        userId,
        "Проверка плеера",
      ]);
      await client.query(
        `INSERT INTO public.client_access (user_id, status, activated_at) VALUES ($1, 'active', now())`,
        [userId],
      );
      await client.query(
        `INSERT INTO public.client_courses (id, client_id, title, start_date, end_date, status, program_scope)
         VALUES ($1, $2, 'Локальная проверка плеера', '2026-11-01', '2026-12-31', 'active', 'training')`,
        [courseId, userId],
      );
      for (const item of items) {
        await client.query(
          `INSERT INTO public.exercises
             (id, slug, name, category, difficulty, muscle_groups, equipment, tags, description, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          [
            item.exerciseId,
            `preview-${item.exerciseId}`,
            item.exerciseName,
            item.category,
            item.difficulty,
            item.muscleGroups,
            item.equipment,
            item.tags,
            "Локальная карточка для проверки новых программ",
          ],
        );
        await client.query(
          `INSERT INTO public.generator_rutube_pool
             (exercise_id, rutube_video_id, source_url, embed_url, studio_title)
           VALUES ($1, $2, $3, $4, $5)`,
          [item.exerciseId, item.videoId, item.sourceUrl, item.embedUrl, item.studioTitle],
        );
      }
      const frozen = {
        id: player.exerciseId,
        slug: `preview-${player.exerciseId}`,
        name: player.exerciseName,
        category: player.category,
        muscle_groups: player.muscleGroups,
        equipment: player.equipment,
        difficulty: player.difficulty,
        tags: player.tags,
        description: null,
        cues: [],
        common_mistakes: [],
        gif_url: null,
        video_url: null,
        default_sets: 1,
        default_reps: "10",
        tempo: null,
        rest_seconds: 30,
      };
      const snapshot = {
        name: "Локальная проверка плеера",
        sessions_per_week: 3,
        goal: "tone",
        level: "beginner",
        has_injuries: false,
        injuries_details: null,
        equipment: ["bodyweight"],
        location: "home",
        notes: "Только локальный кабинет. На рабочий сайт не выкладывалось.",
        faq: [],
        program_weeks: 1,
        days: [
          {
            week_index: 0,
            day_index: 0,
            is_rest: false,
            title: "Проверка плеера",
            focus: "Один ролик",
            description: "Откройте упражнение и нажмите воспроизведение.",
            warmup: [],
            exercises: [
              {
                exercise_id: player.exerciseId,
                sets: 1,
                reps: "10",
                rest_seconds: 30,
                tempo: null,
                note: null,
                exercise: frozen,
              },
            ],
            cooldown: [],
            day_note: null,
          },
        ],
      };
      const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
      await client.query(
        `INSERT INTO public.training_program_versions
           (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
         VALUES ($1, $2, $3, 1, 'published', $4::jsonb, $5, now())`,
        [versionId, userId, courseId, JSON.stringify(snapshot), contentHash],
      );
      await client.query(
        `INSERT INTO public.client_program_assignments
           (client_id, kind, course_id, active_version_id)
         VALUES ($1, 'training', $2, $3)`,
        [userId, courseId, versionId],
      );
      await client.query(
        `INSERT INTO public.snapshot_exercise_media_bindings
           (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer, source_url, embed_url, created_by)
         VALUES ($1, '0:0:exercises:0', $2, true, $3, $4, $5)`,
        [versionId, player.exerciseId, player.sourceUrl, player.embedUrl, userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    writeFileSync(
      path.join(outDir, "player-preview.local.txt"),
      `email=player-check@panovapro.local\npassword=${password}\nexercise=${player.exerciseName}\n`,
      "utf8",
    );
    await pool.end();
  }

  console.log(
    JSON.stringify({
      bindings: items.length,
      warmupVersions: warmups.map((video) => video.title),
      cooldownVersions: cooldowns.map((video) => video.title),
      categories: Object.fromEntries([...categories.entries()].sort()),
      playerExercise: playerExercise || null,
      html: htmlPath,
      bindingsFile: bindingsPath,
    }),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/https?:\/\/\S+/g, "[ссылка скрыта]"));
  process.exit(1);
});
