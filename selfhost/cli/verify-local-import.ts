import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { parseClientExportCsv } from "../../src/lib/selfhost/csv-export";
import { closePostgresPool, getPostgresPool } from "../../src/lib/selfhost/db";
import { normalizeExportPayload } from "../../src/lib/selfhost/import-client";

loadSelfhostEnvFiles();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const file = arg("--file");
  const email = arg("--email")?.trim().toLowerCase();
  if (!file || !email) throw new Error("Нужны --file и --email");
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  const payload = path.extname(file).toLowerCase() === ".csv" ? parseClientExportCsv(raw)[0] : JSON.parse(raw);
  const [client] = normalizeExportPayload(payload, { email });
  const pool = getPostgresPool();
  const nutrition = client.nutrition_versions?.[0];
  const training = client.training_versions?.[0];
  const course = client.courses?.[0];
  const nutId = String(nutrition?.id ?? "");
  const trId = String(training?.id ?? "");
  const courseId = String(course?.id ?? "");

  const [users, access, courses, nut, tr, assigns, nutCount, trCount] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM public.users WHERE email = $1`, [email]),
    pool.query(
      `SELECT status FROM public.client_access WHERE user_id = (SELECT id FROM public.users WHERE email = $1)`,
      [email],
    ),
    pool.query(`SELECT status FROM public.client_courses WHERE id = $1`, [courseId]),
    pool.query(`SELECT content_hash, status, snapshot FROM public.nutrition_plan_versions WHERE id = $1`, [nutId]),
    pool.query(`SELECT content_hash, status, snapshot FROM public.training_program_versions WHERE id = $1`, [trId]),
    pool.query(
      `SELECT kind, active_version_id FROM public.client_program_assignments WHERE course_id = $1 ORDER BY kind`,
      [courseId],
    ),
    pool.query(`SELECT count(*)::int AS n FROM public.nutrition_plan_versions`),
    pool.query(`SELECT count(*)::int AS n FROM public.training_program_versions`),
  ]);

  const nutRow = nut.rows[0] as { content_hash: string; status: string; snapshot: unknown } | undefined;
  const trRow = tr.rows[0] as { content_hash: string; status: string; snapshot: unknown } | undefined;
  const report = {
    userCountForEmail: users.rows[0]?.n ?? 0,
    clientAccessStatus: access.rows[0]?.status ?? null,
    courseStatus: courses.rows[0]?.status ?? null,
    nutritionHashMatch: nutRow?.content_hash === nutrition?.content_hash,
    trainingHashMatch: trRow?.content_hash === training?.content_hash,
    nutritionSnapshotMatch: nutRow ? fingerprint(nutRow.snapshot) === fingerprint(nutrition?.snapshot) : false,
    trainingSnapshotMatch: trRow ? fingerprint(trRow.snapshot) === fingerprint(training?.snapshot) : false,
    nutritionStatus: nutRow?.status ?? null,
    trainingStatus: trRow?.status ?? null,
    assignmentKinds: assigns.rows.map((row: { kind: string }) => row.kind),
    assignmentsPointToPublished:
      assigns.rows.some((row: { kind: string; active_version_id: string }) => row.kind === "nutrition" && row.active_version_id === nutId) &&
      assigns.rows.some((row: { kind: string; active_version_id: string }) => row.kind === "training" && row.active_version_id === trId),
    nutritionVersionRows: nutCount.rows[0]?.n ?? 0,
    trainingVersionRows: trCount.rows[0]?.n ?? 0,
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
