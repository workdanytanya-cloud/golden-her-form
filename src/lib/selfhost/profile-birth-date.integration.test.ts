import pg from "pg";
import { describe, expect, it } from "vitest";
import { verifyBirthDateOnTestDatabase } from "./profile-birth-date.scenario";

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

describe.skipIf(!ready)("профиль клиента: дата рождения на тестовой базе", () => {
  it("сохраняет возраст без даты, не портит дату и не пересобирает меню", async () => {
    await expect(verifyBirthDateOnTestDatabase()).resolves.toBeUndefined();
  });
});
