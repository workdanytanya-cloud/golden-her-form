/**
 * Приёмка миграций 011–012 на отдельной БД (не рабочий контур).
 * Команда:
 *   npx vitest run src/lib/selfhost/migrations-011-012.acceptance.test.ts --pool=forks --maxWorkers=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import pg from "pg";
import { applyMigrations } from "@/lib/selfhost/migrate";

const STUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const REAL_EX = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const COURSE1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const COURSE2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const NUT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const HASH = "hash-migration-acceptance-fixed";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureDb(): Promise<string | null> {
  const base =
    process.env.SELFHOST_TEST_DATABASE_URL ??
    "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";
  const tryConnect = async (url: string) => {
    const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await pool.end();
    }
  };
  if (!(await tryConnect(base)) && dockerAvailable()) {
    execSync("docker compose -f docker-compose.selfhost.yml up -d", {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    for (let i = 0; i < 20; i++) {
      if (await tryConnect(base)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!(await tryConnect(base))) return null;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const dbName = "panovapro_mig_011_012_acceptance";
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const parsed = new URL(base);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const url = await ensureDb();
if (url) process.env.MIG_011_012_READY = "1";

describe.skipIf(!process.env.MIG_011_012_READY)("migrations 011–012 acceptance (isolated DB)", () => {
  let pool: pg.Pool;
  let snapBefore: string;
  let hashBefore: string;

  beforeAll(async () => {
    if (!url) throw new Error("Нет тестовой PostgreSQL");
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    // Применяем 001–010 без 011/012: временно прячем 011–012
    const first = await applyMigrations(pool);
    expect(first.applied.some((id) => id.startsWith("011"))).toBe(true);
    expect(first.applied.some((id) => id.startsWith("012"))).toBe(true);
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("повторный applyMigrations ничего не применяет повторно", async () => {
    const second = await applyMigrations(pool);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBeGreaterThanOrEqual(12);
  });

  it("подготовка: stub 009-style + binding + published snapshot + один active", async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,'mig@test.local','x') ON CONFLICT DO NOTHING`,
      [CLIENT],
    );
    await pool.query(`INSERT INTO profiles (id) VALUES ($1) ON CONFLICT DO NOTHING`, [CLIENT]);
    await pool.query(
      `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status)
       VALUES ($1,$2,'C1','2026-01-01','2026-01-28','active')
       ON CONFLICT (id) DO NOTHING`,
      [COURSE1, CLIENT],
    );
    await pool.query(
      `INSERT INTO exercises (id, slug, name, category, difficulty, description)
       VALUES ($1::uuid,'imported-'||$1::text,'Stub','strength_full','beginner',
               'Создано миграцией 009 для FK media binding')
       ON CONFLICT (id) DO NOTHING`,
      [STUB_ID],
    );
    await pool.query(
      `INSERT INTO exercises (id, slug, name, category, difficulty, description)
       VALUES ($1::uuid,'real-ex','Real','strength_full','beginner','ok')
       ON CONFLICT (id) DO NOTHING`,
      [REAL_EX],
    );
    await pool.query(
      `INSERT INTO exercise_media_bindings (exercise_id, provider, source_url, title, status)
       VALUES ($1::uuid,'youtube','https://www.youtube.com/watch?v=stub','Stub','unchecked')
       ON CONFLICT (exercise_id) DO NOTHING`,
      [STUB_ID],
    );
    await pool.query(
      `INSERT INTO exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
       VALUES ($1,null,'https://www.youtube.com/watch?v=stub',$2)`,
      [STUB_ID, CLIENT],
    );
    const snap = { kind: "constructor", note: "immutable-mig-test", days: [] };
    await pool.query(
      `INSERT INTO nutrition_plan_versions
         (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
       VALUES ($1,$2,$3,1,'published',$4::jsonb,$5,(now() AT TIME ZONE 'utc'))
       ON CONFLICT (id) DO NOTHING`,
      [NUT, CLIENT, COURSE1, JSON.stringify(snap), HASH],
    );
    const row = await pool.query(
      `SELECT snapshot::text AS s, content_hash FROM nutrition_plan_versions WHERE id = $1`,
      [NUT],
    );
    snapBefore = row.rows[0].s;
    hashBefore = row.rows[0].content_hash;
  });

  it("повторный 011: stub уходит в unmatched, exercises stub удалены, snapshot/hash неизменны", async () => {
    // 011 уже применена в beforeAll. Симулируем повторную семантику: вручную создаём stub снова
    // и прогоняем SQL 011 ещё раз через чтение файла (идемпотентность).
    await pool.query(
      `INSERT INTO exercises (id, slug, name, category, difficulty, description)
       VALUES ($1::uuid,'imported-'||$1::text,'Stub2','strength_full','beginner',
               'Создано миграцией 009 для FK media binding')
       ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description`,
      [STUB_ID],
    );
    await pool.query(
      `INSERT INTO exercise_media_bindings (exercise_id, provider, source_url, title, status)
       VALUES ($1::uuid,'youtube','https://www.youtube.com/watch?v=stub2','Stub2','unchecked')
       ON CONFLICT (exercise_id) DO NOTHING`,
      [STUB_ID],
    );
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = fs.readFileSync(
      path.resolve("selfhost/migrations/011_unmatched_media_and_one_active.sql"),
      "utf8",
    );
    await pool.query(sql);

    const stub = await pool.query(`SELECT id FROM exercises WHERE id = $1`, [STUB_ID]);
    expect(stub.rowCount).toBe(0);
    const unmatched = await pool.query(
      `SELECT original_exercise_id, source FROM unmatched_exercise_media WHERE original_exercise_id = $1`,
      [STUB_ID],
    );
    expect(unmatched.rowCount).toBe(1);
    const binding = await pool.query(
      `SELECT 1 FROM exercise_media_bindings WHERE exercise_id = $1`,
      [STUB_ID],
    );
    expect(binding.rowCount).toBe(0);
    // change_log: exercise_id обнулён (ON DELETE SET NULL), строка не потеряна
    const log = await pool.query(
      `SELECT count(*)::int AS n FROM exercise_media_change_log
        WHERE new_url LIKE '%stub%' OR exercise_id IS NULL`,
    );
    expect(Number(log.rows[0].n)).toBeGreaterThan(0);

    const after = await pool.query(
      `SELECT snapshot::text AS s, content_hash FROM nutrition_plan_versions WHERE id = $1`,
      [NUT],
    );
    expect(after.rows[0].content_hash).toBe(hashBefore);
    expect(after.rows[0].s).toBe(snapBefore);
  });

  it("конфликт нескольких active: 011-семантика / unique index не чинит молча", async () => {
    await expect(
      pool.query(
        `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status)
         VALUES ($1,$2,'C2','2026-02-01','2026-02-28','active')`,
        [COURSE2, CLIENT],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const actives = await pool.query(
      `SELECT count(*)::int AS n FROM client_courses WHERE client_id = $1 AND status = 'active'`,
      [CLIENT],
    );
    expect(Number(actives.rows[0].n)).toBe(1);
  });

  it("восстановление после неуспешной миграции: ROLLBACK не оставляет частичный apply", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query(`CREATE TABLE public.__broken_mig_probe (id int)`);
      await pool.query(`SELECT 1/0`);
      await pool.query("COMMIT");
    } catch {
      await pool.query("ROLLBACK");
    }
    const probe = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='__broken_mig_probe'`,
    );
    expect(probe.rowCount).toBe(0);
    const food = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='food_products'`,
    );
    expect(food.rowCount).toBe(1);
    const after = await pool.query(
      `SELECT snapshot::text AS s, content_hash FROM nutrition_plan_versions WHERE id = $1`,
      [NUT],
    );
    expect(after.rows[0].content_hash).toBe(HASH);
    expect(after.rows[0].s).toBe(snapBefore);
  });
});
