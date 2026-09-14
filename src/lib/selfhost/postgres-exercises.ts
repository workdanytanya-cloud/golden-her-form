import type { Pool } from "pg";
import { z } from "zod";
import {
  EMPTY_EXERCISE_VIDEO,
  requireYoutubeOrRutubeUrl,
  type ExerciseVideo,
  type ExerciseVideoProvider,
  type ExerciseVideoStatus,
} from "@/lib/exercise-video";
import type { ExerciseRepository, ExerciseUpsertInput } from "@/lib/platform/types";
import { upsertExerciseMediaBinding } from "@/lib/selfhost/postgres-published";
import type { ExerciseMediaBinding } from "@/lib/selfhost/media";
import type { Exercise, ExerciseCategory } from "@/lib/training";
import {
  MEDIA_FILTERS,
  type AdminExerciseReport,
  type AdminExerciseRow,
  type MediaFilter,
} from "@/lib/selfhost/exercise-admin-types";

export { MEDIA_FILTERS, type AdminExerciseReport, type AdminExerciseRow, type MediaFilter };

export const adminExerciseUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  difficulty: z.string().min(1).max(40),
  muscle_groups: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  default_sets: z.number().int().min(0).max(50),
  default_reps: z.string().max(40),
  rest_seconds: z.number().int().min(0).max(600),
  tempo: z.string().max(40).nullable(),
  description: z.string().max(4000).nullable(),
  gif_url: z.string().max(2000).nullable(),
  video_url: z.string().max(2000).nullable(),
  video_title: z.string().max(200).nullable().optional(),
  video_fallback_text: z.string().max(500).nullable().optional(),
  video_status: z.enum(["ok", "unavailable", "unchecked"]).nullable().optional(),
  embed_url: z.string().max(2000).optional(),
  video_embed_url: z.string().max(2000).nullable().optional(),
});

export const adminExerciseListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  category: z.string().max(80).optional().default("all"),
  media: z.enum(MEDIA_FILTERS).optional().default("all"),
});

export const adminExerciseMediaSchema = z.object({
  exercise_id: z.string().uuid(),
  video_url: z.string().max(2000).nullable().optional(),
  video_title: z.string().max(200).nullable().optional(),
  video_fallback_text: z.string().max(500).nullable().optional(),
  video_status: z.enum(["ok", "unavailable", "unchecked"]).nullable().optional(),
  embed_url: z.string().max(2000).optional(),
  video_embed_url: z.string().max(2000).nullable().optional(),
});

export type AdminExerciseUpsert = z.infer<typeof adminExerciseUpsertSchema>;

type ListedRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  difficulty: string;
  muscle_groups: string[] | null;
  equipment: string[] | null;
  tags: string[] | null;
  cues: unknown;
  common_mistakes: unknown;
  default_sets: number;
  default_reps: string;
  rest_seconds: number;
  tempo: string | null;
  description: string | null;
  gif_url: string | null;
  video_url: string | null;
  video_title: string | null;
  video_fallback_text: string | null;
  video_provider: string | null;
  video_status: string | null;
  video_embed_url: string | null;
  binding_provider: string | null;
  binding_source_url: string | null;
  binding_embed_url: string | null;
  binding_title: string | null;
  binding_status: string | null;
  binding_fallback: string | null;
  published_use_count: string | number;
  archived_at: string | Date | null;
  is_active: boolean | null;
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

function mapDbError(error: unknown): never {
  const err = error as { code?: string; message?: string; statusCode?: number };
  if (err.statusCode) throw error;
  if (err.code === "23503") {
    throw Object.assign(new Error("Нарушена ссылочная целостность упражнения"), {
      statusCode: 400,
    });
  }
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ETIMEDOUT" ||
    err.code === "57P01" ||
    /connect ECONNREFUSED|timeout|PostgreSQL/i.test(String(err.message ?? ""))
  ) {
    throw Object.assign(new Error("PostgreSQL недоступен"), { statusCode: 503 });
  }
  throw error;
}

