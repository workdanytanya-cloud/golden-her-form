import pg from "pg";
import { requireDatabaseUrl } from "@/lib/selfhost/config";

let pool: pg.Pool | null = null;

export function getPostgresPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requireDatabaseUrl(),
      max: 10,
    });
  }
  return pool;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function checkPostgresHealth(): Promise<"up" | "down"> {
  try {
    const result = await getPostgresPool().query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1 ? "up" : "down";
  } catch {
    return "down";
  }
}
