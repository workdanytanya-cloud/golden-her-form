import type { PoolClient } from "pg";
import { summarizeSnapshotExerciseIds } from "@/lib/selfhost/media";
import type { TrainingSnapshot } from "@/lib/published-programs/types";

const PLACEHOLDER_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class ImportAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportAbortError";
  }
}

export type ClientExport = {
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
    versionId: string;
    total: number;
    withExerciseId: number;
    needingManualMatch: number;
  }>;
  skippedPublishedSnapshots: number;
};

export type ImportRunReport = {
  dryRun: boolean;
  clients: ImportClientSummary[];
  failed: Array<{ email?: string; error: string }>;
};

function rejectPlaintextPassword(input: unknown, label: string): void {
  if (!input || typeof input !== "object") return;
  const obj = input as Record<string, unknown>;
  for (const key of ["password", "plaintext_password", "plain_password", "new_password"]) {
    if (typeof obj[key] === "string" && obj[key]) {
      throw new ImportAbortError(`${label}: plaintext-пароль в экспорте запрещён`);
    }
  }
}

function asUuid(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeExportPayload(raw: unknown): ClientExport[] {
  if (!raw || typeof raw !== "object") {
    throw new ImportAbortError("Экспорт должен быть JSON-объектом или массивом");
  }
  const root = raw as Record<string, unknown>;
  rejectPlaintextPassword(root, "корень экспорта");

  if (Array.isArray(raw)) {
    return raw.map((item, i) => normalizeOne(item, `clients[${i}]`));
  }
  if (Array.isArray(root.clients)) {
    return root.clients.map((item, i) => normalizeOne(item, `clients[${i}]`));
  }
  if (root.user || root.email) {
    return [normalizeOne(raw, "client")];
  }
  throw new ImportAbortError("Не найден список клиентов или объект user");
}

function normalizeOne(raw: unknown, label: string): ClientExport {
  if (!raw || typeof raw !== "object") throw new ImportAbortError(`${label}: ожидался объект`);
  rejectPlaintextPassword(raw, label);
  const obj = raw as Record<string, unknown>;
  const userRaw = (obj.user && typeof obj.user === "object" ? obj.user : obj) as Record<string, unknown>;
  rejectPlaintextPassword(userRaw, `${label}.user`);
  const email = String(userRaw.email ?? obj.email ?? "").trim();
  if (!email) throw new ImportAbortError(`${label}: нет email`);
  return {
    user: {
      id: asUuid(userRaw.id) ?? undefined,
      email,
      password_hash: typeof userRaw.password_hash === "string" ? userRaw.password_hash : null,
      email_verified_at: (userRaw.email_verified_at as string | null) ?? null,
      status: typeof userRaw.status === "string" ? userRaw.status : "active",
    },
    roles: (obj.roles as ClientExport["roles"]) ?? ["client"],
    profile: (obj.profile as Record<string, unknown>) ?? null,
    access: (obj.access as Record<string, unknown>) ?? obj.client_access ?? null,
    courses: (obj.courses as Array<Record<string, unknown>>) ?? (obj.client_courses as Array<Record<string, unknown>>) ?? [],
    nutrition_versions:
      (obj.nutrition_versions as Array<Record<string, unknown>>) ??
      (obj.nutrition_plan_versions as Array<Record<string, unknown>>) ??
      [],
    training_versions:
      (obj.training_versions as Array<Record<string, unknown>>) ??
      (obj.training_program_versions as Array<Record<string, unknown>>) ??
      [],
    assignments:
      (obj.assignments as Array<Record<string, unknown>>) ??
      (obj.client_program_assignments as Array<Record<string, unknown>>) ??
      [],
    exercise_media_bindings: (obj.exercise_media_bindings as Array<Record<string, unknown>>) ?? [],
    snapshot_exercise_media_bindings:
      (obj.snapshot_exercise_media_bindings as Array<Record<string, unknown>>) ?? [],
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
      (id, client_id, course_id, version, status, snapshot, content_hash, parent_version_id, created_by, published_at, published_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
    [
      id,
      asUuid(row.client_id) ?? userId,
      courseId,
      version,
      status,
      snapshotJson,
      contentHash,
      asUuid(row.parent_version_id),
      asUuid(row.created_by),
      row.published_at ?? null,
      asUuid(row.published_by),
    ],
  );
  return { id, skipped: false, contentHash };
}

export async function importOneClient(
  client: PoolClient,
  data: ClientExport,
  dryRun: boolean,
): Promise<ImportClientSummary> {
  if (dryRun) {
    const email = data.user.email;
    const hashes = [
      ...(data.nutrition_versions ?? []).map((v) => String(v.content_hash ?? "")),
      ...(data.training_versions ?? []).map((v) => String(v.content_hash ?? "")),
    ].filter(Boolean);
    const stats = (data.training_versions ?? []).map((row) => {
      const snapshot = row.snapshot as TrainingSnapshot;
      const summary = snapshot?.days ? summarizeSnapshotExerciseIds(snapshot) : {
        total: 0,
        withExerciseId: 0,
        needingManualMatch: 0,
      };
      return { versionId: String(row.id ?? "unknown"), ...summary };
    });
    return {
      email,
      userId: data.user.id ?? "(dry-run)",
      courses: data.courses?.length ?? 0,
      nutritionVersions: data.nutrition_versions?.length ?? 0,
      trainingVersions: data.training_versions?.length ?? 0,
      assignments: data.assignments?.length ?? 0,
      contentHashes: hashes,
      trainingExerciseStats: stats,
      skippedPublishedSnapshots: 0,
    };
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
      `INSERT INTO public.client_access (user_id, status, unlock_source, notes, activated_at, activated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         unlock_source = EXCLUDED.unlock_source`,
      [
        userId,
        data.access.status ?? "active",
        data.access.unlock_source ?? null,
        data.access.notes ?? null,
        data.access.activated_at ?? null,
        asUuid(data.access.activated_by),
      ],
    );
  }

  for (const course of data.courses ?? []) {
    const id = asUuid(course.id);
    if (!id) throw new ImportAbortError("курс без UUID");
    await client.query(
      `INSERT INTO public.client_courses (id, client_id, title, start_date, end_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
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
        asUuid(course.created_by),
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
    const snapshot = row.snapshot as TrainingSnapshot;
    stats.push({
      versionId: result.id,
      ...(snapshot?.days
        ? summarizeSnapshotExerciseIds(snapshot)
        : { total: 0, withExerciseId: 0, needingManualMatch: 0 }),
    });
  }

  for (const row of data.assignments ?? []) {
    const id = asUuid(row.id);
    await client.query(
      `INSERT INTO public.client_program_assignments (id, client_id, kind, course_id, active_version_id, updated_by)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, kind, course_id) DO UPDATE SET
         active_version_id = EXCLUDED.active_version_id`,
      [
        id,
        asUuid(row.client_id) ?? userId,
        row.kind,
        asUuid(row.course_id),
        row.active_version_id,
        asUuid(row.updated_by),
      ],
    );
  }

  for (const row of data.exercise_media_bindings ?? []) {
    if (!asUuid(row.exercise_id)) continue;
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
        (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (version_id, snapshot_exercise_key) DO NOTHING`,
      [
        row.version_id,
        row.snapshot_exercise_key,
        asUuid(row.exercise_id),
        true,
        asUuid(row.created_by),
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
  };
}

export async function importClients(
  clientFactory: () => Promise<PoolClient>,
  payload: unknown,
  options: { dryRun?: boolean } = {},
): Promise<ImportRunReport> {
  const clients = normalizeExportPayload(payload);
  const report: ImportRunReport = { dryRun: Boolean(options.dryRun), clients: [], failed: [] };
  for (const item of clients) {
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
        email: item.user.email,
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
        clientCount: report.clients.length,
        failedCount: report.failed.length,
        clients: report.clients.map((c) => ({
          userId: c.userId,
          courseCount: c.courses,
          nutritionVersionCount: c.nutritionVersions,
          trainingVersionCount: c.trainingVersions,
          assignmentCount: c.assignments,
          contentHashes: c.contentHashes,
          skippedPublishedSnapshots: c.skippedPublishedSnapshots,
          trainingExerciseStats: c.trainingExerciseStats,
        })),
        failed: report.failed.map((f) => ({ error: f.error })),
      },
      null,
      2,
    ),
  );
}
