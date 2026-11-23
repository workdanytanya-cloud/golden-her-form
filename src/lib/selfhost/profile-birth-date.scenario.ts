import pg from "pg";
import { birthDateForInput } from "@/lib/birth-date";
import { resolveClientAge } from "@/lib/client-age";
import { calcBmr } from "@/lib/nutrition-constructor/targets";
import { PostgresAdminClientRepository } from "@/lib/selfhost/postgres-admin-clients";
import { applyMigrations } from "./migrate";

const CLIENT = "b1000000-0000-4000-8000-000000000033";
const COURSE = "b1000000-0000-4000-8000-0000000000c1";
const MENU = "b1000000-0000-4000-8000-0000000000a1";
const DB_NAME = "panovapro_birth_date_tests";
const ADMIN_URL =
  process.env.SELFHOST_TEST_DATABASE_URL ??
  "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fingerprint(pool: pg.Pool) {
  const [course, menu, assignment, plans, log] = await Promise.all([
    pool.query(
      `SELECT id::text, status, start_date::text AS start_date, end_date::text AS end_date
         FROM client_courses WHERE id = $1`,
      [COURSE],
    ),
    pool.query(
      `SELECT id::text, status, content_hash, snapshot::text AS snapshot, published_at::text AS published_at
         FROM nutrition_plan_versions WHERE id = $1`,
      [MENU],
    ),
    pool.query(
      `SELECT active_version_id::text, course_id::text
         FROM client_program_assignments WHERE client_id = $1 AND kind = 'nutrition'`,
      [CLIENT],
    ),
    pool.query(`SELECT count(*)::int AS n FROM nutrition_plans WHERE user_id = $1`, [CLIENT]),
    pool.query(`SELECT count(*)::int AS n FROM program_change_log WHERE client_id = $1`, [CLIENT]),
  ]);
  return {
    course: course.rows[0],
    menu: menu.rows[0],
    assignment: assignment.rows[0],
    plans: plans.rows[0].n as number,
    log: log.rows[0].n as number,
  };
}

