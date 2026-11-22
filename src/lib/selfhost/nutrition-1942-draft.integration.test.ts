import pg from "pg";
import { describe, expect, it } from "vitest";
import { verify1942DraftOnTestDatabase } from "./nutrition-1942-draft.scenario";

const adminUrl =
  process.env.SELFHOST_TEST_DATABASE_URL ??
  "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";

async function postgresReady(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const ready = await postgresReady();

describe.skipIf(!ready)("1942 корректирующий черновик на тестовой базе", () => {
  it("сохраняет 7 дней на том же курсе и не трогает published", async () => {
    await expect(verify1942DraftOnTestDatabase()).resolves.toBeUndefined();
  }, 180_000);
});
