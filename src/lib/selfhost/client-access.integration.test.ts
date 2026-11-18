/**
 * Focused PostgreSQL check for video overlay and local password reset.
 * npx vitest run src/lib/selfhost/client-access.integration.test.ts src/lib/exercise-playback.test.ts --pool=forks --maxWorkers=1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { applyMigrations } from "@/lib/selfhost/migrate";
import { closePostgresPool } from "@/lib/selfhost/db";
import { handleSelfhostRequest } from "@/lib/selfhost/http";
import { hashPasswordArgon2id } from "@/lib/selfhost/passwords";
import { resetPasswordResetRateLimitForTests } from "@/lib/selfhost/postgres-password-reset";
import { addVerifiedRutubeSource } from "@/lib/selfhost/exercise-media-sources";
import { toPublishedTrainingView } from "@/lib/selfhost/postgres-published";
import type { TrainingSnapshot } from "@/lib/published-programs/types";
import { csrfCookieName, sessionCookieName } from "@/lib/selfhost/config";

const CLIENT_A = "aa000000-0000-4000-8000-000000000001";
const CLIENT_B = "aa000000-0000-4000-8000-000000000002";
const EX_YT = "aa000000-0000-4000-8000-000000000011";
const EX_BOTH = "aa000000-0000-4000-8000-000000000012";
const EX_B = "aa000000-0000-4000-8000-000000000013";
const VER_A = "aa000000-0000-4000-8000-000000000021";
const VER_B = "aa000000-0000-4000-8000-000000000022";
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const RUTUBE = `https://rutube.ru/video/${"b".repeat(32)}/`;
const RUTUBE_B = `https://rutube.ru/video/${"c".repeat(32)}/`;

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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!(await tryConnect(base))) return null;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const name = "panovapro_client_access_hotfix";
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const parsed = new URL(base);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const databaseUrl = await ensureDb();

function snapshot(exerciseId: string, name: string): TrainingSnapshot {
  return {
    name,
    sessions_per_week: 1,
    goal: null,
    level: "beginner",
    has_injuries: false,
    injuries_details: null,
    equipment: [],
    location: null,
    notes: null,
    faq: [],
    program_weeks: 1,
    days: [
      {
        week_index: 0,
        day_index: 0,
        is_rest: false,
        title: "День",
        focus: null,
        description: null,
        day_note: null,
        warmup: [],
        cooldown: [],
        exercises: [
          {
            exercise_id: exerciseId,
            sets: 3,
            reps: "8",
            rest_seconds: 60,
            tempo: null,
            note: null,
            exercise: {
              id: exerciseId,
              slug: name,
              name,
              category: "strength_full",
              muscle_groups: [],
              equipment: [],
              difficulty: "beginner",
              tags: [],
              description: "Описание упражнения",
              cues: [],
              common_mistakes: [],
              gif_url: null,
              video_url: YOUTUBE,
              default_sets: 3,
              default_reps: "8",
              tempo: null,
              rest_seconds: 60,
            },
          },
        ],
      },
    ],
  };
}

class CookieJar {
  private map = new Map<string, string>();
  csrf = "";
  header(): string {
    return [...this.map.entries()]
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("; ");
  }
  absorb(res: Response) {
    const cookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const cookie of cookies) {
      const pair = cookie.split(";")[0] ?? "";
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = decodeURIComponent(pair.slice(idx + 1).trim());
      this.map.set(name, value);
      if (name === csrfCookieName()) this.csrf = value;
    }
  }
}

async function req(pathname: string, init: { method?: string; jar: CookieJar; body?: string }) {
  const headers = new Headers();
  if (init.body) headers.set("content-type", "application/json");
  if (init.jar.header()) headers.set("cookie", init.jar.header());
  if (init.method && init.method !== "GET") headers.set("x-csrf-token", init.jar.csrf);
  const res = await handleSelfhostRequest(
    new Request(`http://selfhost.local${pathname}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    }),
  );
  if (!res) throw new Error("no response");
  init.jar.absorb(res);
  return res;
}

describe.skipIf(!databaseUrl)("client video and password access", () => {
  let pool: pg.Pool;
  const mailDir = fs.mkdtempSync(path.join(os.tmpdir(), "panova-access-mail-"));

  beforeAll(async () => {
    process.env.AUTH_BACKEND = "local";
    process.env.DATA_BACKEND = "postgres";
    process.env.MEDIA_BACKEND = "local-links";
    process.env.DATABASE_URL = databaseUrl!;
    process.env.NODE_ENV = "test";
    process.env.SELFHOST_PUBLIC_URL = "http://selfhost.local";
    process.env.SELFHOST_MAIL_TRANSPORT = "file";
    process.env.SELFHOST_MAIL_DIR = mailDir;
    process.env.SESSION_COOKIE_SECURE = "0";
    await closePostgresPool();
    pool = new pg.Pool({ connectionString: databaseUrl! });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrations(pool);
    const password = await hashPasswordArgon2id("OldPassw0rd!");
    const other = await hashPasswordArgon2id("OtherPass1!");
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES
        ($1,'access-a@example.test',$3),
        ($2,'access-b@example.test',$4)`,
      [CLIENT_A, CLIENT_B, password, other],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'client'),($2,'client')`, [
      CLIENT_A,
      CLIENT_B,
    ]);
    await pool.query(
      `INSERT INTO exercises (id, slug, name, category, difficulty) VALUES
        ($1,'yt-only','Только YouTube','strength_full','beginner'),
        ($2,'both-video','Оба источника','strength_full','beginner'),
        ($3,'client-b-video','Чужое видео','strength_full','beginner')`,
      [EX_YT, EX_BOTH, EX_B],
    );
    await pool.query(
      `INSERT INTO exercise_media_bindings (exercise_id, provider, source_url, status)
       VALUES ($1,'youtube',$3,'ok'),($2,'youtube',$3,'ok')`,
      [EX_YT, EX_BOTH, YOUTUBE],
    );
    await addVerifiedRutubeSource(pool, EX_BOTH, RUTUBE, "Оба");
    await addVerifiedRutubeSource(pool, EX_B, RUTUBE_B, "Чужое");
    const hashA = "hash-access-a";
    const hashB = "hash-access-b";
    await pool.query(
      `INSERT INTO training_program_versions
         (id, client_id, version, status, snapshot, content_hash, published_at)
       VALUES ($1,$2,1,'published',$3::jsonb,$4, now()),
              ($5,$6,1,'published',$7::jsonb,$8, now())`,
      [
        VER_A,
        CLIENT_A,
        JSON.stringify(snapshot(EX_BOTH, "Программа A")),
        hashA,
        VER_B,
        CLIENT_B,
        JSON.stringify(snapshot(EX_B, "Программа B")),
        hashB,
      ],
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await closePostgresPool();
  });

  it("overlay отдаёт Rutube, не меняет snapshot и не показывает чужое видео", async () => {
    const before = await pool.query(
      `SELECT content_hash, snapshot::text AS snapshot FROM training_program_versions WHERE id = $1`,
      [VER_A],
    );
    const view = await toPublishedTrainingView(pool, {
      source: "published",
      snapshot: snapshot(EX_BOTH, "Программа A"),
      version: {
        id: VER_A,
        client_id: CLIENT_A,
        version: 1,
        status: "published",
        content_hash: "hash-access-a",
        parent_version_id: null,
        created_at: new Date().toISOString(),
        created_by: null,
        published_at: new Date().toISOString(),
        published_by: null,
      },
    });
    const after = await pool.query(
      `SELECT content_hash, snapshot::text AS snapshot FROM training_program_versions WHERE id = $1`,
      [VER_A],
    );
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(after.rows[0].snapshot).toBe(before.rows[0].snapshot);
    const exercise = view?.exercises.find((item) => item.id === EX_BOTH);
    expect(exercise?.video?.url).toContain("rutube.ru");
    expect(exercise?.video?.sources?.some((source) => source.provider === "youtube")).toBe(true);
    expect(JSON.stringify(view)).not.toContain(RUTUBE_B);

    const youtubeOnly = await toPublishedTrainingView(pool, {
      source: "published",
      snapshot: snapshot(EX_YT, "YouTube"),
      version: {
        id: VER_A,
        client_id: CLIENT_A,
        version: 1,
        status: "published",
        content_hash: "hash-access-a",
        parent_version_id: null,
        created_at: new Date().toISOString(),
        created_by: null,
        published_at: new Date().toISOString(),
        published_by: null,
      },
    });
    const yt = youtubeOnly?.exercises.find((item) => item.id === EX_YT);
    expect(yt?.video?.provider).toBe("youtube");
    expect(yt?.video?.fallback_text).toMatch(/YouTube/);
    expect(yt?.video?.embed_url).toBeNull();
  });

  it("reset создаёт один token, не раскрывает email и меняет только нужный пароль", async () => {
    for (const file of fs.readdirSync(mailDir)) fs.unlinkSync(path.join(mailDir, file));
    resetPasswordResetRateLimitForTests();
    const guest = new CookieJar();
    await req("/api/selfhost/csrf", { jar: guest });
    const unknown = await req("/api/selfhost/password-reset/request", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ email: "missing-access@example.test" }),
    });
    const known = await req("/api/selfhost/password-reset/request", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ email: "access-a@example.test" }),
    });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    const unknownBody = await unknown.json();
    const knownBody = await known.json();
    expect(unknownBody.message).toBe(knownBody.message);
    expect(JSON.stringify(knownBody)).not.toMatch(/token=|password/i);
    const tokens = await pool.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [CLIENT_A],
    );
    expect(tokens.rows[0].n).toBe(1);
    const outbox = await pool.query(
      `SELECT count(*)::int AS n FROM mail_outbox WHERE kind = 'password-reset' AND status = 'sent'`,
    );
    expect(outbox.rows[0].n).toBe(1);
    expect(fs.readdirSync(mailDir)).toHaveLength(1);

    const captured = JSON.parse(
      fs.readFileSync(path.join(mailDir, fs.readdirSync(mailDir)[0]!), "utf8"),
    ) as { text: string };
    const token = decodeURIComponent(captured.text.match(/token=([^\s]+)/)![1]!);
    const before = await pool.query(`SELECT id, password_hash FROM users ORDER BY id`);
    const confirm = await req("/api/selfhost/password-reset/confirm", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ token, password: "NewAccess1!" }),
    });
    expect(confirm.status).toBe(200);
    const again = await req("/api/selfhost/password-reset/confirm", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ token, password: "NewAccess2!" }),
    });
    expect(again.status).toBe(400);
    const after = await pool.query(`SELECT id, password_hash FROM users ORDER BY id`);
    const changed = after.rows.filter(
      (row, index) => row.password_hash !== before.rows[index].password_hash,
    );
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe(CLIENT_A);
    expect(String(changed[0].password_hash).startsWith("$argon2")).toBe(true);

    const oldLogin = new CookieJar();
    await req("/api/selfhost/csrf", { jar: oldLogin });
    expect(
      (
        await req("/api/selfhost/login", {
          method: "POST",
          jar: oldLogin,
          body: JSON.stringify({ email: "access-a@example.test", password: "OldPassw0rd!" }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await req("/api/selfhost/login", {
          method: "POST",
          jar: oldLogin,
          body: JSON.stringify({ email: "access-a@example.test", password: "NewAccess1!" }),
        })
      ).status,
    ).toBe(200);
    expect(oldLogin.header()).toContain(sessionCookieName());
    expect(
      (
        await req("/api/selfhost/login", {
          method: "POST",
          jar: oldLogin,
          body: JSON.stringify({ email: "access-b@example.test", password: "OtherPass1!" }),
        })
      ).status,
    ).toBe(200);

    resetPasswordResetRateLimitForTests();
    for (const file of fs.readdirSync(mailDir)) fs.unlinkSync(path.join(mailDir, file));
    await req("/api/selfhost/password-reset/request", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ email: "access-a@example.test" }),
    });
    const open = await pool.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [CLIENT_A],
    );
    expect(open.rows[0].n).toBe(1);
    await pool.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND used_at IS NULL`,
      [CLIENT_A],
    );
    const expiredText = JSON.parse(
      fs.readFileSync(path.join(mailDir, fs.readdirSync(mailDir)[0]!), "utf8"),
    ).text as string;
    const expiredToken = decodeURIComponent(expiredText.match(/token=([^\s]+)/)![1]!);
    const expired = await req("/api/selfhost/password-reset/confirm", {
      method: "POST",
      jar: guest,
      body: JSON.stringify({ token: expiredToken, password: "ExpiredPass1!" }),
    });
    expect(expired.status).toBe(400);
  });
});