export async function verifyBirthDateOnTestDatabase(): Promise<void> {
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
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await applyMigrations(pool);
    const repo = new PostgresAdminClientRepository(pool);
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'birth-date-fixture@example.invalid', 'not-a-login')`,
      [CLIENT],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'client')`, [CLIENT]);
    await pool.query(
      `INSERT INTO profiles (id, full_name, phone, gender, height_cm, birth_date, age_years, goal)
       VALUES ($1, 'Тестовый профиль', '+70000000000', 'female', 170, '1993-01-01', 33, 'проверка')`,
      [CLIENT],
    );
    await pool.query(
      `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status)
       VALUES ($1, $2, 'Тестовый курс', '2026-11-01', '2026-11-28', 'active')`,
      [COURSE, CLIENT],
    );
    await pool.query(
      `INSERT INTO nutrition_plan_versions
         (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
       VALUES ($1, $2, $3, 1, 'published', '{"days":["суп"]}'::jsonb, 'menu-hash-fixture',
               '2026-11-01T00:00:00Z')`,
      [MENU, CLIENT, COURSE],
    );
    await pool.query(
      `INSERT INTO client_program_assignments (client_id, kind, course_id, active_version_id)
       VALUES ($1, 'nutrition', $2, $3)`,
      [CLIENT, COURSE, MENU],
    );

    const raw = await pool.query(`SELECT birth_date FROM profiles WHERE id = $1`, [CLIENT]);
    const driverValue = raw.rows[0].birth_date as Date;
    assert(
      String(driverValue).slice(0, 10) === "Fri Jan 01",
      `Ожидался сырой Fri Jan 01, получено ${String(driverValue).slice(0, 10)}`,
    );
    const card = await repo.get(CLIENT);
    assert(card?.birth_date === "1993-01-01", `Чтение даты: ${card?.birth_date}`);
    assert(card?.age_years === 33, `Чтение возраста: ${card?.age_years}`);
    assert(birthDateForInput("Fri Jan 01") === "", "Битая строка не должна попасть в поле даты");
    assert(birthDateForInput(card?.birth_date) === "1993-01-01", "Поле должно показать календарный день");

    const before = await fingerprint(pool);
    let rejected = false;
    try {
      await repo.updateProfile(CLIENT, { birth_date: "Fri Jan 01", age_years: 33 });
    } catch (error) {
      rejected = error instanceof Error && /ГГГГ-ММ-ДД/.test(error.message);
    }
    assert(rejected, "Fri Jan 01 должна отклоняться до записи");
    const afterReject = await fingerprint(pool);
    assert(JSON.stringify(afterReject) === JSON.stringify(before), "Отказ не должен менять курс и меню");
    const still = await pool.query(`SELECT birth_date::text AS birth_date FROM profiles WHERE id = $1`, [
      CLIENT,
    ]);
    assert(still.rows[0].birth_date === "1993-01-01", "Отказ не должен менять дату");

    await repo.updateProfile(CLIENT, {
      full_name: "Тестовый профиль",
      phone: "+70000000033",
      goal: "проверка",
      height_cm: 170,
      gender: "female",
      age_years: 34,
    });
    const kept = await repo.get(CLIENT);
    assert(kept?.birth_date === "1993-01-01", `Смена телефона испортила дату: ${kept?.birth_date}`);
    assert(kept?.phone === "+70000000033", "Телефон не сохранился");
    assert(kept?.age_years === 34, "Возраст не сохранился");

    await repo.updateProfile(CLIENT, {
      full_name: "Тестовый профиль",
      phone: "+70000000033",
      goal: "проверка",
      height_cm: 170,
      gender: "female",
      age_years: 33,
      birth_date: null,
    });
    const cleared = await repo.get(CLIENT);
    assert(cleared?.birth_date === null, `Очистка не сохранилась: ${cleared?.birth_date}`);
    assert(cleared?.age_years === 33, "Возраст после очистки даты должен остаться");
    const reloaded = await pool.query(
      `SELECT birth_date::text AS birth_date, age_years FROM profiles WHERE id = $1`,
      [CLIENT],
    );
    assert(reloaded.rows[0].birth_date === null, "После повторного чтения дата не NULL");
    assert(Number(reloaded.rows[0].age_years) === 33, "После повторного чтения возраст не 33");

    const now = Date.parse("2026-11-22T00:00:00Z");
    const age = resolveClientAge({
      birthDate: cleared?.birth_date,
      ageYears: cleared?.age_years,
      now,
    });
    assert(age === 33, `Расчёт не использует сохранённый возраст: ${age}`);
    const fromAge = calcBmr({
      gender: "female",
      birth_date: null,
      age_years: 33,
      height_cm: 170,
      weight_kg: 70,
    });
    const fallback = calcBmr({
      gender: "female",
      birth_date: null,
      age_years: null,
      height_cm: 170,
      weight_kg: 70,
    });
    assert(!fromAge.eq(fallback), "Возраст 33 не отличается от подстановки 30 лет");

    await repo.updateProfile(CLIENT, { birth_date: "1993-06-15", age_years: 33 });
    const dated = await pool.query(`SELECT birth_date::text AS birth_date FROM profiles WHERE id = $1`, [
      CLIENT,
    ]);
    assert(dated.rows[0].birth_date === "1993-06-15", `Дата сдвинулась: ${dated.rows[0].birth_date}`);

    const after = await fingerprint(pool);
    assert(JSON.stringify(after.course) === JSON.stringify(before.course), "Действующий курс изменился");
    assert(JSON.stringify(after.menu) === JSON.stringify(before.menu), "Опубликованное меню пересобралось");
    assert(
      JSON.stringify(after.assignment) === JSON.stringify(before.assignment),
      "Назначение опубликованного меню изменилось",
    );
    assert(after.plans === 0, "Появился новый план питания");
    assert(after.log === 0, "Появилась запись в журнале программ");
  } finally {
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
if (entry?.endsWith("profile-birth-date.scenario.ts")) {
  verifyBirthDateOnTestDatabase()
    .then(() => {
      console.log("birth-date scenarios ok");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
