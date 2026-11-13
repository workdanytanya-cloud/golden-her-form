import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { closePostgresPool } from "./db";
import { provisionClientCoursePg, retryCourseGenerationPg } from "./postgres-course-provision";

const url = process.env.SELFHOST_COURSE_PROVISION_TEST_DATABASE_URL;
const run = Boolean(url);
const ADMIN = "41000000-0000-4000-8000-000000000001";
const CLIENT = "41000000-0000-4000-8000-000000000002";
const INCOMPLETE = "41000000-0000-4000-8000-000000000003";

describe.runIf(run)("course provision PostgreSQL integration", () => {
  let pool: pg.Pool;
  const calls = { nutrition: 0, training: 0 };

  const deps = {
    generateNutrition: async (clientId: string, courseId: string) => {
      calls.nutrition += 1;
      if (calls.nutrition === 1) throw new Error("Сбой питания");
      const plan = await pool.query(
        `INSERT INTO nutrition_plans (user_id, course_id, target_kcal, target_protein_g, target_fat_g, target_carbs_g, plan_status)
         VALUES ($1,$2,1800,100,60,180,'draft') RETURNING id`,
        [clientId, courseId],
      );
      await pool.query(`INSERT INTO nutrition_plan_days (plan_id, day_index) VALUES ($1,0)`, [
        plan.rows[0].id,
      ]);
    },
    generateTraining: async (clientId: string, courseId: string) => {
      calls.training += 1;
      const program = await pool.query(
        `INSERT INTO training_programs (user_id, course_id, sessions_per_week, goal, level)
         VALUES ($1,$2,3,'tone','beginner') RETURNING id`,
        [clientId, courseId],
      );
      await pool.query(
        `INSERT INTO training_program_days (program_id, week_index, day_index, title)
         VALUES ($1,0,0,'День 1')`,
        [program.rows[0].id],
      );
    },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATA_BACKEND = "postgres";
    pool = new pg.Pool({ connectionString: url });
    await applyMigrations(pool);
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES
         ($1,'provision-admin@example.invalid','hash-admin'),
         ($2,'provision-client@example.invalid','hash-client'),
         ($3,'provision-incomplete@example.invalid','hash-incomplete')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENT, INCOMPLETE],
    );
    await pool.query(
      `INSERT INTO profiles (id, gender, height_cm, birth_date) VALUES
         ($1,'female',168,'1994-04-02'),
         ($2,'female',168,NULL)
       ON CONFLICT (id) DO NOTHING`,
      [CLIENT, INCOMPLETE],
    );
    await pool.query(
      `INSERT INTO onboarding_responses (user_id, goal_primary, activity_level, training_days_per_week, completed_at)
       VALUES ($1,'weight_loss','moderate',3, now()), ($2,'tone','moderate',3, now())
       ON CONFLICT (user_id) DO NOTHING`,
      [CLIENT, INCOMPLETE],
    );
    await pool.query(
      `INSERT INTO measurements (user_id, measured_on, weight_kg) VALUES ($1,'2026-11-01',62), ($2,'2026-11-01',62)`,
      [CLIENT, INCOMPLETE],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await closePostgresPool();
  });

  it("creates one course for nutrition, training and both, and retries only the failed stage", async () => {
    const passwordBefore = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [
      CLIENT,
    ]);
    const trainingOnly = await provisionClientCoursePg(
      pool,
      {
        clientId: INCOMPLETE,
        programScope: "training",
        activate: false,
        actorId: ADMIN,
        startDate: "2026-11-01",
      },
      deps,
    );
    expect(trainingOnly.course.program_scope).toBe("training");
    expect(trainingOnly.course.status).toBe("draft");
    expect(trainingOnly.stages.training.status).toBe("ready");
    expect(trainingOnly.stages.nutrition.status).toBeNull();

    await expect(
      provisionClientCoursePg(
        pool,
        {
          clientId: INCOMPLETE,
          programScope: "nutrition",
          activate: true,
          actorId: ADMIN,
          startDate: "2026-11-02",
        },
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    const first = await provisionClientCoursePg(
      pool,
      {
        clientId: CLIENT,
        programScope: "both",
        activate: true,
        actorId: ADMIN,
        startDate: "2026-11-13",
      },
      deps,
    );
    expect(first.course.status).toBe("active");
    expect(first.stages.training.status).toBe("ready");
    expect(first.stages.nutrition.status).toBe("failed");
    const access = await pool.query(`SELECT status FROM client_access WHERE user_id = $1`, [
      CLIENT,
    ]);
    expect(access.rows[0].status).toBe("active");

    const again = await provisionClientCoursePg(
      pool,
      {
        clientId: CLIENT,
        programScope: "both",
        activate: true,
        actorId: ADMIN,
        startDate: "2026-11-13",
      },
      deps,
    );
    expect(again.course.id).toBe(first.course.id);
    expect(again.idempotent).toBe(true);
    expect(again.stages.nutrition.status).toBe("ready");
    expect(again.stages.training.status).toBe("ready");
    expect(calls.training).toBe(2);
    expect(calls.nutrition).toBe(2);

    const retried = await retryCourseGenerationPg(
      pool,
      { clientId: CLIENT, courseId: first.course.id, kind: "training" },
      deps,
    );
    expect(retried.course.id).toBe(first.course.id);
    expect(calls.training).toBe(2);

    const courses = await pool.query(
      `SELECT count(*)::int AS n FROM client_courses WHERE client_id = $1`,
      [CLIENT],
    );
    expect(courses.rows[0].n).toBe(1);
    const published = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM nutrition_plan_versions WHERE client_id = $1) AS nutrition,
         (SELECT count(*)::int FROM training_program_versions WHERE client_id = $1) AS training,
         (SELECT count(*)::int FROM client_program_assignments WHERE client_id = $1) AS assignments`,
      [CLIENT],
    );
    expect(published.rows[0]).toEqual({ nutrition: 0, training: 0, assignments: 0 });
    const passwordAfter = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [
      CLIENT,
    ]);
    expect(passwordAfter.rows[0].password_hash).toBe(passwordBefore.rows[0].password_hash);
  });
});
