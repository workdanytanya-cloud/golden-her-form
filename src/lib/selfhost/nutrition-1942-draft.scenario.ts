/**
 * Тестовый профиль: 1942 ккал / 1+3 / 7 дней → черновик того же курса, без публикации.
 * Запуск: npx tsx src/lib/selfhost/nutrition-1942-draft.scenario.ts
 */
import pg from "pg";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { closePostgresPool } from "./db";
import { applyMigrations } from "./migrate";
import {
  loadConstructorPlanPg,
  saveConstructorPlanPg,
  seedNutritionCatalog,
} from "./postgres-nutrition";

const ADMIN = "c1942000-0000-4000-8000-000000000001";
const CLIENT = "c1942000-0000-4000-8000-000000000002";
const COURSE = "c1942000-0000-4000-8000-000000000011";
const PUBLISHED = "c1942000-0000-4000-8000-0000000000a1";
const DB_NAME = "panovapro_nutrition_1942_tests";
const ADMIN_URL =
  process.env.SELFHOST_TEST_DATABASE_URL ??
  "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";

const TARGETS = {
  kcal: 1942,
  protein_g: 178.2,
  fat_g: 89.1,
  carbs_g: 106.8,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function verify1942DraftOnTestDatabase(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const current = await admin.query(`SELECT current_database() AS name`);
  assert(current.rows[0].name !== DB_NAME, "Служебное подключение не должно быть тестовой базой");
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [DB_NAME],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB_NAME}`;
  process.env.DATABASE_URL = url.toString();
  process.env.DATA_BACKEND = "postgres";
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await applyMigrations(pool);
    await seedNutritionCatalog(pool);

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, '1942-admin@example.invalid', 'x'), ($2, '1942-client@example.invalid', 'x')`,
      [ADMIN, CLIENT],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'client')`,
      [ADMIN, CLIENT],
    );
    await pool.query(
      `INSERT INTO profiles (id, full_name, gender, height_cm, age_years, goal)
       VALUES ($1, 'Тестовый профиль 1942', 'female', 170, 33, 'проверка')`,
      [CLIENT],
    );
    await pool.query(
      `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status, created_by, program_scope)
       VALUES ($1, $2, 'Тестовый курс 1942', '2026-11-01', '2026-11-28', 'active', $3, 'nutrition')`,
      [COURSE, CLIENT, ADMIN],
    );
    await pool.query(
      `INSERT INTO nutrition_plan_versions
         (id, client_id, course_id, version, status, snapshot, content_hash, published_at, published_by)
       VALUES ($1, $2, $3, 1, 'published', '{"kind":"constructor","frozen":true,"days":[]}'::jsonb,
               'published-1942-fixture', '2026-11-01T00:00:00Z', $4)`,
      [PUBLISHED, CLIENT, COURSE, ADMIN],
    );
    await pool.query(
      `INSERT INTO client_program_assignments (client_id, kind, course_id, active_version_id)
       VALUES ($1, 'nutrition', $2, $3)`,
      [CLIENT, COURSE, PUBLISHED],
    );

    const before = await pool.query(
      `SELECT id::text, status, content_hash, snapshot::text AS snapshot
         FROM nutrition_plan_versions WHERE id = $1`,
      [PUBLISHED],
    );
    const beforeAssignment = await pool.query(
      `SELECT active_version_id::text, course_id::text
         FROM client_program_assignments WHERE client_id = $1 AND kind = 'nutrition'`,
      [CLIENT],
    );

    const ctx = buildInMemoryCatalog();
    const generated = generateConstructorPlan(ctx, {
      targets: {
        kcal: d(TARGETS.kcal),
        protein_g: d(TARGETS.protein_g),
        fat_g: d(TARGETS.fat_g),
        carbs_g: d(TARGETS.carbs_g),
        fiber_g: d(0),
      },
      days_count: 7,
      excluded_product_ids: [],
      tolerance: DEFAULT_TOLERANCE,
      meal_schedule_mode: "one_main_three_snacks",
      primary_meal_slot: "lunch",
      seed: 1942,
      search_timeout_ms: 60_000,
    });
    assert(generated.is_valid, generated.message ?? generated.reason_code ?? "генерация невалидна");
    assert(generated.days.length === 7, `ожидалось 7 дней, получено ${generated.days.length}`);
    const meals = generated.days.flatMap((day) => day.items);
    assert(meals.length === 28, `ожидалось 28 приёмов, получено ${meals.length}`);
    assert(new Set(meals.map((item) => item.recipe_id)).size === 28, "есть повторы блюд в неделе");
    const recipeById = new Map(ctx.recipes.map((recipe) => [recipe.id, recipe]));
    assert(
      evaluateStrictWeekVariety(generated.days, recipeById, { allowRepeats: false }) === null,
      "strict variety violation",
    );

    // Корректирующий черновик того же курса (как после generate/save), без publish.
    const client = await pool.connect();
    let saved: Awaited<ReturnType<typeof saveConstructorPlanPg>>;
    try {
      saved = await saveConstructorPlanPg(client, {
        userId: CLIENT,
        courseId: COURSE,
        days: generated.days,
        targets: TARGETS,
        plan_days_count: 7,
        plan_status: "validated",
        targets_manual: true,
        meal_schedule_mode: "one_main_three_snacks",
        primary_meal_slot: "lunch",
        review_reason: "Корректирующий черновик: тест 1942",
        bmr: Number(generated.bmr),
        tdee: Number(generated.tdee),
        calorie_adjustment_pct: generated.adjustment_pct,
      });
    } finally {
      client.release();
    }
    assert(saved.plan.user_id === CLIENT, "черновик не того клиента");
    assert(saved.plan.plan_status === "validated", `статус черновика: ${saved.plan.plan_status}`);
    assert(saved.days.length === 7, "после сохранения дней не 7");

    const loaded = await loadConstructorPlanPg(pool, CLIENT, COURSE);
    assert(loaded.plan?.id === saved.plan.id, "повторная загрузка дала другой draftId");
    assert(loaded.days.length === 7, "повторная загрузка дней не 7");

    const plans = await pool.query(
      `SELECT count(*)::int AS n, max(course_id::text) AS course_id, max(review_reason) AS reason
         FROM nutrition_plans WHERE user_id = $1`,
      [CLIENT],
    );
    assert(plans.rows[0].n === 1, `ожидался 1 черновик, получено ${plans.rows[0].n}`);
    assert(plans.rows[0].course_id === COURSE, "черновик привязан к другому курсу");
    assert(
      String(plans.rows[0].reason).includes("Корректирующий"),
      `ожидался review_reason корректировки, получено ${plans.rows[0].reason}`,
    );

    const after = await pool.query(
      `SELECT id::text, status, content_hash, snapshot::text AS snapshot
         FROM nutrition_plan_versions WHERE id = $1`,
      [PUBLISHED],
    );
    assert(
      JSON.stringify(after.rows[0]) === JSON.stringify(before.rows[0]),
      "опубликованная версия изменилась",
    );
    const afterAssignment = await pool.query(
      `SELECT active_version_id::text, course_id::text
         FROM client_program_assignments WHERE client_id = $1 AND kind = 'nutrition'`,
      [CLIENT],
    );
    assert(
      JSON.stringify(afterAssignment.rows[0]) === JSON.stringify(beforeAssignment.rows[0]),
      "назначение опубликованного меню изменилось",
    );
    const versions = await pool.query(`SELECT count(*)::int AS n FROM nutrition_plan_versions`);
    assert(versions.rows[0].n === 1, "появилась новая опубликованная версия");
  } finally {
    await closePostgresPool().catch(() => undefined);
    await pool.end();
    const cleanup = new pg.Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME],
    );
    await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await cleanup.end();
  }
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("nutrition-1942-draft.scenario.ts")) {
  verify1942DraftOnTestDatabase()
    .then(() => {
      console.log("1942 draft scenario ok");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