function mediaFromRow(row: ListedRow): {
  video_url: string | null;
  video_title: string | null;
  video_fallback_text: string | null;
  video_provider: ExerciseVideoProvider;
  video_status: ExerciseVideoStatus;
  video_embed_url: string | null;
} {
  const hasConfirmedBinding =
    Boolean(row.binding_source_url) && (row.binding_status ?? "unchecked") === "ok";
  if (hasConfirmedBinding) {
    const provider = (row.binding_provider ?? "none") as ExerciseVideoProvider;
    const status = (row.binding_status ?? "unchecked") as ExerciseVideoStatus;
    return {
      video_url: row.binding_source_url,
      video_title: row.binding_title,
      video_fallback_text: row.binding_fallback,
      video_provider:
        provider === "youtube" || provider === "rutube" || provider === "external"
          ? provider
          : "none",
      video_status:
        status === "ok" || status === "unavailable" || status === "unchecked"
          ? status
          : "unchecked",
      video_embed_url: row.binding_embed_url,
    };
  }
  const provider = (row.video_provider ?? "none") as ExerciseVideoProvider;
  const status = (row.video_status ?? (row.video_url ? "ok" : "unchecked")) as ExerciseVideoStatus;
  return {
    video_url: row.video_url,
    video_title: row.video_title,
    video_fallback_text: row.video_fallback_text,
    video_provider:
      provider === "youtube" || provider === "rutube" || provider === "external"
        ? provider
        : row.video_url
          ? "none"
          : "none",
    video_status:
      status === "ok" || status === "unavailable" || status === "unchecked" ? status : "unchecked",
    video_embed_url: row.video_embed_url,
  };
}

function mapRow(row: ListedRow): AdminExerciseRow {
  const media = mediaFromRow(row);
  const publishedUseCount = Number(row.published_use_count ?? 0);
  const hasWorkingLink =
    media.video_status === "ok" &&
    (media.video_provider === "youtube" || media.video_provider === "rutube");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    difficulty: row.difficulty,
    muscle_groups: asStringArray(row.muscle_groups),
    equipment: asStringArray(row.equipment),
    tags: asStringArray(row.tags),
    cues: asStringArray(row.cues),
    common_mistakes: asStringArray(row.common_mistakes),
    default_sets: Number(row.default_sets ?? 3),
    default_reps: String(row.default_reps ?? "10-12"),
    rest_seconds: Number(row.rest_seconds ?? 60),
    tempo: row.tempo,
    description: row.description,
    gif_url: row.gif_url,
    ...media,
    publishedUseCount,
    needsManualCheck:
      !hasWorkingLink ||
      media.video_status === "unchecked" ||
      (publishedUseCount > 0 && !hasWorkingLink),
    archived_at: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    is_active: row.is_active !== false && !row.archived_at,
  };
}

function toCatalogExercise(row: AdminExerciseRow): Exercise {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category as ExerciseCategory,
    muscle_groups: row.muscle_groups,
    equipment: row.equipment,
    difficulty: row.difficulty as Exercise["difficulty"],
    tags: row.tags,
    description: row.description,
    cues: row.cues,
    common_mistakes: row.common_mistakes,
    gif_url: row.gif_url,
    video_url: row.video_url,
    video: {
      provider: row.video_provider,
      url: row.video_url,
      embed_url: row.video_embed_url,
      title: row.video_title,
      status: row.video_status,
      fallback_text: row.video_fallback_text,
    },
    default_sets: row.default_sets,
    default_reps: row.default_reps,
    tempo: row.tempo,
    rest_seconds: row.rest_seconds,
  };
}

