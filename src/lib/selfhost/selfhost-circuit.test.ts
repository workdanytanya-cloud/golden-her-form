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
import {
  importClients,
  normalizeExportPayload,
  ImportAbortError,
} from "@/lib/selfhost/import-client";
import { resetLoginRateLimitForTests } from "@/lib/selfhost/local-auth";
import { hashPasswordArgon2id } from "@/lib/selfhost/passwords";
import { upsertExerciseMediaBinding } from "@/lib/selfhost/postgres-published";
import { publishNutritionVersionPg, seedNutritionCatalog } from "@/lib/selfhost/postgres-nutrition";
import { summarizeSnapshotExerciseIds } from "@/lib/selfhost/media";
import { trainingPdfLines, nutritionPdfLines } from "@/lib/pdf/snapshot-content";
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
const ORPHAN_EX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99";

function sampleConstructorDay(productId: string, recipeId: string) {
  const mkItem = (
    slot: "main1" | "main2" | "snack1" | "snack2",
    recipeName: string,
    macros: { kcal: string; protein_g: string; fat_g: string; carbs_g: string },
  ) => ({
    slot,
    recipe_id: recipeId,
    recipe_name: recipeName,
    requires_cooking: slot.startsWith("main"),
    prep_time_min: 10,
    steps: ["Готовить"],
    weighing_note: null,
    snack_action: null,
    is_valid: true,
    ...macros,
    fiber_g: "1",
    ingredients: [
      {
        product_id: productId,
        product_name: "Курица",
        grams: "100",
        weighing_note: null,
        kcal_per_100g: macros.kcal,
        protein_per_100g: macros.protein_g,
        fat_per_100g: macros.fat_g,
        carbs_per_100g: macros.carbs_g,
        fiber_per_100g: "1",
        kcal: macros.kcal,
        protein_g: macros.protein_g,
        fat_g: macros.fat_g,
        carbs_g: macros.carbs_g,
        fiber_g: "1",
        sort_order: 0,
      },
    ],
  });
  // Сумма дня = целевые 1800/120/60/180 (±0) — проходит серверную проверку КБЖУ.
  return {
    day_index: 0,
    day_note: "draft-day",
    is_valid: true,
    kcal: "1800",
    protein_g: "120",
    fat_g: "60",
    carbs_g: "180",
    fiber_g: "4",
    items: [
      mkItem("main1", "Черновик блюда", {
        kcal: "500",
        protein_g: "40",
        fat_g: "15",
        carbs_g: "45",
      }),
      mkItem("main2", "Второе блюдо", {
        kcal: "500",
        protein_g: "40",
        fat_g: "15",
        carbs_g: "45",
      }),
      mkItem("snack1", "Перекус 1", {
        kcal: "400",
        protein_g: "20",
        fat_g: "15",
        carbs_g: "45",
      }),
      mkItem("snack2", "Перекус 2", {
        kcal: "400",
        protein_g: "20",
        fat_g: "15",
        carbs_g: "45",
      }),
    ],
  };
}

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
    const cookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
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

