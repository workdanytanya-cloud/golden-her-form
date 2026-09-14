import type { PoolClient } from "pg";
import { resolveSetExerciseId, summarizeSnapshotExerciseIds } from "@/lib/selfhost/media";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import type { FrozenExerciseSet, TrainingSnapshot } from "@/lib/published-programs/types";
import {
  ImportAbortError,
  assignmentRowSchema,
  canonicalClientExportSchema,
  courseRowSchema,
  emergencyClientExportSchema,
  isEmergencyExport,
  stripActorFields,
  versionRowSchema,
} from "@/lib/selfhost/export-schema";

export { ImportAbortError };

const PLACEHOLDER_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const PROFILE_COLUMNS = [
  "full_name",
  "avatar_url",
  "phone",
  "birth_date",
  "gender",
  "goal",
  "height_cm",
] as const;

export type ClientExport = {
  matchCount?: number;
  user: {
    id?: string;
    email: string;
    password_hash?: string | null;
    email_verified_at?: string | null;
    status?: string;
    created_at?: string;
    updated_at?: string;
  };
  roles?: Array<"admin" | "client">;
  profile?: Record<string, unknown> | null;
  access?: Record<string, unknown> | null;
  courses?: Array<Record<string, unknown>>;
  nutrition_versions?: Array<Record<string, unknown>>;
  training_versions?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  exercise_media_bindings?: Array<Record<string, unknown>>;
  snapshot_exercise_media_bindings?: Array<Record<string, unknown>>;
};

export type ImportClientSummary = {
  email: string;
  userId: string;
  courses: number;
  nutritionVersions: number;
  trainingVersions: number;
  assignments: number;
  contentHashes: string[];
  trainingExerciseStats: Array<{
    total: number;
    withExerciseId: number;
    needingManualMatch: number;
    uniqueTotal: number;
    uniqueWithExerciseId: number;
    uniqueNeedingManualMatch: number;
    confirmedExternalVideos: number;
  }>;
  skippedPublishedSnapshots: number;
  emailMissing: boolean;
};

export type ImportRunReport = {
  dryRun: boolean;
  matchCount: number;
  clients: ImportClientSummary[];
  failed: Array<{ error: string }>;
};

export type ImportOptions = {
  dryRun?: boolean;
  email?: string;
};

function rejectPlaintextPassword(input: unknown, label: string): void {
  if (!input || typeof input !== "object") return;
  const obj = input as Record<string, unknown>;
  for (const key of ["password", "plaintext_password", "plain_password", "new_password"]) {
    if (typeof obj[key] === "string" && obj[key]) {
      throw new ImportAbortError(`${label}: plaintext-пароль в экспорте запрещён`);
    }
  }
  if (obj.user && typeof obj.user === "object") {
    rejectPlaintextPassword(obj.user, `${label}.user`);
  }
}

function asUuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function coerceSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  if (typeof copy.snapshot === "string") {
    try {
      copy.snapshot = JSON.parse(copy.snapshot) as unknown;
    } catch {
      throw new ImportAbortError("snapshot не является JSON");
    }
  }
  return copy;
}

function uniqueExerciseStats(snapshot: TrainingSnapshot): {
  uniqueTotal: number;
  uniqueWithExerciseId: number;
  uniqueNeedingManualMatch: number;
} {
  const seen = new Set<string>();
  let uniqueWithExerciseId = 0;
  const walk = (sets: FrozenExerciseSet[]) => {
    for (const set of sets) {
      const ex = set.exercise;
      const key = resolveSetExerciseId(set) ?? (ex ? `${ex.slug}:${ex.name}` : JSON.stringify(set));
      if (seen.has(key)) continue;
      seen.add(key);
      if (resolveSetExerciseId(set)) uniqueWithExerciseId += 1;
    }
  };
  for (const day of snapshot.days ?? []) {
    walk(day.warmup);
    walk(day.exercises);
    walk(day.cooldown);
  }
  return {
    uniqueTotal: seen.size,
    uniqueWithExerciseId,
    uniqueNeedingManualMatch: seen.size - uniqueWithExerciseId,
  };
}

