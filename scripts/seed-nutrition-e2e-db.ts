/**
 * Отдельная тестовая БД для browser E2E nutrition (не production).
 * Запуск: npx tsx scripts/seed-nutrition-e2e-db.ts
 */
import pg from "pg";
import { hashPasswordArgon2id } from "../src/lib/selfhost/passwords";
import { applyMigrations } from "../src/lib/selfhost/migrate";
import { seedNutritionCatalog } from "../src/lib/selfhost/postgres-nutrition";

const BASE =
  process.env.SELFHOST_TEST_DATABASE_URL ??
  "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";
const DB_NAME = "panovapro_nutrition_e2e";

const ADMIN_ID = "a1111111-1111-4111-8111-111111111111";
const CLIENT_ID = "b2222222-2222-4222-8222-222222222222";
const COURSE_ID = "c3333333-3333-4333-8333-333333333333";

async function main() {
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const url = new URL(BASE);
  url.pathname = `/${DB_NAME}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const mig = await applyMigrations(pool);
  console.log("migrations applied:", mig.applied.join(", ") || "(none)");
  console.log("migrations skipped:", mig.skipped.length);

  const passwordHash = await hashPasswordArgon2id("Passw0rd!");
  await pool.query(
    `INSERT INTO users (id, email, password_hash, email_verified_at)
     VALUES ($1,'trainer-admin@example.test',$2, now()), ($3,'client-a@example.test',$2, now())
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email`,
    [ADMIN_ID, passwordHash, CLIENT_ID],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin'), ($2,'client')
     ON CONFLICT DO NOTHING`,
    [ADMIN_ID, CLIENT_ID],
  );
  await pool.query(
    `INSERT INTO profiles (id, full_name, birth_date, gender, height_cm, goal)
     VALUES
       ($1,'Тренер E2E','1990-01-01','female',170,'maintain'),
       ($2,'Клиент E2E','1995-05-05','female',165,'lose_weight')
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
    [ADMIN_ID, CLIENT_ID],
  );
  await pool.query(
    `INSERT INTO client_access (user_id, status, unlock_source)
     VALUES ($1,'active','promo')
     ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
    [CLIENT_ID],
  );
  await pool.query(
    `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status)
     VALUES ($1,$2,'Курс E2E питания','2026-01-01','2026-01-28','active')
     ON CONFLICT (id) DO UPDATE SET status = 'active'`,
    [COURSE_ID, CLIENT_ID],
  );
  await seedNutritionCatalog(pool);
  await pool.end();
  console.log("E2E_DATABASE_URL=" + url.toString());
  console.log("ADMIN=trainer-admin@example.test / Passw0rd!");
  console.log("CLIENT=client-a@example.test / Passw0rd!");
  console.log("CLIENT_ID=" + CLIENT_ID);
  console.log("COURSE_ID=" + COURSE_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
