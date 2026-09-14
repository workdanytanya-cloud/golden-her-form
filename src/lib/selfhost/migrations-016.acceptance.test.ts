/**
 * Приёмка миграции 016 (measurements idempotency + weekly check-ins).
 * npx vitest run src/lib/selfhost/migrations-016.acceptance.test.ts --pool=forks --maxWorkers=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";
import { applyMigrations, listMigrationFiles } from "@/lib/selfhost/migrate";

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

const cleanUrl = await ensureDb("panovapro_mig_016_clean");
const upgradeUrl = await ensureDb("panovapro_mig_016_upgrade");
if (cleanUrl && upgradeUrl) process.env.MIG_016_READY = "1";

describe.runIf(process.env.MIG_016_READY === "1")("migrations 016 measurements/check-ins", () => {
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

  it("clean install: 001–016, таблицы weekly_check_ins / idempotency", async () => {
    const first = await applyMigrations(cleanPool);
    expect(first.applied.some((id) => id.startsWith("016"))).toBe(true);
    const tables = await cleanPool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'weekly_check_ins','workout_feedback','measurement_write_idempotency'
          )
        ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "measurement_write_idempotency",
      "weekly_check_ins",
      "workout_feedback",
    ]);
    const col = await cleanPool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'admin_notifications' AND column_name = 'measurement_id'`,
    );
    expect(col.rowCount).toBe(1);
    const second = await applyMigrations(cleanPool);
    expect(second.applied).toEqual([]);
  });

  it("upgrade: 001–015 затем 016", async () => {
    const files = listMigrationFiles().filter((f) => !f.id.startsWith("016"));
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
    expect(
      (
        await upgradePool.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name='weekly_check_ins'`,
        )
      ).rowCount,
    ).toBe(0);
    const applied = await applyMigrations(upgradePool);
    expect(applied.applied.some((id) => id.startsWith("016"))).toBe(true);
    expect(applied.applied.every((id) => id.startsWith("016"))).toBe(true);
    expect(
      (
        await upgradePool.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name='measurement_write_idempotency'`,
        )
      ).rowCount,
    ).toBe(1);
    const again = await applyMigrations(upgradePool);
    expect(again.applied).toEqual([]);
  }, 90_000);
});