function countConfirmedExternalVideos(snapshot: TrainingSnapshot): number {
  const seen = new Set<string>();
  let count = 0;
  const walk = (sets: FrozenExerciseSet[]) => {
    for (const set of sets) {
      const ex = set.exercise;
      if (!ex) continue;
      const key = ex.id || `${ex.slug}:${ex.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const video = normalizeExerciseVideo({
        video_url: ex.video_url,
        video: ex.video,
      });
      if (
        video.status === "ok" &&
        video.url &&
        (video.provider === "youtube" || video.provider === "rutube")
      ) {
        count += 1;
      }
    }
  };
  for (const day of snapshot.days ?? []) {
    walk(day.warmup);
    walk(day.exercises);
    walk(day.cooldown);
  }
  return count;
}

function trainingStats(row: Record<string, unknown>) {
  const snapshot = row.snapshot as TrainingSnapshot;
  const summary = snapshot?.days
    ? summarizeSnapshotExerciseIds(snapshot)
    : { total: 0, withExerciseId: 0, needingManualMatch: 0 };
  const unique = snapshot?.days
    ? uniqueExerciseStats(snapshot)
    : { uniqueTotal: 0, uniqueWithExerciseId: 0, uniqueNeedingManualMatch: 0 };
  return {
    ...summary,
    ...unique,
    confirmedExternalVideos: snapshot?.days ? countConfirmedExternalVideos(snapshot) : 0,
  };
}

export function normalizeExportPayload(raw: unknown, options: ImportOptions = {}): ClientExport[] {
  if (Array.isArray(raw)) {
    return raw.map((item, i) => normalizeOne(item, `clients[${i}]`, options));
  }
  if (!raw || typeof raw !== "object") {
    throw new ImportAbortError("Экспорт должен быть JSON-объектом или массивом");
  }
  const root = raw as Record<string, unknown>;
  rejectPlaintextPassword(root, "корень экспорта");
  if (Array.isArray(root.clients)) {
    return root.clients.map((item, i) => normalizeOne(item, `clients[${i}]`, options));
  }
  return [normalizeOne(raw, "client", options)];
}

function fromEmergency(raw: unknown, label: string, options: ImportOptions): ClientExport {
  const parsed = emergencyClientExportSchema.parse(raw);
  const nutrition = parsed.published_nutrition
    ? coerceSnapshot(stripActorFields(versionRowSchema.parse(parsed.published_nutrition) as Record<string, unknown>))
    : null;
  const training = parsed.published_training
    ? coerceSnapshot(stripActorFields(versionRowSchema.parse(parsed.published_training) as Record<string, unknown>))
    : null;
  const course = parsed.active_course
    ? stripActorFields(courseRowSchema.parse(parsed.active_course) as Record<string, unknown>)
    : null;
  const clientId =
    asUuid(course?.client_id) ??
    asUuid(nutrition?.client_id) ??
    asUuid(training?.client_id);
  if (!clientId) throw new ImportAbortError(`${label}: нет client_id`);
  const assignments: Record<string, unknown>[] = [];
  if (parsed.assignments?.nutrition) {
    assignments.push(
      stripActorFields(assignmentRowSchema.parse(parsed.assignments.nutrition) as Record<string, unknown>),
    );
  }
  if (parsed.assignments?.training) {
    assignments.push(
      stripActorFields(assignmentRowSchema.parse(parsed.assignments.training) as Record<string, unknown>),
    );
  }
  const email = options.email?.trim().toLowerCase() ?? "";
  return {
    matchCount: parsed.match_count ?? 1,
    user: {
      id: clientId,
      email,
      password_hash: null,
      status: "active",
    },
    roles: ["client"],
    profile: parsed.profile ? stripActorFields({ ...parsed.profile }) : null,
    access: parsed.client_access ? stripActorFields({ ...parsed.client_access }) : null,
    courses: course ? [course] : [],
    nutrition_versions: nutrition ? [nutrition] : [],
    training_versions: training ? [training] : [],
    assignments,
  };
}

function normalizeOne(raw: unknown, label: string, options: ImportOptions = {}): ClientExport {
  if (!raw || typeof raw !== "object") throw new ImportAbortError(`${label}: ожидался объект`);
  rejectPlaintextPassword(raw, label);
  if (isEmergencyExport(raw)) {
    return fromEmergency(raw, label, options);
  }
  const parsed = canonicalClientExportSchema.parse(raw);
  const obj = parsed as Record<string, unknown>;
  const userRaw = (parsed.user && typeof parsed.user === "object" ? parsed.user : obj) as Record<string, unknown>;
  rejectPlaintextPassword(userRaw, `${label}.user`);
  const email = (options.email ?? String(userRaw.email ?? parsed.email ?? "")).trim().toLowerCase();
  const nutrition = (parsed.nutrition_versions ?? parsed.nutrition_plan_versions ?? []).map((row) =>
    coerceSnapshot(stripActorFields(row as Record<string, unknown>)),
  );
  const training = (parsed.training_versions ?? parsed.training_program_versions ?? []).map((row) =>
    coerceSnapshot(stripActorFields(row as Record<string, unknown>)),
  );
  const courses = (parsed.courses ?? parsed.client_courses ?? []).map((row) =>
    stripActorFields(row as Record<string, unknown>),
  );
  const assignments = (parsed.assignments ?? parsed.client_program_assignments ?? []).map((row) =>
    stripActorFields(row as Record<string, unknown>),
  );
  return {
    matchCount: 1,
    user: {
      id: asUuid(userRaw.id) ?? undefined,
      email,
      password_hash: typeof userRaw.password_hash === "string" ? userRaw.password_hash : null,
      email_verified_at: (userRaw.email_verified_at as string | null) ?? null,
      status: typeof userRaw.status === "string" ? userRaw.status : "active",
    },
    roles: parsed.roles ?? ["client"],
    profile: parsed.profile ? stripActorFields({ ...parsed.profile }) : null,
    access: parsed.access
      ? stripActorFields({ ...parsed.access })
      : parsed.client_access
        ? stripActorFields({ ...parsed.client_access })
        : null,
    courses,
    nutrition_versions: nutrition,
    training_versions: training,
    assignments,
    exercise_media_bindings: parsed.exercise_media_bindings,
    snapshot_exercise_media_bindings: parsed.snapshot_exercise_media_bindings,
  };
}

async function upsertUser(client: PoolClient, data: ClientExport["user"]): Promise<string> {
  const email = data.email.trim().toLowerCase();
  const hash = data.password_hash && data.password_hash.length > 0 ? data.password_hash : PLACEHOLDER_HASH;
  if (data.id) {
    await client.query(
      `INSERT INTO public.users (id, email, password_hash, email_verified_at, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         email_verified_at = COALESCE(EXCLUDED.email_verified_at, public.users.email_verified_at),
         status = EXCLUDED.status`,
      [data.id, email, hash, data.email_verified_at, data.status ?? "active"],
    );
    return data.id;
  }
  const found = await client.query(`SELECT id FROM public.users WHERE email = $1`, [email]);
  if (found.rows[0]) return found.rows[0].id as string;
  const inserted = await client.query(
    `INSERT INTO public.users (email, password_hash, email_verified_at, status)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, hash, data.email_verified_at, data.status ?? "active"],
  );
  return inserted.rows[0].id as string;
}

async function upsertVersion(
  client: PoolClient,
  table: "nutrition_plan_versions" | "training_program_versions",
  userId: string,
  row: Record<string, unknown>,
): Promise<{ id: string; skipped: boolean; contentHash: string }> {
  const id = asUuid(row.id);
  if (!id) throw new ImportAbortError(`${table}: версия без UUID`);
  const contentHash = String(row.content_hash ?? "");
  if (!contentHash) throw new ImportAbortError(`${table} ${id}: нет content_hash`);
  if (!row.snapshot) throw new ImportAbortError(`${table} ${id}: нет snapshot`);
  const status = String(row.status ?? "published");
  const version = Number(row.version ?? 1);
  const courseId = asUuid(row.course_id);
  const snapshotJson = JSON.stringify(row.snapshot);
  let parentVersionId = asUuid(row.parent_version_id);
  if (parentVersionId) {
    const parent = await client.query(`SELECT id FROM public.${table} WHERE id = $1`, [parentVersionId]);
    if (!parent.rowCount) parentVersionId = null;
  }

  const existing = await client.query(
    `SELECT content_hash, status FROM public.${table} WHERE id = $1`,
    [id],
  );
  if (existing.rows[0]) {
    const prev = existing.rows[0] as { content_hash: string; status: string };
    if (prev.content_hash !== contentHash) {
      throw new ImportAbortError(
        `${table} ${id}: content_hash не совпадает (импорт остановлен, snapshot не изменён)`,
      );
    }
    return { id, skipped: true, contentHash };
  }

  await client.query(
    `INSERT INTO public.${table}
      (id, client_id, course_id, version, status, snapshot, content_hash, parent_version_id, published_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      id,
      asUuid(row.client_id) ?? userId,
      courseId,
      version,
      status,
      snapshotJson,
      contentHash,
      parentVersionId,
      row.published_at ?? null,
    ],
  );
  return { id, skipped: false, contentHash };
}

export async function importOneClient(
  client: PoolClient | null,
  data: ClientExport,
  dryRun: boolean,
): Promise<ImportClientSummary> {
  if (dryRun) {
    const hashes = [
      ...(data.nutrition_versions ?? []).map((v) => String(v.content_hash ?? "")),
      ...(data.training_versions ?? []).map((v) => String(v.content_hash ?? "")),
    ].filter(Boolean);
    return {
      email: data.user.email,
      userId: data.user.id ?? "(dry-run)",
      courses: data.courses?.length ?? 0,
      nutritionVersions: data.nutrition_versions?.length ?? 0,
      trainingVersions: data.training_versions?.length ?? 0,
      assignments: data.assignments?.length ?? 0,
      contentHashes: hashes,
      trainingExerciseStats: (data.training_versions ?? []).map((row) => trainingStats(row)),
      skippedPublishedSnapshots: 0,
      emailMissing: !data.user.email,
    };
  }

  if (!data.user.email) {
    throw new ImportAbortError("Для импорта нужен --email: в экспорте нет адреса");
  }
  if (!client) {
    throw new ImportAbortError("Нет подключения к PostgreSQL");
  }

  const userId = await upsertUser(client, data.user);
  for (const role of data.roles ?? ["client"]) {
    await client.query(
      `INSERT INTO public.user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [userId, role],
    );
  }
  if (data.profile) {
    await client.query(
      `INSERT INTO public.profiles (id, full_name, avatar_url, phone, birth_date, gender, goal, height_cm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
         phone = COALESCE(EXCLUDED.phone, public.profiles.phone)`,
      [
        asUuid(data.profile.id) ?? userId,
        data.profile.full_name ?? null,
        data.profile.avatar_url ?? null,
        data.profile.phone ?? null,
        data.profile.birth_date ?? null,
        data.profile.gender ?? null,
        data.profile.goal ?? null,
        data.profile.height_cm ?? null,
      ],
    );
  } else {
    await client.query(`INSERT INTO public.profiles (id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  }

  if (data.access) {
    await client.query(
      `INSERT INTO public.client_access (user_id, status, unlock_source, notes, activated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         unlock_source = EXCLUDED.unlock_source`,
      [
        userId,
        data.access.status ?? "active",
        data.access.unlock_source ?? null,
        data.access.notes ?? null,
        data.access.activated_at ?? null,
      ],
    );
  }

  const courses = data.courses ?? [];
  const activeCourses = courses.filter((course) => (course.status ?? "active") === "active");
  if (activeCourses.length > 1) {
    throw new ImportAbortError(
      `Несколько active-курсов у ${data.user.email}: требуется явное решение (${activeCourses.length})`,
    );
  }
  for (const course of courses) {
    const id = asUuid(course.id);
    if (!id) throw new ImportAbortError("курс без UUID");
    await client.query(
      `INSERT INTO public.client_courses (id, client_id, title, start_date, end_date, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         status = EXCLUDED.status`,
      [
        id,
        asUuid(course.client_id) ?? userId,
        course.title ?? "Курс",
        course.start_date,
        course.end_date,
        course.status ?? "active",
        course.notes ?? null,
      ],
    );
  }

  let skippedPublishedSnapshots = 0;
  const hashes: string[] = [];
  const stats: ImportClientSummary["trainingExerciseStats"] = [];

  for (const row of data.nutrition_versions ?? []) {
    const result = await upsertVersion(client, "nutrition_plan_versions", userId, row);
    hashes.push(result.contentHash);
    if (result.skipped) skippedPublishedSnapshots += 1;
  }
  for (const row of data.training_versions ?? []) {
    const result = await upsertVersion(client, "training_program_versions", userId, row);
    hashes.push(result.contentHash);
    if (result.skipped) skippedPublishedSnapshots += 1;
    stats.push(trainingStats(row));
  }

  for (const row of data.assignments ?? []) {
    const id = asUuid(row.id);
    await client.query(
      `INSERT INTO public.client_program_assignments (id, client_id, kind, course_id, active_version_id)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
       ON CONFLICT (client_id, kind, course_id) DO UPDATE SET
         active_version_id = EXCLUDED.active_version_id`,
      [
        id,
        asUuid(row.client_id) ?? userId,
        row.kind,
        asUuid(row.course_id),
        row.active_version_id,
      ],
    );
  }

  for (const row of data.exercise_media_bindings ?? []) {
    const exerciseId = asUuid(row.exercise_id);
    if (!exerciseId) continue;
    const exists = await client.query(`SELECT 1 FROM public.exercises WHERE id = $1`, [exerciseId]);
    if (!exists.rowCount) {
      await client.query(
        `INSERT INTO public.unmatched_exercise_media
          (original_exercise_id, provider, source_url, embed_url, title, status, fallback_text, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'import')
         ON CONFLICT (original_exercise_id) DO NOTHING`,
        [
          exerciseId,
          row.provider ?? "none",
          row.source_url ?? row.url ?? null,
          row.embed_url ?? null,
          row.title ?? null,
          row.status ?? "unchecked",
          row.fallback_text ?? null,
        ],
      );
      continue;
    }
    await client.query(
      `INSERT INTO public.exercise_media_bindings
        (exercise_id, provider, source_url, embed_url, title, status, fallback_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (exercise_id) DO NOTHING`,
      [
        row.exercise_id,
        row.provider ?? "none",
        row.source_url ?? row.url ?? null,
        row.embed_url ?? null,
        row.title ?? null,
        row.status ?? "unchecked",
        row.fallback_text ?? null,
      ],
    );
  }

  for (const row of data.snapshot_exercise_media_bindings ?? []) {
    if (!row.version_id || !row.snapshot_exercise_key) continue;
    if (!row.confirmed_by_trainer) continue;
    await client.query(
      `INSERT INTO public.snapshot_exercise_media_bindings
        (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (version_id, snapshot_exercise_key) DO NOTHING`,
      [
        row.version_id,
        row.snapshot_exercise_key,
        asUuid(row.exercise_id),
        true,
      ],
    );
  }

  return {
    email: data.user.email,
    userId,
    courses: data.courses?.length ?? 0,
    nutritionVersions: data.nutrition_versions?.length ?? 0,
    trainingVersions: data.training_versions?.length ?? 0,
    assignments: data.assignments?.length ?? 0,
    contentHashes: hashes,
    trainingExerciseStats: stats,
    skippedPublishedSnapshots,
    emailMissing: false,
  };
}

export async function importClients(
  clientFactory: () => Promise<PoolClient>,
  payload: unknown,
  options: ImportOptions = {},
): Promise<ImportRunReport> {
  const clients = normalizeExportPayload(payload, options);
  const report: ImportRunReport = {
    dryRun: Boolean(options.dryRun),
    matchCount: clients.reduce((sum, item) => sum + (item.matchCount ?? 1), 0),
    clients: [],
    failed: [],
  };
  for (const item of clients) {
    if (options.dryRun) {
      report.clients.push(await importOneClient(null, item, true));
      continue;
    }
    const pg = await clientFactory();
    try {
      if (!options.dryRun) await pg.query("BEGIN");
      const summary = await importOneClient(pg, item, Boolean(options.dryRun));
      if (!options.dryRun) await pg.query("COMMIT");
      report.clients.push(summary);
    } catch (error) {
      if (!options.dryRun) {
        try {
          await pg.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
      report.failed.push({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      pg.release();
    }
  }
  return report;
}

export function printImportReport(report: ImportRunReport): void {
  console.log(
    JSON.stringify(
      {
        dryRun: report.dryRun,
        match_count: report.matchCount,
        clientCount: report.clients.length,
        failedCount: report.failed.length,
        clients: report.clients.map((c) => ({
          emailMissing: c.emailMissing,
          courseCount: c.courses,
          nutritionVersionCount: c.nutritionVersions,
          trainingVersionCount: c.trainingVersions,
          assignmentCount: c.assignments,
          contentHashes: c.contentHashes,
          skippedPublishedSnapshots: c.skippedPublishedSnapshots,
          trainingExerciseStats: c.trainingExerciseStats,
        })),
        failed: report.failed,
      },
      null,
      2,
    ),
  );
}