async function req(path: string, init: RequestInit & { jar?: CookieJar } = {}): Promise<Response> {
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
    throw new Error(
      "Нет локального PostgreSQL для self-hosted тестов (порт 54332 или SELFHOST_TEST_DATABASE_URL)",
    );
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
    expect(() => normalizeExportPayload({ user: { email: "a@b.c", password: "secret" } })).toThrow(
      /plaintext/,
    );
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
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const url = resolvedTestDatabaseUrl;
    if (!url) throw new Error("PostgreSQL недоступен");
    for (const key of [
      "AUTH_BACKEND",
      "DATA_BACKEND",
      "MEDIA_BACKEND",
      "DATABASE_URL",
      "SESSION_COOKIE_SECURE",
    ]) {
      envBackup[key] = process.env[key];
    }
    process.env.AUTH_BACKEND = "local";
    process.env.DATA_BACKEND = "postgres";
    process.env.MEDIA_BACKEND = "local-links";
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
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("импортирует нескольких клиентов изолированно и повторно", async () => {
    const nut = nutritionSnapshot();
    const trainA = trainingSnapshot();
    const trainB = trainingSnapshot({ name: "Программа B" });
    const payload = {
      clients: [
        {
          user: {
            id: CLIENT_A,
            email: "client-a@example.test",
            password_hash: await bcrypt.hash("Passw0rd!", 10),
          },
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
              status: "completed",
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
          user: {
            id: CLIENT_B,
            email: "client-b@example.test",
            password_hash: await hashPasswordArgon2id("Passw0rd!"),
          },
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

    const mixed = await pool.query(
      "SELECT client_id FROM training_program_versions WHERE id = $1",
      [TR_B],
    );
    expect(mixed.rows[0].client_id).toBe(CLIENT_B);
  });

  it("останавливается при неверном content_hash и не мутирует snapshot", async () => {
    const before = await pool.query(
      "SELECT snapshot, content_hash FROM nutrition_plan_versions WHERE id = $1",
      [NUT_A],
    );
    await expect(
      importClients(() => pool.connect(), {
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
      }),
    ).rejects.toThrow(/content_hash/);
    const after = await pool.query(
      "SELECT snapshot, content_hash FROM nutrition_plan_versions WHERE id = $1",
      [NUT_A],
    );
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(JSON.stringify(after.rows[0].snapshot)).toBe(JSON.stringify(before.rows[0].snapshot));
  });

  it("запрещает UPDATE/DELETE published snapshot", async () => {
    await expect(
      pool.query("UPDATE nutrition_plan_versions SET snapshot = '{}'::jsonb WHERE id = $1", [
        NUT_A,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query("DELETE FROM nutrition_plan_versions WHERE id = $1", [NUT_A]),
    ).rejects.toThrow();
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
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [ADMIN_ID],
    );
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
    const otherCourse = await req(`/api/selfhost/nutrition?courseId=${COURSE_A2}`, {
      jar: clientJar,
    });
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
    await pool.query(`UPDATE client_access SET status = 'suspended' WHERE user_id = $1`, [
      CLIENT_B,
    ]);
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
    const before = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    await pool.query(
      `INSERT INTO exercises (id, slug, name, category, difficulty)
       VALUES ($1,'shared-squat-seed','Приседания','strength_lower','beginner')
       ON CONFLICT (id) DO NOTHING`,
      [EX_ID],
    );
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
    const after = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(JSON.stringify(after.rows[0].snapshot)).toBe(JSON.stringify(before.rows[0].snapshot));

    const jar = new CookieJar();
    await req("/api/selfhost/csrf", { jar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const training = await (
      await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })
    ).json();
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
      const beforeBind = await (
        await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })
      ).json();
      const video = beforeBind.training.exercises[0]?.video;
      expect(video?.url ?? null).toBeFalsy();

      await pool.query(
        `INSERT INTO snapshot_exercise_media_bindings
        (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer)
       VALUES ($1,'0:0:exercises:0',$2,true)`,
        [legacyId, EX_ID],
      );
      const afterBind = await (
        await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })
      ).json();
      expect(afterBind.training.exercises[0].video.url).toContain("youtube.com");
      const hash = await pool.query(
        "SELECT content_hash FROM training_program_versions WHERE id = $1",
        [legacyId],
      );
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
      [
        EX_ID,
        normalizeExerciseVideo({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Видео",
        }),
      ],
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

  it("админка упражнений работает на postgres без Supabase и не трогает snapshot", async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID, "trainer-admin@example.test", await hashPasswordArgon2id("Passw0rd!")],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [ADMIN_ID],
    );

    const snapABefore = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    const snapBBefore = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_B],
    );
    const assignBefore = await pool.query(
      "SELECT id, client_id, kind, course_id, active_version_id FROM client_program_assignments ORDER BY client_id, kind, course_id",
    );
    const snapshotA = JSON.stringify(snapABefore.rows[0].snapshot);
    const snapshotB = JSON.stringify(snapBBefore.rows[0].snapshot);

    const anon = await req("/api/selfhost/admin/exercises");
    expect(anon.status).toBe(401);

    const clientJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    expect((await req("/api/selfhost/admin/exercises", { jar: clientJar })).status).toBe(403);
    const clientWrite = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({
        slug: "client-hack",
        name: "Hack",
        category: "strength_lower",
        difficulty: "beginner",
        muscle_groups: [],
        equipment: [],
        default_sets: 3,
        default_reps: "10",
        rest_seconds: 60,
        tempo: null,
        description: null,
        gif_url: null,
        video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        role: "admin",
      }),
    });
    expect(clientWrite.status).toBe(403);

    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });

    const noCsrf = await handleSelfhostRequest(
      new Request("http://selfhost.local/api/selfhost/admin/exercises", {
        method: "POST",
        headers: { cookie: adminJar.header(), "content-type": "application/json" },
        body: JSON.stringify({
          slug: "no-csrf",
          name: "No CSRF",
          category: "strength_lower",
          difficulty: "beginner",
          muscle_groups: [],
          equipment: [],
          default_sets: 3,
          default_reps: "10",
          rest_seconds: 60,
          tempo: null,
          description: null,
          gif_url: null,
          video_url: null,
        }),
      }),
    );
    expect(noCsrf!.status).toBe(403);

    const zodFail = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        slug: "",
        name: "",
        category: "strength_lower",
        difficulty: "beginner",
        muscle_groups: [],
        equipment: [],
        default_sets: 3,
        default_reps: "10",
        rest_seconds: 60,
        tempo: null,
        description: null,
        gif_url: null,
        video_url: null,
      }),
    });
    expect(zodFail.status).toBe(400);

    const created = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        slug: "admin-glute-bridge",
        name: "Ягодичный мост",
        category: "strength_lower",
        difficulty: "beginner",
        muscle_groups: ["glutes"],
        equipment: ["bodyweight"],
        default_sets: 3,
        default_reps: "12",
        rest_seconds: 45,
        tempo: "2-0-2",
        description: "Таз вверх",
        gif_url: null,
        video_url: null,
      }),
    });
    expect(created.status).toBe(200);
    const newId = (await created.json()).id as string;

    const listed = await (
      await req("/api/selfhost/admin/exercises?q=мост", { jar: adminJar })
    ).json();
    expect(listed.items.some((row: { id: string }) => row.id === newId)).toBe(true);

    const youtube = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        id: newId,
        slug: "admin-glute-bridge",
        name: "Ягодичный мост",
        category: "strength_lower",
        difficulty: "beginner",
        muscle_groups: ["glutes"],
        equipment: ["bodyweight"],
        default_sets: 3,
        default_reps: "12",
        rest_seconds: 45,
        tempo: "2-0-2",
        description: "Таз вверх",
        gif_url: null,
        video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        video_title: "Мост",
        embed_url: "javascript:alert(1)",
        video_embed_url: "https://evil.test/embed",
      }),
    });
    expect(youtube.status).toBe(200);
    const youtubeJson = await youtube.json();
    expect(youtubeJson.video.provider).toBe("youtube");
    expect(youtubeJson.video.embed_url).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");

    const youtuBe = await req("/api/selfhost/admin/exercises/media", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ exercise_id: newId, video_url: "https://youtu.be/dQw4w9WgXcQ" }),
    });
    expect(youtuBe.status).toBe(200);

    const rutube = await req("/api/selfhost/admin/exercises/media", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        exercise_id: newId,
        video_url: `https://rutube.ru/video/${"c".repeat(32)}/`,
      }),
    });
    expect(rutube.status).toBe(200);
    expect((await rutube.json()).video.provider).toBe("rutube");

    const badUrl = await req("/api/selfhost/admin/exercises/media", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ exercise_id: newId, video_url: "https://example.com/not-allowed" }),
    });
    expect(badUrl.status).toBe(400);

    const logBefore = await pool.query(
      "SELECT count(*)::int AS n FROM exercise_media_change_log WHERE exercise_id = $1",
      [newId],
    );
    expect(
      (
        await req(`/api/selfhost/admin/exercises/media?id=${newId}`, {
          method: "DELETE",
          jar: adminJar,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const logAfter = await pool.query(
      "SELECT old_url, new_url FROM exercise_media_change_log WHERE exercise_id = $1 ORDER BY changed_at",
      [newId],
    );
    expect(Number(logAfter.rowCount)).toBeGreaterThan(Number(logBefore.rows[0].n));
    expect(logAfter.rows.at(-1)?.new_url).toBeNull();

    const shared = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        id: EX_ID,
        slug: "shared-squat",
        name: "Приседания",
        category: "strength_lower",
        difficulty: "beginner",
        muscle_groups: ["quads"],
        equipment: [],
        default_sets: 3,
        default_reps: "10",
        rest_seconds: 60,
        tempo: null,
        description: null,
        gif_url: null,
        video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        video_status: "ok",
      }),
    });
    expect(shared.status).toBe(200);

    const used = await (
      await req("/api/selfhost/admin/exercises?media=used", { jar: adminJar })
    ).json();
    const usedRow = used.items.find(
      (row: { id: string; publishedUseCount: number }) => row.id === EX_ID,
    );
    expect(usedRow?.publishedUseCount).toBeGreaterThanOrEqual(2);

    const clientBJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientBJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientBJar,
      body: JSON.stringify({ email: "client-b@example.test", password: "Passw0rd!" }),
    });
    const trainA = await (
      await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar: clientJar })
    ).json();
    const trainB = await (
      await req(`/api/selfhost/training?courseId=${COURSE_B1}`, { jar: clientBJar })
    ).json();
    expect(trainA.training.exercises[0].video.url).toContain("youtube.com");
    expect(trainB.training.exercises[0].video.url).toContain("youtube.com");
    expect(trainA.training.snapshot.days[0].exercises[0].reps).toBe("10");

    await req(`/api/selfhost/admin/exercises/media?id=${EX_ID}`, {
      method: "DELETE",
      jar: adminJar,
      body: "{}",
    });
    const afterUnbind = await (
      await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar: clientJar })
    ).json();
    expect(afterUnbind.training.exercises[0].video?.url ?? null).toBeFalsy();
    expect(afterUnbind.training.snapshot.days[0].exercises[0].exercise.name).toBe("Приседания");

    await req(`/api/selfhost/admin/exercises?id=${newId}`, {
      method: "DELETE",
      jar: adminJar,
      body: "{}",
    });

    const snapAAfter = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    const snapBAfter = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_B],
    );
    const assignAfter = await pool.query(
      "SELECT id, client_id, kind, course_id, active_version_id FROM client_program_assignments ORDER BY client_id, kind, course_id",
    );
    expect(JSON.stringify(snapAAfter.rows[0].snapshot)).toBe(snapshotA);
    expect(JSON.stringify(snapBAfter.rows[0].snapshot)).toBe(snapshotB);
    expect(snapAAfter.rows[0].content_hash).toBe(snapABefore.rows[0].content_hash);
    expect(snapBAfter.rows[0].content_hash).toBe(snapBBefore.rows[0].content_hash);
    expect(JSON.stringify(assignAfter.rows)).toBe(JSON.stringify(assignBefore.rows));

    const again = await applyMigrations(pool);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toContain("008_exercises.sql");
    expect(again.skipped).toContain("009_exercise_integrity.sql");
    expect(again.skipped).toContain("010_client_card.sql");

    const prevUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://panovapro:x@127.0.0.1:1/none";
    await closePostgresPool();
    const down = await req("/api/selfhost/admin/exercises", { jar: adminJar });
    expect(down.status).toBe(503);
    expect((await down.json()).error).toMatch(/PostgreSQL/);
    process.env.DATABASE_URL = prevUrl;
    await closePostgresPool();
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
    const training = await (
      await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar })
    ).json();
    expect(training.training.snapshot.name).toBe("Силовая");
    const pdf = await req("/api/selfhost/pdf", {
      method: "POST",
      jar,
      body: JSON.stringify({ kind: "training", courseId: COURSE_A1 }),
    });
    expect(pdf.status).toBe(200);
    const hash = await pool.query(
      "SELECT content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    expect(hash.rows[0].content_hash).toBe("hash-tr-a");
  });

  it("держит FK media, архив упражнений и приоритет binding", async () => {
    const orphan = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa77";
    await expect(
      pool.query(
        `INSERT INTO exercise_media_bindings (exercise_id, provider, status) VALUES ($1,'youtube','ok')`,
        [orphan],
      ),
    ).rejects.toThrow();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID, "trainer-admin@example.test", await hashPasswordArgon2id("Passw0rd!")],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [ADMIN_ID],
    );
    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });

    const created = await req("/api/selfhost/admin/exercises", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        slug: "archive-me",
        name: "Архивное",
        category: "core",
        difficulty: "beginner",
        muscle_groups: [],
        equipment: [],
        default_sets: 3,
        default_reps: "10",
        rest_seconds: 60,
        tempo: null,
        description: null,
        gif_url: null,
        video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    });
    const exId = (await created.json()).id as string;
    const logsBefore = await pool.query(
      "SELECT count(*)::int AS n FROM exercise_media_change_log WHERE exercise_id = $1",
      [exId],
    );
    expect(
      (
        await req(`/api/selfhost/admin/exercises?id=${exId}`, {
          method: "DELETE",
          jar: adminJar,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const archived = await pool.query(
      "SELECT archived_at, is_active FROM exercises WHERE id = $1",
      [exId],
    );
    expect(archived.rows[0].archived_at).toBeTruthy();
    expect(archived.rows[0].is_active).toBe(false);
    const logsAfter = await pool.query(
      "SELECT count(*)::int AS n FROM exercise_media_change_log WHERE exercise_id = $1",
      [exId],
    );
    expect(Number(logsAfter.rows[0].n)).toBeGreaterThanOrEqual(Number(logsBefore.rows[0].n));
    expect(
      (
        await req("/api/selfhost/admin/exercises/restore", {
          method: "POST",
          jar: adminJar,
          body: JSON.stringify({ id: exId }),
        })
      ).status,
    ).toBe(200);

    await pool.query(
      `UPDATE exercises SET video_url = 'https://example.com/legacy.mp4', video_provider = 'external' WHERE id = $1`,
      [EX_ID],
    );
    await upsertExerciseMediaBinding(
      pool,
      {
        exercise_id: EX_ID,
        provider: "youtube",
        source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embed_url: "https://evil.test/ignored",
        title: "Binding",
        status: "ok",
        fallback_text: null,
      },
      ADMIN_ID,
    );
    const listed = await (
      await req("/api/selfhost/admin/exercises?q=Приседания", { jar: adminJar })
    ).json();
    const row = listed.items.find((item: { id: string }) => item.id === EX_ID);
    expect(row.video_url).toContain("youtube.com");
    expect(row.video_provider).toBe("youtube");
    await expect(pool.query("DELETE FROM exercises WHERE id = $1", [EX_ID])).rejects.toThrow();

    const snapBefore = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    expect(
      (
        await req(`/api/selfhost/admin/exercises?id=${EX_ID}`, {
          method: "DELETE",
          jar: adminJar,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const still = await pool.query("SELECT id, archived_at FROM exercises WHERE id = $1", [EX_ID]);
    expect(still.rowCount).toBe(1);
    expect(still.rows[0].archived_at).toBeTruthy();
    const clientJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    const training = await (
      await req(`/api/selfhost/training?courseId=${COURSE_A1}`, { jar: clientJar })
    ).json();
    expect(training.training.exercises[0].video.url).toContain("youtube.com");
    const snapAfter = await pool.query(
      "SELECT snapshot, content_hash FROM training_program_versions WHERE id = $1",
      [TR_A],
    );
    expect(JSON.stringify(snapAfter.rows[0].snapshot)).toBe(
      JSON.stringify(snapBefore.rows[0].snapshot),
    );
    expect(snapAfter.rows[0].content_hash).toBe(snapBefore.rows[0].content_hash);
    await req("/api/selfhost/admin/exercises/restore", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ id: EX_ID }),
    });
  });

  it("админка клиентов и курсов на postgres без Supabase и без N+1", async () => {
    await pool.query(
      `INSERT INTO onboarding_responses (user_id, goal_primary, completed_at)
       VALUES ($1,'tone', now()) ON CONFLICT (user_id) DO UPDATE SET goal_primary = EXCLUDED.goal_primary`,
      [CLIENT_A],
    );
    await pool.query(
      `INSERT INTO measurements (user_id, measured_on, weight_kg, note) VALUES ($1,'2026-01-10', 68.5, 'тест')`,
      [CLIENT_A],
    );

    const anon = await req("/api/selfhost/admin/clients");
    expect(anon.status).toBe(401);
    const clientJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({ email: "client-a@example.test", password: "Passw0rd!" }),
    });
    expect((await req("/api/selfhost/admin/clients", { jar: clientJar })).status).toBe(403);
    expect(
      (await req(`/api/selfhost/training?clientId=${CLIENT_B}`, { jar: clientJar })).status,
    ).toBe(403);

    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });
    const list = await (await req("/api/selfhost/admin/clients", { jar: adminJar })).json();
    expect(list.queryCount).toBe(1);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    const search = await (
      await req("/api/selfhost/admin/clients?q=Клиент%20А", { jar: adminJar })
    ).json();
    expect(search.items.some((row: { id: string }) => row.id === CLIENT_A)).toBe(true);
    expect(search.items.some((row: { id: string }) => row.id === CLIENT_B)).toBe(false);

    const card = await (
      await req(`/api/selfhost/admin/clients/${CLIENT_A}`, { jar: adminJar })
    ).json();
    expect(card.client.full_name).toBe("Клиент А");
    expect(card.client.onboarding.goal_primary).toBe("tone");
    expect(card.client.latest_measurement.weight_kg).toBe(68.5);
    expect(card.client.course_count).toBeGreaterThanOrEqual(1);

    const noCsrf = await handleSelfhostRequest(
      new Request(`http://selfhost.local/api/selfhost/admin/clients/${CLIENT_A}/access`, {
        method: "POST",
        headers: { cookie: adminJar.header(), "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    );
    expect(noCsrf!.status).toBe(403);

    const hashesBefore = await pool.query(
      "SELECT id, snapshot, content_hash FROM training_program_versions WHERE id IN ($1,$2) ORDER BY id",
      [TR_A, TR_B],
    );
    const assignBefore = await pool.query(
      "SELECT id, client_id, kind, course_id, active_version_id FROM client_program_assignments ORDER BY client_id, kind, course_id",
    );

    const created = await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses`, {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        activate: false,
        notes: "черновик",
        createdBy: CLIENT_B,
        clientId: CLIENT_B,
      }),
    });
    expect(created.status).toBe(200);
    const draft = (await created.json()).course;
    expect(draft.client_id).toBe(CLIENT_A);
    expect(draft.status).toBe("draft");
    expect(draft.created_by).toBe(ADMIN_ID);

    await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses/${draft.id}`, {
      method: "PATCH",
      jar: adminJar,
      body: JSON.stringify({ notes: "обновлён" }),
    });

    const act = await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses/${draft.id}`, {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ op: "activate" }),
    });
    expect(act.status).toBe(200);
    const courses = await (
      await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses`, { jar: adminJar })
    ).json();
    expect(courses.courses.filter((c: { status: string }) => c.status === "active")).toHaveLength(
      1,
    );

    expect(
      (
        await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses/${COURSE_A1}`, {
          method: "DELETE",
          jar: adminJar,
          body: "{}",
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await req(`/api/selfhost/admin/clients/${CLIENT_A}/courses/${COURSE_A1}`, {
          method: "POST",
          jar: adminJar,
          body: JSON.stringify({ op: "archive" }),
        })
      ).status,
    ).toBe(200);

    const resolved = await (
      await req(`/api/selfhost/admin/resolve-course?clientId=${CLIENT_A}`, { jar: adminJar })
    ).json();
    expect(resolved.courseId).toBe(draft.id);

    const hashesAfter = await pool.query(
      "SELECT id, snapshot, content_hash FROM training_program_versions WHERE id IN ($1,$2) ORDER BY id",
      [TR_A, TR_B],
    );
    expect(
      JSON.stringify(
        hashesAfter.rows.map((r: { snapshot: unknown; content_hash: string }) => [
          r.content_hash,
          r.snapshot,
        ]),
      ),
    ).toBe(
      JSON.stringify(
        hashesBefore.rows.map((r: { snapshot: unknown; content_hash: string }) => [
          r.content_hash,
          r.snapshot,
        ]),
      ),
    );
    const assignAfter = await pool.query(
      "SELECT id, client_id, kind, course_id, active_version_id FROM client_program_assignments ORDER BY client_id, kind, course_id",
    );
    expect(JSON.stringify(assignAfter.rows)).toBe(JSON.stringify(assignBefore.rows));
  });

  it("не создаёт фиктивные упражнения для orphan UUID и требует сопоставления", async () => {
    const beforeExercises = await pool.query("SELECT count(*)::int AS n FROM exercises");
    await importClients(() => pool.connect(), {
      user: { id: CLIENT_A, email: "client-a@example.test" },
      exercise_media_bindings: [
        {
          exercise_id: ORPHAN_EX,
          provider: "youtube",
          source_url: "https://www.youtube.com/watch?v=orphan",
          title: "Orphan video",
          status: "unchecked",
        },
      ],
    });
    const stub = await pool.query("SELECT id FROM exercises WHERE id = $1", [ORPHAN_EX]);
    expect(stub.rowCount).toBe(0);
    const afterExercises = await pool.query("SELECT count(*)::int AS n FROM exercises");
    expect(Number(afterExercises.rows[0].n)).toBe(Number(beforeExercises.rows[0].n));
    const unmatched = await pool.query(
      "SELECT original_exercise_id, source FROM unmatched_exercise_media WHERE original_exercise_id = $1",
      [ORPHAN_EX],
    );
    expect(unmatched.rowCount).toBe(1);
    expect(unmatched.rows[0].source).toBe("import");
    const hashes = await pool.query(
      "SELECT content_hash FROM nutrition_plan_versions WHERE id IN ($1,$2) ORDER BY id",
      [NUT_A, NUT_A2],
    );
    expect(hashes.rows.map((r: { content_hash: string }) => r.content_hash)).toEqual([
      "hash-nut-a1",
      "hash-nut-a2",
    ]);
  });

  it("отклоняет импорт с несколькими active-курсами без молчаливого исправления", async () => {
    await expect(
      importClients(() => pool.connect(), {
        user: {
          id: "12121212-1212-4121-8121-121212121212",
          email: "dup-active@example.test",
          password_hash: await bcrypt.hash("Passw0rd!", 10),
        },
        roles: ["client"],
        courses: [
          {
            id: "13131313-1313-4131-8131-131313131311",
            title: "A",
            start_date: "2026-01-01",
            end_date: "2026-01-28",
            status: "active",
          },
          {
            id: "13131313-1313-4131-8131-131313131312",
            title: "B",
            start_date: "2026-02-01",
            end_date: "2026-02-28",
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow(ImportAbortError);
  });

  it("держит один active course на уровне БД", async () => {
    await expect(
      pool.query(
        `INSERT INTO client_courses (client_id, title, start_date, end_date, status)
         VALUES ($1,'Дубль','2026-04-01','2026-04-28','active')`,
        [CLIENT_A],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("отклоняет публикацию пустого/невалидного плана и idempotency с другим payload", async () => {
    await seedNutritionCatalog(pool);
    const product = await pool.query(
      "SELECT id FROM food_products WHERE is_verified = true ORDER BY slug LIMIT 1",
    );
    const recipe = await pool.query("SELECT id FROM recipes ORDER BY slug LIMIT 1");
    const productId = (product.rows[0] as { id: string }).id;
    const recipeId = (recipe.rows[0] as { id: string }).id;
    const day = sampleConstructorDay(productId, recipeId);

    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });

    const before = await pool.query(
      "SELECT count(*)::int AS n FROM nutrition_plan_versions WHERE client_id = $1",
      [CLIENT_A],
    );

    // Пустой draft: сохранить день, затем удалить days — publish должен отказать
    const seedDraft = await req("/api/selfhost/admin/nutrition/draft", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_A,
        courseId: COURSE_A2,
        userId: CLIENT_A,
        targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
        plan_days_count: 7,
        plan_status: "draft",
        meal_schedule_mode: "two_main_two_snacks",
        primary_meal_slot: "lunch",
        days: [day],
      }),
    });
    expect(seedDraft.status).toBe(200);
    const planRow = await pool.query(
      `SELECT id FROM nutrition_plans WHERE user_id = $1 AND course_id = $2`,
      [CLIENT_A, COURSE_A2],
    );
    const planId = (planRow.rows[0] as { id: string }).id;
    await pool.query(`DELETE FROM nutrition_plan_days WHERE plan_id = $1`, [planId]);
    const emptyPub = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ clientId: CLIENT_A, courseId: COURSE_A2 }),
    });
    expect(emptyPub.status).toBe(400);

    const wrongCourse = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ clientId: CLIENT_A, courseId: COURSE_B1 }),
    });
    expect([400, 403]).toContain(wrongCourse.status);

    // is_valid=true, но сумма КБЖУ позиций вне допуска — publish должен отказать по содержимому
    const badKbjuDay = {
      ...day,
      is_valid: true,
      kcal: "900",
      protein_g: "40",
      fat_g: "20",
      carbs_g: "60",
      items: day.items.map((item, idx) => ({
        ...item,
        is_valid: true,
        // Ломаем макросы позиций: сумма дня ≈ 400 ккал при цели 1800
        kcal: idx === 0 ? "400" : "0",
        protein_g: idx === 0 ? "20" : "0",
        fat_g: idx === 0 ? "10" : "0",
        carbs_g: idx === 0 ? "30" : "0",
      })),
    };
    expect(
      (
        await req("/api/selfhost/admin/nutrition/draft", {
          method: "POST",
          jar: adminJar,
          body: JSON.stringify({
            clientId: CLIENT_A,
            courseId: COURSE_A2,
            userId: CLIENT_A,
            targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
            plan_days_count: 7,
            plan_status: "draft",
            meal_schedule_mode: "two_main_two_snacks",
            primary_meal_slot: "lunch",
            days: [badKbjuDay],
          }),
        })
      ).status,
    ).toBe(200);
    const invalidPub = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_A,
        courseId: COURSE_A2,
        idempotencyKey: "idem-invalid-plan-01",
      }),
    });
    expect(invalidPub.status).toBe(400);
    const afterInvalid = await pool.query(
      "SELECT count(*)::int AS n FROM nutrition_plan_versions WHERE client_id = $1",
      [CLIENT_A],
    );
    expect(afterInvalid.rows[0].n).toBe(before.rows[0].n);

    // Некорректные граммовки (отрицательные) при save → 400 (не 500)
    const badGrams = structuredClone(day);
    badGrams.items[0]!.ingredients[0]!.grams = "-1";
    const badGramsSave = await req("/api/selfhost/admin/nutrition/draft", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_A,
        courseId: COURSE_A2,
        userId: CLIENT_A,
        targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
        plan_days_count: 7,
        plan_status: "draft",
        meal_schedule_mode: "two_main_two_snacks",
        primary_meal_slot: "lunch",
        days: [badGrams],
      }),
    });
    expect(badGramsSave.status).toBe(400);

    // Мусорный JSON → 4xx, не 500
    const junk = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ clientId: "not-a-uuid", courseId: COURSE_A2 }),
    });
    expect(junk.status).toBeGreaterThanOrEqual(400);
    expect(junk.status).toBeLessThan(500);

    expect(
      (
        await req("/api/selfhost/admin/nutrition/draft", {
          method: "POST",
          jar: adminJar,
          body: JSON.stringify({
            clientId: CLIENT_A,
            courseId: COURSE_A2,
            userId: CLIENT_A,
            targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
            plan_days_count: 7,
            plan_status: "draft",
            meal_schedule_mode: "two_main_two_snacks",
            primary_meal_slot: "lunch",
            days: [day],
          }),
        })
      ).status,
    ).toBe(200);
    const ok = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_A,
        courseId: COURSE_A2,
        idempotencyKey: "idem-payload-conflict-01",
      }),
    });
    if (ok.status !== 200) {
      throw new Error(`publish failed: ${ok.status} ${await ok.text()}`);
    }

    const day2 = {
      ...day,
      items: day.items.map((item) => ({
        ...item,
        // Меняем только имя (content_hash), макросы остаются в допуске
        recipe_name: `${item.recipe_name} (rev2)`,
      })),
    };
    expect(
      (
        await req("/api/selfhost/admin/nutrition/draft", {
          method: "POST",
          jar: adminJar,
          body: JSON.stringify({
            clientId: CLIENT_A,
            courseId: COURSE_A2,
            userId: CLIENT_A,
            targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
            plan_days_count: 7,
            plan_status: "draft",
            meal_schedule_mode: "two_main_two_snacks",
            primary_meal_slot: "lunch",
            days: [day2],
          }),
        })
      ).status,
    ).toBe(200);
    const conflict = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_A,
        courseId: COURSE_A2,
        idempotencyKey: "idem-payload-conflict-01",
      }),
    });
    expect(conflict.status).toBe(409);

    const after = await pool.query(
      "SELECT count(*)::int AS n FROM nutrition_plan_versions WHERE client_id = $1",
      [CLIENT_A],
    );
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n) + 1);
  });

  it("полный цикл draft → publish → client без Supabase и без мутации старых snapshots", async () => {
    const publishedBefore = await pool.query(
      "SELECT id, snapshot, content_hash, status FROM nutrition_plan_versions WHERE id IN ($1,$2) ORDER BY id",
      [NUT_A, NUT_A2],
    );
    await seedNutritionCatalog(pool);
    const product = await pool.query(
      "SELECT id FROM food_products WHERE is_verified = true ORDER BY slug LIMIT 1",
    );
    const recipe = await pool.query("SELECT id FROM recipes ORDER BY slug LIMIT 1");
    const productId = (product.rows[0] as { id: string }).id;
    const recipeId = (recipe.rows[0] as { id: string }).id;
    const day = sampleConstructorDay(productId, recipeId);

    const adminJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: adminJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ email: "trainer-admin@example.test", password: "Passw0rd!" }),
    });

    expect(
      (await req("/api/selfhost/admin/nutrition/draft", { method: "POST", body: "{}" })).status,
    ).toBe(401);
    const clientJar = new CookieJar();
    await req("/api/selfhost/csrf", { jar: clientJar });
    await req("/api/selfhost/login", {
      method: "POST",
      jar: clientJar,
      body: JSON.stringify({ email: "client-b@example.test", password: "Passw0rd!" }),
    });
    expect(
      (
        await req("/api/selfhost/admin/nutrition/draft", {
          method: "POST",
          jar: clientJar,
          body: JSON.stringify({
            clientId: CLIENT_B,
            targets: { kcal: 1, protein_g: 1, fat_g: 1, carbs_g: 1 },
            days: [],
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req("/api/selfhost/admin/nutrition/draft", {
          method: "POST",
          headers: { cookie: adminJar.header(), "content-type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_B,
            courseId: COURSE_B1,
            targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
            days: [day],
          }),
        })
      ).status,
    ).toBe(403);

    const saved = await req("/api/selfhost/admin/nutrition/draft", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_B,
        courseId: COURSE_B1,
        userId: CLIENT_B,
        created_by: CLIENT_B,
        targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
        plan_days_count: 7,
        plan_status: "draft",
        meal_schedule_mode: "two_main_two_snacks",
        primary_meal_slot: "lunch",
        days: [day],
      }),
    });
    expect(saved.status).toBe(200);
    const reopened = await (
      await req(`/api/selfhost/admin/nutrition/draft?clientId=${CLIENT_B}&courseId=${COURSE_B1}`, {
        jar: adminJar,
      })
    ).json();
    expect(reopened.plan.user_id).toBe(CLIENT_B);
    expect(reopened.days).toHaveLength(1);
    expect(reopened.days[0].items[0].recipe_name).toBe("Черновик блюда");

    const clientDraft = await req("/api/selfhost/nutrition", { jar: clientJar });
    const clientDraftJson = await clientDraft.json();
    expect(clientDraftJson.nutrition).toBeNull();

    const versionsBefore = await pool.query(
      "SELECT count(*)::int AS n FROM nutrition_plan_versions WHERE client_id = $1",
      [CLIENT_B],
    );
    await expect(
      publishNutritionVersionPg(pool, {
        clientId: CLIENT_B,
        courseId: COURSE_B1,
        actorId: "99999999-9999-4999-8999-999999999999",
        days: reopened.days,
        plan: reopened.plan,
      }),
    ).rejects.toThrow();
    const versionsAfterFail = await pool.query(
      "SELECT count(*)::int AS n FROM nutrition_plan_versions WHERE client_id = $1",
      [CLIENT_B],
    );
    expect(Number(versionsAfterFail.rows[0].n)).toBe(Number(versionsBefore.rows[0].n));

    const published1 = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_B,
        courseId: COURSE_B1,
        reason: "trainer_publish",
        idempotencyKey: "idem-nut-b-0001",
      }),
    });
    expect(published1.status).toBe(200);
    const pub1 = await published1.json();
    const publishedAgain = await req("/api/selfhost/admin/nutrition/publish", {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({
        clientId: CLIENT_B,
        courseId: COURSE_B1,
        reason: "trainer_publish",
        idempotencyKey: "idem-nut-b-0001",
      }),
    });
    const pubAgain = await publishedAgain.json();
    expect(pubAgain.idempotent).toBe(true);
    expect(pubAgain.versionId).toBe(pub1.versionId);

    const concurrent = await Promise.all([
      req("/api/selfhost/admin/nutrition/publish", {
        method: "POST",
        jar: adminJar,
        body: JSON.stringify({ clientId: CLIENT_B, courseId: COURSE_B1, reason: "c1" }),
      }),
      req("/api/selfhost/admin/nutrition/publish", {
        method: "POST",
        jar: adminJar,
        body: JSON.stringify({ clientId: CLIENT_B, courseId: COURSE_B1, reason: "c2" }),
      }),
    ]);
    expect(concurrent.every((res) => res.status === 200)).toBe(true);
    const concBodies = await Promise.all(concurrent.map((res) => res.json()));
    const publishedRows = await pool.query(
      "SELECT id, version, status, content_hash, snapshot FROM nutrition_plan_versions WHERE client_id = $1 ORDER BY version",
      [CLIENT_B],
    );
    const live = publishedRows.rows.filter((row: { status: string }) => row.status === "published");
    expect(live).toHaveLength(1);
    expect(publishedRows.rows.some((row: { status: string }) => row.status === "superseded")).toBe(
      true,
    );
    const assignment = await pool.query(
      "SELECT active_version_id FROM client_program_assignments WHERE client_id = $1 AND kind = 'nutrition' AND course_id = $2",
      [CLIENT_B, COURSE_B1],
    );
    expect(assignment.rows[0].active_version_id).toBe(live[0].id);

    const clientView = await (await req("/api/selfhost/nutrition", { jar: clientJar })).json();
    expect(clientView.nutrition.version.id).toBe(live[0].id);
    expect(clientView.nutrition.version.status).toBe("published");
    expect(clientView.nutrition.snapshot.constructor_days[0].items[0].recipe_name).toBe(
      "Черновик блюда",
    );

    const other = await req(`/api/selfhost/nutrition?clientId=${CLIENT_A}`, { jar: clientJar });
    expect(other.status).toBe(403);

    await pool.query("UPDATE recipes SET name = 'Каталог изменён' WHERE id = $1", [recipeId]);
    await pool.query("UPDATE food_products SET name = 'Продукт изменён' WHERE id = $1", [
      productId,
    ]);
    const afterCatalog = await (await req("/api/selfhost/nutrition", { jar: clientJar })).json();
    expect(afterCatalog.nutrition.snapshot.constructor_days[0].items[0].recipe_name).toBe(
      "Черновик блюда",
    );
    expect(JSON.stringify(afterCatalog.nutrition.snapshot)).toBe(JSON.stringify(live[0].snapshot));

    const pdfLines = nutritionPdfLines(afterCatalog.nutrition.snapshot, {
      clientName: "Клиент B",
      courseTitle: "Курс B",
      courseStart: "01.03.2026",
      courseEnd: "28.03.2026",
      issuedAt: "2026-03-02",
    });
    expect(pdfLines.join("\n")).toContain("Черновик блюда");

    const cloned = await req(`/api/selfhost/admin/clients/${CLIENT_B}/courses`, {
      method: "POST",
      jar: adminJar,
      body: JSON.stringify({ activate: false, cloneFromCourseId: COURSE_B1 }),
    });
    expect(cloned.status).toBe(200);
    const newCourse = (await cloned.json()).course as { id: string };
    const newDraft = await (
      await req(
        `/api/selfhost/admin/nutrition/draft?clientId=${CLIENT_B}&courseId=${newCourse.id}`,
        { jar: adminJar },
      )
    ).json();
    expect(newDraft.plan.plan_status).toBe("draft");
    expect(newDraft.days[0].items[0].recipe_name).toBe("Черновик блюда");
    const stillPublished = await pool.query(
      "SELECT snapshot, content_hash, status FROM nutrition_plan_versions WHERE id = $1",
      [live[0].id],
    );
    expect(stillPublished.rows[0].status).toBe("published");
    expect(stillPublished.rows[0].content_hash).toBe(live[0].content_hash);
    expect(JSON.stringify(stillPublished.rows[0].snapshot)).toBe(JSON.stringify(live[0].snapshot));
    const newAssign = await pool.query(
      "SELECT 1 FROM client_program_assignments WHERE course_id = $1 AND kind = 'nutrition'",
      [newCourse.id],
    );
    expect(newAssign.rowCount).toBe(0);

    const publishedAfter = await pool.query(
      "SELECT id, snapshot, content_hash, status FROM nutrition_plan_versions WHERE id IN ($1,$2) ORDER BY id",
      [NUT_A, NUT_A2],
    );
    expect(JSON.stringify(publishedAfter.rows)).toBe(JSON.stringify(publishedBefore.rows));
    expect(concBodies[0].versionId).toBeTruthy();
  });

  it("не обращается к Supabase в local/postgres", () => {
    expect(fetchCalls.some((url) => url.includes("supabase"))).toBe(false);
  });
});
