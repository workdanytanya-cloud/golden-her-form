import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { createSession } from "../../src/lib/selfhost/local-auth";

const databaseUrl = process.env.DATABASE_URL;
const credPath = process.argv[2];
const email = process.argv[3] ?? "player-check@panovapro.local";
const key = process.argv[4] ?? "session";
if (!databaseUrl || !credPath) throw new Error("Нужны DATABASE_URL и путь к локальному файлу");
const url = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/panovapro_player_preview") {
  throw new Error("Сессия создаётся только в локальной проверочной базе");
}
const pool = new pg.Pool({ connectionString: databaseUrl });
const { rows } = await pool.query(`SELECT id FROM public.users WHERE email = $1`, [email]);
const userId = (rows[0] as { id: string } | undefined)?.id;
if (!userId) throw new Error("Локальный клиент не найден");
const token = await createSession(pool, userId);
const text = readFileSync(credPath, "utf8").replace(new RegExp(`(^|\\n)${key}=[^\\n]*`, "g"), "");
writeFileSync(credPath, `${text.trim()}\n${key}=${token}\n`, "utf8");
await pool.end();
console.log("session-ready");