function videoFromInput(data: {
  video_url: string | null | undefined;
  video_title?: string | null;
  video_fallback_text?: string | null;
  video_status?: "ok" | "unavailable" | "unchecked" | null;
}): ExerciseVideo {
  if (data.video_url && data.video_url.trim()) {
    const video = requireYoutubeOrRutubeUrl(data.video_url);
    return {
      ...video,
      title: data.video_title ?? video.title,
      fallback_text: data.video_fallback_text ?? video.fallback_text,
      status: data.video_status ?? video.status,
    };
  }
  return {
    ...EMPTY_EXERCISE_VIDEO,
    title: data.video_title ?? null,
    fallback_text: data.video_fallback_text ?? null,
    status: data.video_status ?? "unchecked",
  };
}

const LIST_SQL = `
SELECT e.id, e.slug, e.name, e.category, e.difficulty, e.muscle_groups, e.equipment,
       e.tags, e.cues, e.common_mistakes,
       e.default_sets, e.default_reps, e.rest_seconds, e.tempo, e.description, e.gif_url,
       e.video_url, e.video_title, e.video_fallback_text, e.video_provider, e.video_status, e.video_embed_url,
       e.archived_at, e.is_active,
       b.provider AS binding_provider, b.source_url AS binding_source_url, b.embed_url AS binding_embed_url,
       b.title AS binding_title, b.status AS binding_status, b.fallback_text AS binding_fallback,
       (
         SELECT count(*)::int
         FROM public.training_program_versions v
         WHERE v.status = 'published'
           AND v.snapshot::text LIKE '%' || e.id::text || '%'
       ) AS published_use_count
  FROM public.exercises e
  LEFT JOIN public.exercise_media_bindings b ON b.exercise_id = e.id
`;

function mediaPredicate(filter: MediaFilter): string {
  switch (filter) {
    case "ok":
      return `(COALESCE(b.status, e.video_status, 'unchecked') = 'ok' AND COALESCE(b.provider, e.video_provider, 'none') IN ('youtube','rutube'))`;
    case "none":
      return `(b.exercise_id IS NULL AND (e.video_url IS NULL OR e.video_url = ''))`;
    case "unchecked":
      return `COALESCE(b.status, e.video_status, 'unchecked') = 'unchecked' AND COALESCE(b.source_url, e.video_url) IS NOT NULL AND COALESCE(b.source_url, e.video_url) <> ''`;
    case "unavailable":
      return `COALESCE(b.status, e.video_status) = 'unavailable'`;
    case "used":
      return `(
         SELECT count(*) FROM public.training_program_versions v
         WHERE v.status = 'published' AND v.snapshot::text LIKE '%' || e.id::text || '%'
       ) > 0`;
    default:
      return "TRUE";
  }
}

export class PostgresExerciseRepository implements ExerciseRepository {
  constructor(private readonly db: Pool) {}

  async list(): Promise<Exercise[]> {
    const { items } = await this.search({});
    return items.filter((row) => !row.archived_at).map(toCatalogExercise);
  }

