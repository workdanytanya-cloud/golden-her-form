/**
 * Приёмка миграции 013: clean install и upgrade после 011–012.
 * npx vitest run src/lib/selfhost/migrations-013.acceptance.test.ts --pool=forks --maxWorkers=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { applyMigrations, listMigrationFiles } from "@/lib/selfhost/migrate";

const STUB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccc13";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureDb(dbName: string): Promise<string | null> {
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
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const parsed = new URL(base);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const cleanUrl = await ensureDb("panovapro_mig_013_clean");
const upgradeUrl = await ensureDb("panovapro_mig_013_upgrade");
if (cleanUrl && upgradeUrl) process.env.MIG_013_READY = "1";

async function seedStubWithLog(pool: pg.Pool) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1,'mig013@test.local','x') ON CONFLICT DO NOTHING`,
    [CLIENT],
  );
  await pool.query(
    `INSERT INTO exercises (id, slug, name, category, difficulty, description)
     VALUES ($1::uuid,'imported-'||$1::text,'Stub013','strength_full','beginner',
             'Создано миграцией 009 для FK media binding')
     ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description`,
    [STUB_ID],
  );
  await pool.query(
    `INSERT INTO exercise_media_bindings (exercise_id, provider, source_url, title, status)
     VALUES ($1::uuid,'youtube','https://www.youtube.com/watch?v=stub013','Stub013','unchecked')
     ON CONFLICT (exercise_id) DO NOTHING`,
    [STUB_ID],
  );
  await pool.query(
    `INSERT INTO exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
     VALUES ($1,null,'https://www.youtube.com/watch?v=stub013',$2)`,
    [STUB_ID, CLIENT],
  );
}

describe.skipIf(!process.env.MIG_013_READY)("migration 013 clean + upgrade", () => {
  let cleanPool: pg.Pool;
  let upgradePool: pg.Pool;

  beforeAll(async () => {
    cleanPool = new pg.Pool({ connectionString: cleanUrl! });
    upgradePool = new pg.Pool({ connectionString: upgradeUrl! });
    await cleanPool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await upgradePool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  }, 60_000);

  afterAll(async () => {
    await cleanPool?.end();
    await upgradePool?.end();
  });

  it("clean install: 001–013 применяются, stub cleanup работает", async () => {
    const first = await applyMigrations(cleanPool);
    expect(first.applied.some((id) => id.startsWith("013"))).toBe(true);
    await seedStubWithLog(cleanPool);
    const sql = fs.readFileSync(
      path.resolve("selfhost/migrations/013_fix_stub_exercise_cleanup.sql"),
      "utf8",
    );
    await cleanPool.query(sql);
    const stub = await cleanPool.query(`SELECT id FROM exercises WHERE id = $1`, [STUB_ID]);
    expect(stub.rowCount).toBe(0);
    const unmatched = await cleanPool.query(
      `SELECT source FROM unmatched_exercise_media WHERE original_exercise_id = $1`,
      [STUB_ID],
    );
    expect(unmatched.rowCount).toBe(1);
    expect(String(unmatched.rows[0].source)).toMatch(/013|011/);
    const log = await cleanPool.query(
      `SELECT exercise_id, new_url FROM exercise_media_change_log WHERE new_url LIKE '%stub013%'`,
    );
    expect(log.rowCount).toBeGreaterThan(0);
    expect(log.rows.every((r: { exercise_id: string | null }) => r.exercise_id == null)).toBe(true);
  }, 90_000);

  it("upgrade: 001–012, затем только 013; журнал сохраняет историю с exercise_id=NULL", async () => {
    const files = listMigrationFiles().filter((f) => !f.id.startsWith("013"));
    await upgradePool.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
      )
    `);
    for (const file of files) {
      const sql = fs.readFileSync(file.filePath, "utf8");
      await upgradePool.query("BEGIN");
      await upgradePool.query(sql);
      await upgradePool.query("INSERT INTO public.schema_migrations (id) VALUES ($1)", [file.id]);
      await upgradePool.query("COMMIT");
    }
    await seedStubWithLog(upgradePool);
    const logBefore = await upgradePool.query(
      `SELECT count(*)::int AS n FROM exercise_media_change_log WHERE new_url LIKE '%stub013%'`,
    );
    expect(Number(logBefore.rows[0].n)).toBeGreaterThan(0);

    const after = await applyMigrations(upgradePool);
    expect(after.applied.some((id) => id.startsWith("013"))).toBe(true);
    expect(after.applied.every((id) => id.startsWith("013"))).toBe(true);

    const stub = await upgradePool.query(`SELECT id FROM exercises WHERE id = $1`, [STUB_ID]);
    expect(stub.rowCount).toBe(0);
    const unmatched = await upgradePool.query(
      `SELECT source FROM unmatched_exercise_media WHERE original_exercise_id = $1`,
      [STUB_ID],
    );
    expect(unmatched.rowCount).toBe(1);
    const logAfter = await upgradePool.query(
      `SELECT exercise_id, new_url FROM exercise_media_change_log WHERE new_url LIKE '%stub013%'`,
    );
    expect(logAfter.rowCount).toBe(Number(logBefore.rows[0].n));
    expect(logAfter.rows.every((r: { exercise_id: string | null }) => r.exercise_id == null)).toBe(
      true,
    );

    const again = await applyMigrations(upgradePool);
    expect(again.applied).toEqual([]);
  }, 120_000);
});
