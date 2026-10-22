import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool } from "../../src/lib/selfhost/db";
import {
  loadConstructorPlanPg,
  publishNutritionVersionPg,
} from "../../src/lib/selfhost/postgres-nutrition";
import { PostgresClientCourseRepository } from "../../src/lib/selfhost/postgres-courses";
import { assertDaysWithinTargets } from "../../src/lib/nutrition-constructor/parse-nutrition-menu-md";

loadSelfhostEnvFiles();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function otherClientsDigest(pool: ReturnType<typeof getPostgresPool>, clientId: string) {
  const published = await pool.query(
    `SELECT count(*)::int AS count,
       md5(coalesce(string_agg(id::text || ':' || content_hash, ',' ORDER BY id), '')) AS hashes,
       md5(coalesce(string_agg(id::text || ':' || snapshot::text, ',' ORDER BY id), '')) AS snapshots
     FROM nutrition_plan_versions WHERE client_id <> $1 AND status='published'`,
    [clientId],
  );
  const assignments = await pool.query(
    `SELECT count(*)::int AS count,
       md5(coalesce(string_agg(row_to_json(a)::text, ',' ORDER BY id), '')) AS digest
     FROM client_program_assignments a WHERE client_id <> $1`,
    [clientId],
  );
  return { published: published.rows[0], assignments: assignments.rows[0] };
}

async function main() {
  const clientId = arg("--client-id")?.trim();
  const courseIdArg = arg("--course-id")?.trim() || null;
  const reason = arg("--reason")?.trim() || "Утверждённое меню питания";
  const idempotencyKey = arg("--idempotency-key")?.trim() || null;
  const preserveVersionId = arg("--preserve-version-id")?.trim() || null;
  const scope = arg("--course-scope")?.trim() as "nutrition" | "training" | "both" | undefined;
  if (!clientId) throw new Error("Укажите --client-id <uuid>");

  const pool = getPostgresPool();
  try {
    const before = await otherClientsDigest(pool, clientId);
    let preserveBefore: { content_hash: string; snap_md5: string; status: string } | null = null;
    if (preserveVersionId) {
      const row = await pool.query(
        `SELECT content_hash, status, md5(snapshot::text) AS snap_md5 FROM nutrition_plan_versions WHERE id=$1`,
        [preserveVersionId],
      );
      if (!row.rows[0]) throw new Error(`Версия ${preserveVersionId} не найдена`);
      preserveBefore = row.rows[0] as {
        content_hash: string;
        snap_md5: string;
        status: string;
      };
    }

    const actor = await pool.query(
      `SELECT ur.user_id FROM user_roles ur WHERE ur.role='admin' ORDER BY ur.user_id LIMIT 1`,
    );
    const actorId = actor.rows[0]?.user_id as string | undefined;
    if (!actorId) throw new Error("Admin actor not found");

    const courses = new PostgresClientCourseRepository(pool);
    const active = await pool.query(
      `SELECT id FROM client_courses WHERE client_id=$1 AND status='active' ORDER BY start_date DESC LIMIT 1`,
      [clientId],
    );
    const courseId = courseIdArg ?? (active.rows[0] as { id: string } | undefined)?.id;
    if (!courseId) throw new Error("Курс не найден");

    if (scope) {
      await courses.update(courseId, clientId, { status: "active", program_scope: scope }, actorId);
    }

    const loaded = await loadConstructorPlanPg(pool, clientId, courseId);
    if (!loaded.plan || loaded.days.length === 0) throw new Error("Черновик пуст");
    assertDaysWithinTargets(loaded.days, {
      kcal: loaded.plan.target_kcal,
      protein_g: loaded.plan.target_protein_g,
      fat_g: loaded.plan.target_fat_g,
      carbs_g: loaded.plan.target_carbs_g,
    });

    const published = await publishNutritionVersionPg(pool, {
      clientId,
      courseId,
      actorId,
      reason,
      idempotencyKey,
      days: loaded.days,
      plan: loaded.plan,
    });

    const assignment = await pool.query(
      `SELECT id, active_version_id FROM client_program_assignments
       WHERE client_id=$1 AND course_id=$2 AND kind='nutrition'`,
      [clientId, courseId],
    );
    const training = await pool.query(
      `SELECT count(*)::int AS n FROM client_program_assignments
       WHERE client_id=$1 AND course_id=$2 AND kind='training'`,
      [clientId, courseId],
    );

    if (preserveVersionId && preserveBefore) {
      const afterPreserve = await pool.query(
        `SELECT content_hash, status, md5(snapshot::text) AS snap_md5 FROM nutrition_plan_versions WHERE id=$1`,
        [preserveVersionId],
      );
      const row = afterPreserve.rows[0] as {
        content_hash: string;
        snap_md5: string;
        status: string;
      };
      if (
        row.content_hash !== preserveBefore.content_hash ||
        row.snap_md5 !== preserveBefore.snap_md5
      ) {
        throw new Error("Сохраняемая опубликованная версия изменила snapshot/content_hash");
      }
      if (row.status !== "superseded" && row.status !== "published") {
        throw new Error(`Неожиданный статус сохраняемой версии: ${row.status}`);
      }
    }

    const after = await otherClientsDigest(pool, clientId);
    if (
      after.published.hashes !== before.published.hashes ||
      after.published.snapshots !== before.published.snapshots ||
      after.assignments.digest !== before.assignments.digest
    ) {
      throw new Error("Изменились snapshots/assignments других клиентов — остановка");
    }

    const course = await pool.query(
      `SELECT program_scope FROM client_courses WHERE id=$1`,
      [courseId],
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          clientId,
          courseId,
          versionId: published.versionId,
          contentHash: published.contentHash,
          idempotent: published.idempotent,
          assignmentId: (assignment.rows[0] as { id: string } | undefined)?.id ?? null,
          activeVersionId:
            (assignment.rows[0] as { active_version_id: string } | undefined)?.active_version_id ??
            null,
          programScope: (course.rows[0] as { program_scope: string } | undefined)?.program_scope,
          trainingAssignments: (training.rows[0] as { n: number }).n,
          otherClientsUnchanged: true,
          preservedVersion: preserveVersionId
            ? {
                id: preserveVersionId,
                content_hash: preserveBefore?.content_hash,
                status: (
                  await pool.query(`SELECT status FROM nutrition_plan_versions WHERE id=$1`, [
                    preserveVersionId,
                  ])
                ).rows[0]?.status,
              }
            : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await closePostgresPool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