  async search(input: { q?: string; category?: string; media?: MediaFilter } = {}): Promise<{
    items: AdminExerciseRow[];
    report: AdminExerciseReport;
  }> {
    try {
      const parsed = adminExerciseListQuerySchema.parse(input);
      const params: unknown[] = [];
      const where: string[] = [];
      if (parsed.category && parsed.category !== "all") {
        params.push(parsed.category);
        where.push(`e.category = $${params.length}`);
      }
      const q = parsed.q.trim();
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        where.push(
          `(lower(e.name) LIKE $${params.length} OR lower(e.slug) LIKE $${params.length} OR lower(array_to_string(e.muscle_groups, ',')) LIKE $${params.length})`,
        );
      }
      where.push(mediaPredicate(parsed.media));
      const sql = `${LIST_SQL} WHERE ${where.join(" AND ")} ORDER BY e.category, e.name`;
      const { rows } = await this.db.query(sql, params);
      const items = (rows as ListedRow[]).map(mapRow);
      const report = await this.report();
      return { items, report };
    } catch (error) {
      mapDbError(error);
    }
  }

  async report(): Promise<AdminExerciseReport> {
    try {
      const { rows } = await this.db.query(`
      SELECT
        count(*)::int AS all_count,
        count(*) FILTER (
          WHERE COALESCE(b.status, e.video_status, 'unchecked') = 'ok'
            AND COALESCE(b.provider, e.video_provider, 'none') IN ('youtube','rutube')
        )::int AS ok_count,
        count(*) FILTER (
          WHERE b.exercise_id IS NULL AND (e.video_url IS NULL OR e.video_url = '')
        )::int AS none_count,
        count(*) FILTER (
          WHERE COALESCE(b.status, e.video_status, 'unchecked') = 'unchecked'
            AND COALESCE(b.source_url, e.video_url) IS NOT NULL
            AND COALESCE(b.source_url, e.video_url) <> ''
        )::int AS unchecked_count,
        count(*) FILTER (
          WHERE COALESCE(b.status, e.video_status) = 'unavailable'
        )::int AS unavailable_count,
        count(*) FILTER (
          WHERE (
            SELECT count(*) FROM public.training_program_versions v
            WHERE v.status = 'published' AND v.snapshot::text LIKE '%' || e.id::text || '%'
          ) > 0
        )::int AS used_count
      FROM public.exercises e
      LEFT JOIN public.exercise_media_bindings b ON b.exercise_id = e.id
    `);
      const row = rows[0] as Record<string, number>;
      return {
        all: Number(row.all_count ?? 0),
        ok: Number(row.ok_count ?? 0),
        none: Number(row.none_count ?? 0),
        unchecked: Number(row.unchecked_count ?? 0),
        unavailable: Number(row.unavailable_count ?? 0),
        used: Number(row.used_count ?? 0),
      };
    } catch (error) {
      mapDbError(error);
    }
  }

  async get(id: string): Promise<AdminExerciseRow | null> {
    try {
      const { rows } = await this.db.query(`${LIST_SQL} WHERE e.id = $1`, [id]);
      const row = rows[0] as ListedRow | undefined;
      return row ? mapRow(row) : null;
    } catch (error) {
      mapDbError(error);
    }
  }

  async upsert(
    input: ExerciseUpsertInput,
    actorId?: string | null,
  ): Promise<{ id: string; video: ExerciseVideo }> {
    return this.save(adminExerciseUpsertSchema.parse(input), actorId ?? null);
  }

  async save(
    input: AdminExerciseUpsert,
    actorId: string | null,
  ): Promise<{ id: string; video: ExerciseVideo }> {
    try {
      const data = adminExerciseUpsertSchema.parse(input);
      const video = videoFromInput(data);

      const fields = [
        data.slug.trim(),
        data.name.trim(),
        data.category,
        data.difficulty,
        data.muscle_groups,
        data.equipment,
        data.default_sets,
        data.default_reps,
        data.rest_seconds,
        data.tempo,
        data.description,
        data.gif_url,
        video.url,
        video.provider,
        video.embed_url,
        video.title,
        video.status,
        video.fallback_text,
      ];

      let id = data.id ?? null;
      if (id) {
        const updated = await this.db.query(
          `UPDATE public.exercises SET
             slug=$2, name=$3, category=$4, difficulty=$5, muscle_groups=$6, equipment=$7,
             default_sets=$8, default_reps=$9, rest_seconds=$10, tempo=$11, description=$12, gif_url=$13,
             video_url=$14, video_provider=$15, video_embed_url=$16, video_title=$17, video_status=$18,
             video_fallback_text=$19, updated_at=(now() AT TIME ZONE 'utc')
           WHERE id=$1 RETURNING id`,
          [id, ...fields],
        );
        if (!updated.rowCount) {
          await this.db.query(
            `INSERT INTO public.exercises (
               id, slug, name, category, difficulty, muscle_groups, equipment,
               default_sets, default_reps, rest_seconds, tempo, description, gif_url,
               video_url, video_provider, video_embed_url, video_title, video_status, video_fallback_text
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
            [id, ...fields],
          );
        }
      } else {
        const inserted = await this.db.query(
          `INSERT INTO public.exercises (
             slug, name, category, difficulty, muscle_groups, equipment,
             default_sets, default_reps, rest_seconds, tempo, description, gif_url,
             video_url, video_provider, video_embed_url, video_title, video_status, video_fallback_text
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          fields,
        );
        id = (inserted.rows[0] as { id: string }).id;
      }

      if (!video.url) {
        await this.deleteBinding(id, actorId);
      } else {
        const binding: ExerciseMediaBinding = {
          exercise_id: id,
          provider: video.provider,
          source_url: video.url,
          embed_url: video.embed_url,
          title: video.title,
          status: video.status,
          fallback_text: video.fallback_text,
        };
        await upsertExerciseMediaBinding(this.db, binding, actorId);
      }
      return { id, video };
    } catch (error) {
      mapDbError(error);
    }
  }

  async setMedia(
    input: z.infer<typeof adminExerciseMediaSchema>,
    actorId: string | null,
  ): Promise<{ id: string; video: ExerciseVideo }> {
    const data = adminExerciseMediaSchema.parse(input);
    const existing = await this.get(data.exercise_id);
    if (!existing) throw Object.assign(new Error("Упражнение не найдено"), { statusCode: 404 });
    return this.save(
      {
        id: data.exercise_id,
        slug: existing.slug,
        name: existing.name,
        category: existing.category,
        difficulty: existing.difficulty,
        muscle_groups: existing.muscle_groups,
        equipment: existing.equipment,
        default_sets: existing.default_sets,
        default_reps: existing.default_reps,
        rest_seconds: existing.rest_seconds,
        tempo: existing.tempo,
        description: existing.description,
        gif_url: existing.gif_url,
        video_url: data.video_url ?? null,
        video_title: data.video_title,
        video_fallback_text: data.video_fallback_text,
        video_status: data.video_status,
      },
      actorId,
    );
  }

  async remove(id: string, _actorId?: string | null): Promise<void> {
    try {
      const used = await this.get(id);
      if (!used) throw Object.assign(new Error("Упражнение не найдено"), { statusCode: 404 });
      await this.db.query(
        `UPDATE public.exercises SET
           archived_at = COALESCE(archived_at, (now() AT TIME ZONE 'utc')),
           is_active = false,
           updated_at = (now() AT TIME ZONE 'utc')
         WHERE id = $1`,
        [id],
      );
    } catch (error) {
      mapDbError(error);
    }
  }

  async restore(id: string): Promise<void> {
    try {
      const updated = await this.db.query(
        `UPDATE public.exercises SET
           archived_at = NULL,
           is_active = true,
           updated_at = (now() AT TIME ZONE 'utc')
         WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!updated.rowCount)
        throw Object.assign(new Error("Упражнение не найдено"), { statusCode: 404 });
    } catch (error) {
      mapDbError(error);
    }
  }

  async deleteBinding(exerciseId: string, actorId: string | null): Promise<void> {
    try {
      const existing = await this.db.query(
        `SELECT source_url FROM public.exercise_media_bindings WHERE exercise_id = $1`,
        [exerciseId],
      );
      const oldUrl = (existing.rows[0] as { source_url?: string } | undefined)?.source_url ?? null;
      await this.db.query(`DELETE FROM public.exercise_media_bindings WHERE exercise_id = $1`, [
        exerciseId,
      ]);
      await this.db.query(
        `UPDATE public.exercises SET
           video_url=NULL, video_provider='none', video_embed_url=NULL, video_status='unchecked',
           updated_at=(now() AT TIME ZONE 'utc')
         WHERE id=$1`,
        [exerciseId],
      );
      if (oldUrl) {
        await this.db.query(
          `INSERT INTO public.exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
           VALUES ($1,$2,NULL,$3)`,
          [exerciseId, oldUrl, actorId],
        );
      }
    } catch (error) {
      mapDbError(error);
    }
  }
}
