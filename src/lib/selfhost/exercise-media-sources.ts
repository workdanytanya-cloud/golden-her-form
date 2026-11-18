import type { Pool, PoolClient } from "pg";
import {
  acceptMediaSource,
  YOUTUBE_NETWORK_WARNING,
  type ExerciseVideo,
  type ExerciseVideoSource,
} from "@/lib/exercise-video";
import type { ExerciseMediaBinding } from "@/lib/selfhost/media";

type Queryable = Pool | PoolClient;

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string }).code === "42P01";
}

export async function loadVerifiedMediaSources(
  db: Queryable,
  exerciseIds: string[],
): Promise<Map<string, ExerciseVideoSource[]>> {
  const map = new Map<string, ExerciseVideoSource[]>();
  if (exerciseIds.length === 0) return map;
  try {
    const { rows } = await db.query(
      `SELECT exercise_id, provider, source_url, title, status, priority
         FROM public.exercise_media_sources
        WHERE exercise_id = ANY($1::uuid[])
          AND status = 'ok'
          AND verified_at IS NOT NULL
        ORDER BY priority, created_at`,
      [exerciseIds],
    );
    for (const row of rows as Array<{
      exercise_id: string;
      provider: string;
      source_url: string;
      title: string | null;
      status: string;
      priority: number;
    }>) {
      const source = acceptMediaSource({
        provider: row.provider,
        url: row.source_url,
        title: row.title,
        status: row.status,
        priority: row.priority,
      });
      if (!source) continue;
      const list = map.get(row.exercise_id) ?? [];
      list.push(source);
      map.set(row.exercise_id, list);
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return map;
}

export function bindingFromSources(
  exerciseId: string,
  sources: ExerciseVideoSource[],
  legacy?: ExerciseMediaBinding,
): ExerciseMediaBinding {
  const rutube = sources.find((source) => source.provider === "rutube");
  const local = sources.find((source) => source.provider === "local");
  const external = sources.find((source) => source.provider === "external");
  const youtube = sources.find((source) => source.provider === "youtube");
  const primary = rutube ?? local ?? external ?? youtube ?? null;
  const youtubeOnly = Boolean(youtube) && !rutube && !local && !external;
  return {
    exercise_id: exerciseId,
    provider:
      primary?.provider === "local"
        ? "external"
        : (primary?.provider ?? legacy?.provider ?? "none"),
    source_url: primary?.url ?? legacy?.source_url ?? null,
    embed_url: primary?.provider === "rutube" ? (primary.embed_url ?? null) : null,
    title: primary?.title ?? legacy?.title ?? null,
    status: primary ? "ok" : (legacy?.status ?? "unchecked"),
    fallback_text: youtubeOnly ? YOUTUBE_NETWORK_WARNING : (legacy?.fallback_text ?? null),
    sources,
  };
}

export async function mergeVerifiedSources(
  db: Queryable,
  exerciseIds: string[],
  map: Map<string, ExerciseMediaBinding>,
): Promise<void> {
  const verified = await loadVerifiedMediaSources(db, exerciseIds);
  const ids = new Set([...map.keys(), ...verified.keys()]);
  for (const id of ids) {
    const extra = verified.get(id) ?? [];
    const legacy = map.get(id);
    const merged: ExerciseVideoSource[] = [...extra];
    if (legacy?.source_url) {
      const fromLegacy = acceptMediaSource({
        provider: legacy.provider,
        url: legacy.source_url,
        title: legacy.title,
        status: legacy.status,
      });
      if (
        fromLegacy &&
        !merged.some(
          (source) => source.provider === fromLegacy.provider && source.url === fromLegacy.url,
        )
      ) {
        merged.push(fromLegacy);
      }
    }
    if (merged.length > 0) map.set(id, bindingFromSources(id, merged, legacy));
  }
}

export async function rememberVerifiedSource(
  db: Queryable,
  exerciseId: string,
  video: ExerciseVideo,
): Promise<void> {
  const source = acceptMediaSource({
    provider: video.provider,
    url: video.url,
    title: video.title,
    status: video.status,
  });
  if (!source || source.provider === "external") return;
  if (
    source.provider !== "youtube" &&
    source.provider !== "rutube" &&
    source.provider !== "local"
  ) {
    return;
  }
  try {
    await db.query(
      `INSERT INTO public.exercise_media_sources
         (exercise_id, provider, source_url, embed_url, status, priority, title, verified_at, updated_at)
       VALUES ($1,$2,$3,$4,'ok',$5,$6,(now() AT TIME ZONE 'utc'),(now() AT TIME ZONE 'utc'))
       ON CONFLICT (exercise_id, provider, source_url) DO UPDATE SET
         embed_url = EXCLUDED.embed_url,
         status = 'ok',
         priority = EXCLUDED.priority,
         title = EXCLUDED.title,
         verified_at = COALESCE(public.exercise_media_sources.verified_at, EXCLUDED.verified_at),
         updated_at = (now() AT TIME ZONE 'utc')`,
      [exerciseId, source.provider, source.url, source.embed_url, source.priority, source.title],
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
}

export async function addVerifiedRutubeSource(
  db: Queryable,
  exerciseId: string,
  rawUrl: string,
  title?: string | null,
): Promise<ExerciseVideoSource> {
  const source = acceptMediaSource({ provider: "rutube", url: rawUrl, title, status: "ok" });
  if (!source || source.provider !== "rutube") {
    throw Object.assign(new Error("Нужна ссылка https на Rutube"), { statusCode: 400 });
  }
  const existing = await db.query(`SELECT id FROM public.exercises WHERE id = $1`, [exerciseId]);
  if (!existing.rowCount) {
    throw Object.assign(new Error("Упражнение не найдено"), { statusCode: 404 });
  }
  await db.query(
    `INSERT INTO public.exercise_media_sources
       (exercise_id, provider, source_url, embed_url, status, priority, title, verified_at, updated_at)
     VALUES ($1,'rutube',$2,$3,'ok',$4,$5,(now() AT TIME ZONE 'utc'),(now() AT TIME ZONE 'utc'))
     ON CONFLICT (exercise_id, provider, source_url) DO UPDATE SET
       embed_url = EXCLUDED.embed_url,
       status = 'ok',
       priority = EXCLUDED.priority,
       title = COALESCE(EXCLUDED.title, public.exercise_media_sources.title),
       verified_at = (now() AT TIME ZONE 'utc'),
       updated_at = (now() AT TIME ZONE 'utc')`,
    [exerciseId, source.url, source.embed_url, source.priority, source.title],
  );
  return source;
}
