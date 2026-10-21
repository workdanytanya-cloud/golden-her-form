import type { Pool, PoolClient } from "pg";
import { formatRuDate, parseISODate } from "@/lib/client-courses/format";
import type { ClientCourse } from "@/lib/client-courses/repo";
import {
  applyMediaOverlayToExercises,
  bindingToVideo,
  mediaExerciseIdsFromBindings,
  overlayVideosForSnapshot,
  type ExerciseMediaBinding,
  type SnapshotExerciseMediaBinding,
} from "@/lib/selfhost/media";
import type {
  PdfAccessMeta,
  PublishedNutritionRecord,
  PublishedProgramRepository,
  PublishedTrainingRecord,
} from "@/lib/platform/types";
import type { Exercise } from "@/lib/training";
import type { DayRow as TrainingDayRow, ProgramRow } from "@/lib/training-repo";
import {
  exercisesFromTrainingSnapshot,
  programDaysFromSnapshot,
} from "@/lib/published-programs/training-snapshot";
import type {
  NutritionSnapshot,
  TrainingSnapshot,
  VersionMeta,
} from "@/lib/published-programs/types";
import type { PublishedNutritionView, PublishedTrainingView } from "@/lib/published-programs/repo";

type Queryable = Pool | PoolClient;

function mapVersion(row: Record<string, unknown>): VersionMeta {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    version: Number(row.version),
    status: row.status as VersionMeta["status"],
    content_hash: String(row.content_hash),
    parent_version_id: (row.parent_version_id as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
    created_by: (row.created_by as string | null) ?? null,
    published_at: row.published_at
      ? new Date(row.published_at as string | Date).toISOString()
      : null,
    published_by: (row.published_by as string | null) ?? null,
  };
}

