import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import { applyMigrations } from "@/lib/selfhost/migrate";
import { closePostgresPool } from "@/lib/selfhost/db";
import { handleSelfhostRequest } from "@/lib/selfhost/http";
import { importClients, normalizeExportPayload } from "@/lib/selfhost/import-client";
import { resetLoginRateLimitForTests } from "@/lib/selfhost/local-auth";
import { hashPasswordArgon2id } from "@/lib/selfhost/passwords";
import { upsertExerciseMediaBinding } from "@/lib/selfhost/postgres-published";
import { summarizeSnapshotExerciseIds } from "@/lib/selfhost/media";
import { trainingPdfLines } from "@/lib/pdf/snapshot-content";
import { buildNutritionPdf, buildTrainingPdf } from "@/lib/pdf/render-pdf";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import type { NutritionSnapshot, TrainingSnapshot } from "@/lib/published-programs/types";

const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const COURSE_A1 = "44444444-4444-4444-8444-444444444441";
const COURSE_A2 = "44444444-4444-4444-8444-444444444442";
const COURSE_B1 = "55555555-5555-4555-8555-555555555551";
const NUT_A = "66666666-6666-4666-8666-666666666661";
const NUT_A2 = "66666666-6666-4666-8666-666666666662";
const TR_A = "77777777-7777-4777-8777-777777777771";
const TR_B = "77777777-7777-4777-8777-777777777772";
const EX_ID = "88888888-8888-4888-8888-888888888888";
const ASSIGN_N_A = "99999999-9999-4999-8999-999999999991";
const ASSIGN_T_A = "99999999-9999-4999-8999-999999999992";

function nutritionSnapshot(): NutritionSnapshot {
  return {
    kind: "constructor",
    meal_schedule_mode: "two_main_two_snacks",
    primary_meal_slot: "lunch",
    meals_per_day: 4,
    targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
    bmr: 1400,
    tdee: 1800,
    calorie_adjustment_pct: 0,
    notes: "Держим граммовки",
    reason: "publish",
    constructor_days: [
      {
        day_index: 0,
        day_note: "Старт",
        kcal: "1800",
        protein_g: "120",
        fat_g: "60",
        carbs_g: "180",
        fiber_g: "20",
        items: [
          {
            slot: "main1",
            recipe_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
            recipe_name: "Курица с рисом",
            requires_cooking: true,
            prep_time_min: 20,
            steps: ["Готовить"],
            weighing_note: null,
            snack_action: null,
            replacements: [],
            kcal: "500",
            protein_g: "40",
            fat_g: "10",
            carbs_g: "50",
            fiber_g: "4",
            ingredients: [
              {
                product_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
                product_name: "Курица",
                grams: "150",
                weighing_note: null,
                measurement_state: null,
                kcal_per_100g: "120",
                protein_per_100g: "23",
                fat_per_100g: "2",
                carbs_per_100g: "0",
                fiber_per_100g: "0",
                kcal: "180",
                protein_g: "34",
                fat_g: "3",
                carbs_g: "0",
                fiber_g: "0",
                sort_order: 0,
              },
            ],
          },
        ],
      },
    ],
    legacy_days: [],
  };
}

