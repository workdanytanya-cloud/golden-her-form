import pg from "pg";
import { requireDatabaseUrl } from "@/lib/selfhost/config";

let pool: pg.Pool | null = null;
let poolTarget = "";

function parseDatabaseUrl(raw: string): pg.PoolConfig {
  const parsed = new URL(raw);
  const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
  return {
    host,
    port: Number(parsed.port || "5432"),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    max: 10,
    connectionTimeoutMillis: 4000,
  };
}

function poolIdentity(config: pg.PoolConfig): string {
  return `${config.host}:${config.port}/${config.database}/${config.user}`;
}

export function getPostgresPool(): pg.Pool {
  const config = parseDatabaseUrl(requireDatabaseUrl());
  const identity = poolIdentity(config);
  if (pool && poolTarget !== identity) {
    void pool.end();
    pool = null;
  }
  if (!pool) {
    pool = new pg.Pool(config);
    poolTarget = identity;
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
    poolTarget = "";
  }
}

export async function checkPostgresHealth(): Promise<{ status: "up" | "down"; reason?: string }> {
  try {
    const result = await getPostgresPool().query("SELECT 1 AS ok");
    if (Number(result.rows[0]?.ok) === 1) return { status: "up" };
    return { status: "down", reason: "unexpected-result" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: string };
    let target = "";
    try {
      const parsed = new URL(requireDatabaseUrl());
      const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
      target = `${host}:${parsed.port || "5432"}`;
    } catch {
      target = "unparsed";
    }
    return { status: "down", reason: `${err.code ?? err.name ?? "query-failed"}@${target}` };
  }
}