export async function loadMediaBindings(
  db: Queryable,
  exerciseIds: string[],
): Promise<Map<string, ExerciseMediaBinding>> {
  const map = new Map<string, ExerciseMediaBinding>();
  if (exerciseIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT exercise_id, provider, source_url, embed_url, title, status, fallback_text
     FROM public.exercise_media_bindings WHERE exercise_id = ANY($1::uuid[])`,
    [exerciseIds],
  );
  for (const row of rows as ExerciseMediaBinding[]) {
    if (row.source_url && row.status === "ok") map.set(row.exercise_id, row);
  }
  const missing = exerciseIds.filter((id) => !map.has(id));
  if (missing.length) {
    const unmatched = await db.query(
      `SELECT original_exercise_id AS exercise_id, provider, source_url, embed_url, title, status, fallback_text
         FROM public.unmatched_exercise_media
        WHERE original_exercise_id = ANY($1::uuid[])
          AND resolved_exercise_id IS NULL
          AND source_url IS NOT NULL
          AND source_url <> ''`,
      [missing],
    );
    for (const row of unmatched.rows as ExerciseMediaBinding[]) {
      if (row.source_url && row.status === "ok") map.set(row.exercise_id, row);
    }
  }
  const stillMissing = exerciseIds.filter((id) => !map.has(id));
  if (stillMissing.length) {
    const legacy = await db.query(
      `SELECT id, video_url, video_provider, video_embed_url, video_title, video_status, video_fallback_text
         FROM public.exercises
        WHERE id = ANY($1::uuid[])
          AND video_url IS NOT NULL
          AND video_url <> ''`,
      [stillMissing],
    );
    const { normalizeExerciseVideo } = await import("@/lib/exercise-video");
    const { isExternalStorageMediaUrl } = await import("@/lib/selfhost/media-url-compat");
    for (const row of legacy.rows as Array<{
      id: string;
      video_url: string;
      video_provider: string | null;
      video_embed_url: string | null;
      video_title: string | null;
      video_status: string | null;
      video_fallback_text: string | null;
    }>) {
      // Broken Supabase Storage links (402) must not hide real bindings/sheet overlay.
      if (isExternalStorageMediaUrl(row.video_url)) continue;
      const video = normalizeExerciseVideo({
        video_url: row.video_url,
        video_provider: row.video_provider,
        video_embed_url: row.video_embed_url,
        video_title: row.video_title,
        video_status: row.video_status,
        video_fallback_text: row.video_fallback_text,
      });
      if (!video.url || video.status === "unavailable") continue;
      map.set(row.id, {
        exercise_id: row.id,
        provider: video.provider,
        source_url: video.url,
        embed_url: video.embed_url,
        title: video.title,
        status: video.status,
        fallback_text: video.fallback_text,
      });
    }
  }
  return map;
}

export async function loadSnapshotMediaBindings(
  db: Queryable,
  versionId: string,
): Promise<SnapshotExerciseMediaBinding[]> {
  const { rows } = await db.query(
    `SELECT version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer
     FROM public.snapshot_exercise_media_bindings WHERE version_id = $1`,
    [versionId],
  );
  return rows as SnapshotExerciseMediaBinding[];
}

async function loadAssignmentVersionId(
  db: Queryable,
  clientId: string,
  kind: "nutrition" | "training",
  courseId?: string | null,
): Promise<string | null> {
  if (courseId) {
    const { rows } = await db.query(
      `SELECT active_version_id FROM public.client_program_assignments
       WHERE client_id = $1 AND kind = $2 AND course_id = $3`,
      [clientId, kind, courseId],
    );
    return (rows[0] as { active_version_id: string } | undefined)?.active_version_id ?? null;
  }
  const { rows } = await db.query(
    `SELECT a.active_version_id
     FROM public.client_program_assignments a
     LEFT JOIN public.client_courses c ON c.id = a.course_id
     WHERE a.client_id = $1 AND a.kind = $2
     ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.start_date DESC NULLS LAST, a.updated_at DESC
     LIMIT 1`,
    [clientId, kind],
  );
  return (rows[0] as { active_version_id: string } | undefined)?.active_version_id ?? null;
}

export async function getActivePublishedNutritionPg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<PublishedNutritionRecord | null> {
  const versionId = await loadAssignmentVersionId(db, clientId, "nutrition", courseId);
  if (!versionId) return null;
  const { rows } = await db.query(
    `SELECT * FROM public.nutrition_plan_versions
      WHERE id = $1 AND client_id = $2
        AND status IN ('published', 'superseded')`,
    [versionId, clientId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    source: "published",
    snapshot: row.snapshot as NutritionSnapshot,
    version: mapVersion(row),
  };
}

export async function getActivePublishedTrainingPg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<PublishedTrainingRecord | null> {
  const versionId = await loadAssignmentVersionId(db, clientId, "training", courseId);
  if (!versionId) return null;
  const { rows } = await db.query(
    `SELECT * FROM public.training_program_versions
      WHERE id = $1 AND client_id = $2
        AND status IN ('published', 'superseded')`,
    [versionId, clientId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    source: "published",
    snapshot: row.snapshot as TrainingSnapshot,
    version: mapVersion(row),
  };
}

export async function toPublishedNutritionView(
  record: PublishedNutritionRecord | null,
): Promise<PublishedNutritionView | null> {
  if (!record) return null;
  // Display-time rewrite of mirrored external media URLs. Stored snapshot + content_hash unchanged.
  const { rewriteMediaUrlsInJson } = await import("@/lib/selfhost/media-url-compat");
  return {
    version: record.version,
    snapshot: rewriteMediaUrlsInJson(record.snapshot),
    source: "published",
  };
}

export async function toPublishedTrainingView(
  db: Queryable,
  record: PublishedTrainingRecord | null,
): Promise<PublishedTrainingView | null> {
  if (!record) return null;
  const snapshot = record.snapshot;
  const snapshotBindings = await loadSnapshotMediaBindings(db, record.version.id);
  const byExerciseId = await loadMediaBindings(
    db,
    mediaExerciseIdsFromBindings(snapshot, snapshotBindings),
  );
  const overlay = overlayVideosForSnapshot({ snapshot, byExerciseId, snapshotBindings });
  const exercises: Exercise[] = applyMediaOverlayToExercises(
    snapshot,
    exercisesFromTrainingSnapshot(snapshot),
    overlay,
  );
  const daysRaw = programDaysFromSnapshot(snapshot);
  const program: ProgramRow = {
    id: record.version.id,
    user_id: record.version.client_id,
    sessions_per_week: snapshot.sessions_per_week,
    goal: snapshot.goal,
    level: snapshot.level,
    has_injuries: snapshot.has_injuries,
    injuries_details: snapshot.injuries_details,
    equipment: snapshot.equipment,
    location: snapshot.location,
    notes: snapshot.notes,
    faq: (snapshot.faq as ProgramRow["faq"]) ?? [],
    targets_manual: true,
    program_weeks: snapshot.program_weeks,
  };
  const days: TrainingDayRow[] = daysRaw.map((d, i) => ({
    id: `${record.version.id}-${i}`,
    program_id: record.version.id,
    week_index: d.week_index ?? 0,
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
  return {
    version: record.version,
    snapshot,
    program,
    days,
    exercises,
    source: "published",
  };
}

export async function getPdfAccessMetaPg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<PdfAccessMeta> {
  const profile = await db.query(`SELECT full_name FROM public.profiles WHERE id = $1`, [clientId]);
  const clientName =
    ((profile.rows[0] as { full_name?: string } | undefined)?.full_name ?? "").trim() || "Клиент";

  const course = courseId
    ? await db.query(
        `SELECT title, start_date, end_date FROM public.client_courses WHERE id = $1 AND client_id = $2`,
        [courseId, clientId],
      )
    : await db.query(
        `SELECT title, start_date, end_date FROM public.client_courses
         WHERE client_id = $1 ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date DESC LIMIT 1`,
        [clientId],
      );
  const row = course.rows[0] as
    { title?: string; start_date?: string; end_date?: string } | undefined;
  const start = row?.start_date
    ? formatRuDate(parseISODate(String(row.start_date).slice(0, 10)))
    : "—";
  const end = row?.end_date ? formatRuDate(parseISODate(String(row.end_date).slice(0, 10))) : "—";
  return {
    clientName,
    courseTitle: row?.title?.trim() || "Курс",
    courseStart: start,
    courseEnd: end,
  };
}

export async function listClientCoursesPg(
  db: Queryable,
  clientId: string,
): Promise<ClientCourse[]> {
  const { rows } = await db.query(
    `SELECT id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes, program_scope
     FROM public.client_courses WHERE client_id = $1 ORDER BY start_date DESC`,
    [clientId],
  );
  return rows.map((row) => ({
    id: row.id,
    client_id: row.client_id,
    title: row.title,
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    created_by: row.created_by,
    notes: row.notes,
    program_scope: row.program_scope ?? "both",
  }));
}

export async function getClientAccessPg(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT status, unlock_source FROM public.client_access WHERE user_id = $1`,
    [userId],
  );
  return (rows[0] as { status: string; unlock_source: string | null } | undefined) ?? null;
}