function trainingSnapshot(opts?: { exerciseId?: string | null; name?: string }): TrainingSnapshot {
  const exerciseId = opts?.exerciseId === undefined ? EX_ID : opts.exerciseId;
  const frozen = exerciseId
    ? {
        id: exerciseId,
        slug: "squat",
        name: "Приседания",
        category: "legs",
        muscle_groups: ["quads"],
        equipment: [],
        difficulty: "beginner",
        tags: [],
        description: null,
        cues: ["Колени"],
        common_mistakes: [],
        gif_url: null,
        video_url: null,
        default_sets: 3,
        default_reps: "10",
        tempo: null,
        rest_seconds: 60,
      }
    : {
        id: "",
        slug: "legacy-move",
        name: "Старое упражнение",
        category: "other",
        muscle_groups: [],
        equipment: [],
        difficulty: "beginner",
        tags: [],
        description: null,
        cues: [],
        common_mistakes: [],
        gif_url: null,
        video_url: null,
        default_sets: 3,
        default_reps: "8",
        tempo: null,
        rest_seconds: 45,
      };
  return {
    name: opts?.name ?? "Силовая",
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
        title: "День 1",
        focus: null,
        description: null,
        day_note: null,
        warmup: [],
        cooldown: [],
        exercises: [
          {
            exercise_id: exerciseId || "",
            sets: 3,
            reps: "10",
            rest_seconds: 60,
            tempo: null,
            note: null,
            exercise: frozen,
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
    return [...this.map.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  }
  absorb(res: Response) {
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const cookie of cookies) {
      const pair = cookie.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = decodeURIComponent(pair.slice(idx + 1).trim());
      this.map.set(name, value);
      if (name === "panovapro_csrf") this.csrf = value;
    }
  }
}

async function req(
  path: string,
  init: RequestInit & { jar?: CookieJar } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.jar) {
    headers.set("cookie", init.jar.header());
    if (init.method && init.method !== "GET") headers.set("x-csrf-token", init.jar.csrf);
  }
  const res = await handleSelfhostRequest(
    new Request(`http://selfhost.local${path}`, { ...init, headers }),
  );
  if (!res) throw new Error("selfhost handler skipped");
  if (init.jar) init.jar.absorb(res);
  return res;
}

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureTestDatabase(): Promise<string> {
  const base =
    process.env.SELFHOST_TEST_DATABASE_URL ??
    "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro";
  const parsed = new URL(base);
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
  if (!(await tryConnect(base))) {
    throw new Error("Нет локального PostgreSQL для self-hosted тестов (порт 54332 или SELFHOST_TEST_DATABASE_URL)");
  }
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const dbName = "panovapro_selfhost_tests";
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${dbName}`);
  }
  await admin.end();
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const meta = {
  clientName: "Клиент Тест",
  courseTitle: "Курс",
  courseStart: "01.01.2026",
  courseEnd: "28.01.2026",
  issuedAt: "2026-01-02",
};

async function resolveTestDatabaseUrl(): Promise<string | null> {
  try {
    return await ensureTestDatabase();
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
    return null;
  }
}

const resolvedTestDatabaseUrl = await resolveTestDatabaseUrl();
if (resolvedTestDatabaseUrl) process.env.SELFHOST_TEST_DATABASE_READY = "1";

describe("selfhost import validation (без БД)", () => {
  it("отклоняет plaintext-пароль", () => {
    expect(() =>
      normalizeExportPayload({ user: { email: "a@b.c", password: "secret" } }),
    ).toThrow(/plaintext/);
  });

  it("считает упражнения без id как ручное сопоставление", () => {
    const stats = summarizeSnapshotExerciseIds(trainingSnapshot({ exerciseId: null }));
    expect(stats.total).toBe(1);
    expect(stats.withExerciseId).toBe(0);
    expect(stats.needingManualMatch).toBe(1);
  });
});

describe.skipIf(!process.env.SELFHOST_TEST_DATABASE_READY)("self-hosted PostgreSQL circuit", () => {
  let pool: pg.Pool;
  let fetchCalls: string[];

  beforeAll(async () => {
    const url = resolvedTestDatabaseUrl;
    if (!url) throw new Error("PostgreSQL недоступен");
    process.env.AUTH_BACKEND = "local";
    process.env.DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = url;
    process.env.SESSION_COOKIE_SECURE = "0";
    process.env.NODE_ENV = "test";
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const first = await applyMigrations(pool);
    expect(first.applied.length).toBeGreaterThan(0);
    const second = await applyMigrations(pool);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(first.applied.length);
    fetchCalls = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push(href);
      if (href.includes("supabase")) {
        throw new Error("Supabase request in local/postgres mode");
      }
      return original(input, init);
    }) as typeof fetch;
  }, 60000);

  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  afterAll(async () => {
    await pool?.end();
    await closePostgresPool();
  });

  it("импортирует нескольких клиентов изолированно и повторно", async () => {
    const nut = nutritionSnapshot();
    const trainA = trainingSnapshot();
    const trainB = trainingSnapshot({ name: "Программа B" });
    const payload = {
      clients: [
        {
          user: { id: CLIENT_A, email: "client-a@example.test", password_hash: await bcrypt.hash("Passw0rd!", 10) },
          roles: ["client"],
          profile: { full_name: "Клиент А" },
          access: { status: "active", unlock_source: "promo" },
          courses: [
            {
              id: COURSE_A1,
              title: "Курс 1",
              start_date: "2026-01-01",
              end_date: "2026-01-28",
              status: "active",
            },
            {
              id: COURSE_A2,
              title: "Курс 2",
              start_date: "2026-02-01",
              end_date: "2026-02-28",
              status: "active",
            },
          ],
          nutrition_versions: [
            {
              id: NUT_A,
              client_id: CLIENT_A,
              course_id: COURSE_A1,
              version: 1,
              status: "published",
              snapshot: nut,
              content_hash: "hash-nut-a1",
              published_at: "2026-01-02T00:00:00Z",
            },
            {
              id: NUT_A2,
              client_id: CLIENT_A,
              course_id: COURSE_A2,
              version: 2,
              status: "published",
              snapshot: nut,
              content_hash: "hash-nut-a2",
              published_at: "2026-02-02T00:00:00Z",
            },
          ],
          training_versions: [
            {
              id: TR_A,
              client_id: CLIENT_A,
              course_id: COURSE_A1,
              version: 1,
              status: "published",
              snapshot: trainA,
              content_hash: "hash-tr-a",
              published_at: "2026-01-02T00:00:00Z",
            },
          ],
          assignments: [
            {
              id: ASSIGN_N_A,
              client_id: CLIENT_A,
              kind: "nutrition",
              course_id: COURSE_A1,
              active_version_id: NUT_A,
            },
            {
              client_id: CLIENT_A,
              kind: "nutrition",
              course_id: COURSE_A2,
              active_version_id: NUT_A2,
            },
            {
              id: ASSIGN_T_A,
              client_id: CLIENT_A,
              kind: "training",
              course_id: COURSE_A1,
              active_version_id: TR_A,
            },
          ],
        },
        {
          user: { id: CLIENT_B, email: "client-b@example.test", password_hash: await hashPasswordArgon2id("Passw0rd!") },
          roles: ["client"],
          profile: { full_name: "Клиент B" },
          access: { status: "active" },
          courses: [
            {
              id: COURSE_B1,
              title: "Курс B",
              start_date: "2026-03-01",
              end_date: "2026-03-28",
              status: "active",
            },
          ],
          training_versions: [
            {
              id: TR_B,
              client_id: CLIENT_B,
              course_id: COURSE_B1,
              version: 1,
              status: "published",
              snapshot: trainB,
              content_hash: "hash-tr-b",
              published_at: "2026-03-02T00:00:00Z",
            },
          ],
          assignments: [
            {
              client_id: CLIENT_B,
              kind: "training",
              course_id: COURSE_B1,
              active_version_id: TR_B,
            },
          ],
        },
      ],
    };

    const first = await importClients(() => pool.connect(), payload);
    expect(first.clients).toHaveLength(2);
    expect(first.clients[0].userId).toBe(CLIENT_A);
    expect(first.clients[1].userId).toBe(CLIENT_B);
    expect(first.clients[0].contentHashes).toContain("hash-nut-a1");

    const again = await importClients(() => pool.connect(), payload);
    expect(again.clients[0].skippedPublishedSnapshots).toBeGreaterThan(0);

    const mixed = await pool.query("SELECT client_id FROM training_program_versions WHERE id = $1", [TR_B]);
    expect(mixed.rows[0].client_id).toBe(CLIENT_B);
  });

  it("останавливается при неверном content_hash и не мутирует snapshot", async () => {
    const before = await pool.query("SELECT snapshot, content_hash FROM nutrition_plan_versions WHERE id = $1", [
      NUT_A,
    ]);
    await expect(
      importClients(
        () => pool.connect(),
        {
          user: { id: CLIENT_A, email: "client-a@example.test" },
          nutrition_versions: [
            {
              id: NUT_A,
              snapshot: nutritionSnapshot(),
              content_hash: "other-hash",
              status: "published",
              version: 1,
              course_id: COURSE_A1,
            },
          ],
        },
      ),
    ).rejects.toThrow(/content_hash/);
    const after = await pool.query("SELECT snapshot, content_hash FROM nutrition_plan_versions WHERE id = $1", [NUT_A]);
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(JSON.stringify(after.rows[0].snapshot)).toBe(JSON.stringify(before.rows[0].snapshot));
  });

  it("запрещает UPDATE/DELETE published snapshot", async () => {
    await expect(
      pool.query("UPDATE nutrition_plan_versions SET snapshot = '{}'::jsonb WHERE id = $1", [NUT_A]),
    ).rejects.toThrow();
    await expect(pool.query("DELETE FROM nutrition_plan_versions WHERE id = $1", [NUT_A])).rejects.toThrow();
  });

  it("логинит bcrypt, перехеширует в Argon2id, выдаёт httpOnly cookie и logout", async () => {
    const jar = new CookieJar();
    const csrf = await req("/api/selfhost/csrf", { jar });
    expect(csrf.status).toBe(200);
    const login = await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.getSetCookie().join("; ");
    expect(setCookie).toMatch(/panovapro_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const hash = await pool.query("SELECT password_hash FROM users WHERE id = $1", [CLIENT_A]);
    expect(hash.rows[0].password_hash.startsWith("$argon2")).toBe(true);

    const me = await req("/api/selfhost/me", { jar });
    const meJson = await me.json();
    expect(meJson.session.userId).toBe(CLIENT_A);

    const logout = await req("/api/selfhost/logout", { method: "POST", jar, body: "{}" });
    expect(logout.status).toBe(200);
    const me2 = await req("/api/selfhost/me", { jar });
    expect((await me2.json()).session).toBeNull();
  });

  it("логинит Argon2id и отклоняет неизвестный email тем же текстом", async () => {
    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    const bad = await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "nobody@example.test", password: "Passw0rd!" }),
    });
    const badJson = await bad.json();
    const jar2 = new CookieJar();
    await req("/api/selfhost/csrf", { jar: jar2 });
    const wrong = await req("/api/selfhost/login", {
      method: "POST",
      jar: jar2,
      body: JSON.stringify({ email: "client-b@example.test", password: "nope-nope" }),
    });
    const wrongJson = await wrong.json();
    expect(badJson.error).toBe(wrongJson.error);
    const ok = await req("/api/selfhost/login", {
      method: "POST",
      jar: jar2,
      body: JSON.stringify({ email: "client-b@example.test", password: "Passw0rd!" }),
    });
    expect(ok.status).toBe(200);
  });

  it("не принимает истёкшую и отозванную сессию", async () => {
    const token = "expired-token-value";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
       VALUES ($1,$2, now() - interval '1 hour', NULL)`,
      [CLIENT_B, tokenHash],
    );
    const expired = await handleSelfhostRequest(
      new Request("http://selfhost.local/api/selfhost/me", {
        headers: { cookie: `panovapro_session=${token}` },
      }),
    );
    expect((await expired!.json()).session).toBeNull();

    const live = "revoked-token-value";
    const liveHash = createHash("sha256").update(live).digest("hex");
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
       VALUES ($1,$2, now() + interval '1 day', now())`,
      [CLIENT_B, liveHash],
    );
    const revoked = await handleSelfhostRequest(
      new Request("http://selfhost.local/api/selfhost/me", {
        headers: { cookie: `panovapro_session=${live}` },
      }),
    );
    expect((await revoked!.json()).session).toBeNull();
  });

  it("изолирует клиентов и пускает admin ко всем published", async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID, "trainer-admin@example.test", await hashPasswordArgon2id("Passw0rd!")],
    );
    await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`, [
      ADMIN_ID,
    ]);
    await pool.query(
      `INSERT INTO client_access (user_id, status) VALUES ($1,'active') ON CONFLICT DO NOTHING`,
      [ADMIN_ID],
    );

    const clientJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const foreign = await req(`/api/selfhost/training?clientId=${CLIENT_B}`, { jar: clientJar });
    expect(foreign.status).toBe(403);

    const own = await req(`/api/selfhost/nutrition?courseId=${COURSE_A1}`, { jar: clientJar });
    expect(own.status).toBe(200);
    const otherCourse = await req(`/api/selfhost/nutrition?courseId=${COURSE_A2}`, { jar: clientJar });
    const a1 = await own.json();
    const a2 = await otherCourse.json();
    expect(a1.nutrition.version.id).toBe(NUT_A);
    expect(a2.nutrition.version.id).toBe(NUT_A2);

    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    const adminLogin = await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });
    expect(adminLogin.status).toBe(200);
    const asA = await req(`/api/selfhost/training?clientId=${CLIENT_A}`, { jar: adminJar });
    const asB = await req(`/api/selfhost/training?clientId=${CLIENT_B}`, { jar: adminJar });
    expect(asA.status).toBe(200);
    expect(asB.status).toBe(200);
  });

  it("закрывает программу при inactive access", async () => {
    await pool.query(`UPDATE client_access SET status = 'suspended' WHERE user_id = $1`, [CLIENT_B]);
    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-b@example.test", password: "Passw0rd!" }),
    });
    const blocked = await req("/api/selfhost/training", { jar });
    expect(blocked.status).toBe(403);
    await pool.query(`UPDATE client_access SET status = 'active' WHERE user_id = $1`, [CLIENT_B]);
  });

  it("не меняет snapshot/content_hash при смене video binding и шарит его по exercise_id", async () => {
    const before = await pool.query("SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1", [
      TR_A,
    ]);
    await upsertExerciseMediaBinding(
      pool,
      {
        exercise_id: EX_ID,
        provider: "youtube",
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embed_url: null,
        title: "Разбор",
        status: "ok",
        fallback_text: null,
      },
      ADMIN_ID,
    );
    const after = await pool.query("SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1", [
      TR_A,
    ]);
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(JSON.stringify(after.rows[0].snapshot)).toBe(JSON.stringify(before.rows[0].snapshot));

    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const training = await (await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })).json();
    expect(training.training.exercises[0].video.url).toContain("youtube.com");
    expect(training.training.version.content_hash).toBe("hash-tr-a");
  });

  it("legacy snapshot без exercise_id требует явного подтверждения", async () => {
    const legacyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
    const legacySnap = trainingSnapshot({ exerciseId: null, name: "Legacy" });
    expect(summarizeSnapshotExerciseIds(legacySnap).needingManualMatch).toBe(1);
    await pool.query(
      `INSERT INTO training_program_versions
        (id, client_id, course_id, version, status, snapshot, content_hash, published_at)
       VALUES ($1,$2,$3,9,'published',$4::jsonb,'hash-legacy', now())`,
      [legacyId, CLIENT_A, COURSE_A1, JSON.stringify(legacySnap)],
    );
    await pool.query(
      `UPDATE client_program_assignments SET active_version_id = $1
       WHERE client_id = $2 AND kind = 'training' AND course_id = $3`,
      [legacyId, CLIENT_A, COURSE_A1],
    );
    try {
    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const beforeBind = await (await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })).json();
    const video = beforeBind.training.exercises[0]?.video;
    expect(video?.url ?? null).toBeFalsy();

    await pool.query(
      `INSERT INTO snapshot_exercise_media_bindings
        (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer)
       VALUES ($1,'0:0:exercises:0',$2,true)`,
      [legacyId, EX_ID],
    );
    const afterBind = await (await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })).json();
    expect(afterBind.training.exercises[0].video.url).toContain("youtube.com");
    const hash = await pool.query("SELECT content_hash FROM training_program_versions WHERE id = $1", [legacyId]);
    expect(hash.rows[0].content_hash).toBe("hash-legacy");
    } finally {
    await pool.query(
      `UPDATE client_program_assignments SET active_version_id = $1
       WHERE client_id = $2 AND kind = 'training' AND course_id = $3`,
      [TR_A, CLIENT_A, COURSE_A1],
    );
    }
  });

  it("строит PDF питания и тренировок из published snapshot, без PII, с кликабельной ссылкой", async () => {
    const overlay = new Map([
      [EX_ID, normalizeExerciseVideo({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Видео" })],
    ]);
    const snap = trainingSnapshot();
    const without = trainingPdfLines(snap, meta);
    const withLink = trainingPdfLines(snap, meta, overlay);
    const extra = withLink.filter((line) => !without.includes(line));
    expect(extra.join("\n")).toMatch(/Видео:/);
    expect(extra.join("\n")).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const programOnly = (lines: string[]) =>
      lines.filter(
        (line) =>
          !line.includes("Видео:") &&
          !line.includes("Видео недоступно") &&
          !line.includes("https://"),
      );
    expect(programOnly(withLink)).toEqual(programOnly(without));

    const nutPdf = await buildNutritionPdf(nutritionSnapshot(), meta);
    const trainPdf = await buildTrainingPdf(snap, meta, overlay);
    expect(nutPdf.slice(0, 4).toString()).toBe("%PDF");
    expect(trainPdf.toString("latin1")).toContain("/URI");

    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const pdf = await req("/api/selfhost/pdf", {
      method: "POST",
      jar,
      body: JSON.stringify({ kind: "nutrition", courseId: COURSE_A1 }),
    });
    expect(pdf.status).toBe(200);
    const trainingPdf = await req("/api/selfhost/pdf", {
      method: "POST",
      jar,
      body: JSON.stringify({ kind: "training", courseId: COURSE_A1 }),
    });
    expect(trainingPdf.status).toBe(200);
    const other = await req("/api/selfhost/pdf", {
      method: "POST",
      jar,
      body: JSON.stringify({ kind: "training", clientId: CLIENT_B }),
    });
    expect(other.status).toBe(403);
  });

  it("отсутствие видео не ломает программу и PDF", async () => {
    await pool.query("DELETE FROM exercise_media_bindings WHERE exercise_id = $1", [EX_ID]);
    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const training = await (await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })).json();
    expect(training.training.snapshot.name).toBe("Силовая");
    const pdf = await req("/api/selfhost/pdf", {
      method: "POST",
      jar,
      body: JSON.stringify({ kind: "training", courseId: COURSE_A1 }),
    });
    expect(pdf.status).toBe(200);
    const hash = await pool.query("SELECT content_hash FROM training_program_versions WHERE id = $1", [TR_A]);
    expect(hash.rows[0].content_hash).toBe("hash-tr-a");
  });

  it("не обращается к Supabase в local/postgres", () => {
    expect(fetchCalls.some((url) => url.includes("supabase"))).toBe(false);
  });
});
