import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export type SqlClient = {
  query: Pool["query"] | PoolClient["query"];
};

export function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../selfhost/migrations"),
    path.resolve(process.cwd(), "selfhost/migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error("Не найден каталог selfhost/migrations");
}

export function listMigrationFiles(): { id: string; filePath: string }[] {
  const dir = migrationsDir();
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ id: name, filePath: path.join(dir, name) }));
}

export async function applyMigrations(client: SqlClient): Promise<{ applied: string[]; skipped: string[] }> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
  `);
  const applied = new Set<string>();
  const existing = await client.query("SELECT id FROM public.schema_migrations ORDER BY id");
  for (const row of existing.rows as { id: string }[]) applied.add(row.id);

  const appliedNow: string[] = [];
  const skipped: string[] = [];
  for (const file of listMigrationFiles()) {
    if (applied.has(file.id)) {
      skipped.push(file.id);
      continue;
    }
    const sql = fs.readFileSync(file.filePath, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (id) VALUES ($1)", [file.id]);
      await client.query("COMMIT");
      appliedNow.push(file.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  return { applied: appliedNow, skipped };
}