export async function getProfilePg(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT id, full_name, phone, goal, height_cm, birth_date::text AS birth_date, gender
       FROM public.profiles WHERE id = $1`,
    [userId],
  );
  return (
    (rows[0] as
      | {
          id: string;
          full_name: string | null;
          phone: string | null;
          goal: string | null;
          height_cm: number | null;
          birth_date: string | null;
          gender: string | null;
        }
      | undefined) ?? null
  );
}

export async function getDashboardOverviewPg(db: Queryable, userId: string) {
  const [profile, access, onboarding, measurements, notif] = await Promise.all([
    getProfilePg(db, userId),
    getClientAccessPg(db, userId),
    db.query(`SELECT completed_at FROM public.onboarding_responses WHERE user_id = $1`, [userId]),
    db.query(
      `SELECT id, measured_on, weight_kg, waist_cm
         FROM public.measurements
        WHERE user_id = $1
        ORDER BY measured_on DESC, created_at DESC
        LIMIT 5`,
      [userId],
    ),
    db.query(
      `SELECT id, message
         FROM public.client_notifications
        WHERE user_id = $1 AND type = 'access_granted' AND is_read = false
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    ),
  ]);
  const onboardingRow = onboarding.rows[0] as { completed_at?: string | Date | null } | undefined;
  return {
    profile,
    access,
    onboardingDone: Boolean(onboardingRow?.completed_at),
    measurements: measurements.rows.map((row) => {
      const r = row as {
        id: string;
        measured_on: string | Date;
        weight_kg: number | string | null;
        waist_cm: number | string | null;
      };
      return {
        id: r.id,
        measured_on:
          r.measured_on instanceof Date
            ? r.measured_on.toISOString().slice(0, 10)
            : String(r.measured_on).slice(0, 10),
        weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
        waist_cm: r.waist_cm == null ? null : Number(r.waist_cm),
      };
    }),
    accessNotif: (notif.rows[0] as { id: string; message: string } | undefined) ?? null,
  };
}

export async function upsertExerciseMediaBinding(
  db: Queryable,
  binding: ExerciseMediaBinding,
  changedBy: string | null,
): Promise<void> {
  const existing = await db.query(
    `SELECT source_url FROM public.exercise_media_bindings WHERE exercise_id = $1`,
    [binding.exercise_id],
  );
  const oldUrl = (existing.rows[0] as { source_url?: string } | undefined)?.source_url ?? null;
  await db.query(
    `INSERT INTO public.exercise_media_bindings
      (exercise_id, provider, source_url, embed_url, title, status, fallback_text, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (exercise_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       source_url = EXCLUDED.source_url,
       embed_url = EXCLUDED.embed_url,
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       fallback_text = EXCLUDED.fallback_text,
       updated_by = EXCLUDED.updated_by`,
    [
      binding.exercise_id,
      binding.provider,
      binding.source_url,
      binding.embed_url,
      binding.title,
      binding.status,
      binding.fallback_text,
      changedBy,
    ],
  );
  if (oldUrl !== binding.source_url) {
    await db.query(
      `INSERT INTO public.exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
       VALUES ($1,$2,$3,$4)`,
      [binding.exercise_id, oldUrl, binding.source_url, changedBy],
    );
  }
}

export function videoOverlayFromBindings(
  snapshot: TrainingSnapshot,
  byExerciseId: Map<string, ExerciseMediaBinding>,
  snapshotBindings: SnapshotExerciseMediaBinding[],
): Map<string, ReturnType<typeof bindingToVideo>> {
  return overlayVideosForSnapshot({ snapshot, byExerciseId, snapshotBindings });
}

export class PostgresPublishedProgramRepository implements PublishedProgramRepository {
  constructor(private readonly db: Queryable) {}

  getActivePublishedNutrition(clientId: string, courseId?: string | null) {
    return getActivePublishedNutritionPg(this.db, clientId, courseId);
  }

  getActivePublishedTraining(clientId: string, courseId?: string | null) {
    return getActivePublishedTrainingPg(this.db, clientId, courseId);
  }

  getPdfAccessMeta(clientId: string, courseId?: string | null) {
    return getPdfAccessMetaPg(this.db, clientId, courseId);
  }
}
