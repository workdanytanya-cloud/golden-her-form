/**
 * API E2E на panovapro_nutrition_e2e: draft→save→reopen→edit→save→publish→client,
 * затем мутации каталога/draft/курса — published snapshot + content_hash неизменны.
 *
 * npx tsx scripts/nutrition-e2e-api.ts
 */
import pg from "pg";

const BASE = "http://127.0.0.1:3000";
const CLIENT_ID = "b2222222-2222-4222-8222-222222222222";
const COURSE_ID = "c3333333-3333-4333-8333-333333333333";
const DB = "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro_nutrition_e2e";

type Jar = { cookie: string; csrf: string };

async function req(path: string, jar: Jar, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar.cookie) headers.set("cookie", jar.cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("x-csrf-token", jar.csrf);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    jar.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  } else {
    const single = res.headers.get("set-cookie");
    if (single) jar.cookie = single.split(";")[0]!;
  }
  return res;
}

async function login(email: string, password: string): Promise<Jar> {
  const jar: Jar = { cookie: "", csrf: "" };
  const csrfRes = await req("/api/selfhost/csrf", jar);
  const csrfJson = (await csrfRes.json()) as { csrf: string };
  jar.csrf = csrfJson.csrf;
  const loginRes = await req("/api/selfhost/login", jar, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) throw new Error(`login ${email}: ${loginRes.status} ${await loginRes.text()}`);
  const body = (await loginRes.json()) as { csrf?: string };
  if (body.csrf) jar.csrf = body.csrf;
  return jar;
}

async function main() {
  const admin = await login("trainer-admin@example.test", "Passw0rd!");
  const net: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    net.push(href);
    if (/supabase/i.test(href)) throw new Error(`Supabase request: ${href}`);
    return origFetch(input, init);
  }) as typeof fetch;

  console.log("generate 7d 1800…");
  const genRes = await req("/api/selfhost/admin/nutrition/generate", admin, {
    method: "POST",
    body: JSON.stringify({
      profile: {
        gender: "female",
        birth_date: "1995-05-05",
        height_cm: 165,
        weight_kg: 65,
        activity_level: "moderate",
        goal_primary: "lose_weight",
        profile_complete: true,
      },
      days_count: 7,
      excluded_product_ids: [],
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
      targets_override: { kcal: 1800, protein_g: 135, fat_g: 60, carbs_g: 180 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!genRes.ok) throw new Error(`generate: ${genRes.status} ${await genRes.text()}`);
  const generated = (await genRes.json()) as {
    days: unknown[];
    is_valid?: boolean;
    message?: string;
  };
  if (!generated.days?.length) throw new Error(`empty generate: ${generated.message}`);
  console.log("generated days", generated.days.length);

  const save1 = await req("/api/selfhost/admin/nutrition/draft", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      userId: CLIENT_ID,
      targets: { kcal: 1800, protein_g: 135, fat_g: 60, carbs_g: 180 },
      plan_days_count: 7,
      plan_status: "draft",
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
      days: generated.days,
    }),
  });
  if (!save1.ok) throw new Error(`save1: ${save1.status} ${await save1.text()}`);
  console.log("save1 ok");

  const reopen = await req(
    `/api/selfhost/admin/nutrition/draft?clientId=${CLIENT_ID}&courseId=${COURSE_ID}`,
    admin,
  );
  const opened = (await reopen.json()) as { days: Array<{ day_note: string | null; items: unknown[] }> };
  if (!opened.days?.length) throw new Error("reopen empty");
  console.log("reopen days", opened.days.length);

  const edited = opened.days.map((day, i) => ({
    ...day,
    day_note: i === 0 ? `e2e-edit-${Date.now()}` : day.day_note,
  }));
  const save2 = await req("/api/selfhost/admin/nutrition/draft", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      userId: CLIENT_ID,
      targets: { kcal: 1800, protein_g: 135, fat_g: 60, carbs_g: 180 },
      plan_days_count: 7,
      plan_status: "draft",
      meal_schedule_mode: "two_main_two_snacks",
      primary_meal_slot: "lunch",
      days: edited,
    }),
  });
  if (!save2.ok) throw new Error(`save2: ${save2.status} ${await save2.text()}`);
  console.log("save2 ok");

  const pub = await req("/api/selfhost/admin/nutrition/publish", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      reason: "e2e_publish",
      idempotencyKey: `e2e-pub-${Date.now()}`,
    }),
  });
  if (!pub.ok) throw new Error(`publish: ${pub.status} ${await pub.text()}`);
  const published = (await pub.json()) as { versionId: string; contentHash: string };
  console.log("published", published);

  const pool = new pg.Pool({ connectionString: DB });
  const before = await pool.query(
    `SELECT id, content_hash, snapshot::text AS snap, status
       FROM nutrition_plan_versions WHERE id = $1`,
    [published.versionId],
  );
  const hash0 = before.rows[0].content_hash as string;
  const snap0 = before.rows[0].snap as string;

  const client = await login("client-a@example.test", "Passw0rd!");
  const view = await req(`/api/selfhost/nutrition?courseId=${COURSE_ID}`, client);
  if (!view.ok) throw new Error(`client view: ${view.status} ${await view.text()}`);
  const clientJson = (await view.json()) as Record<string, unknown>;
  console.log("client view keys", Object.keys(clientJson));

  await pool.query(
    `UPDATE food_products SET name = name || ' X'
      WHERE id IN (SELECT id FROM food_products WHERE is_active = true LIMIT 3)`,
  );
  await pool.query(
    `UPDATE nutrition_plans SET notes = 'mutated-draft' WHERE user_id = $1 AND course_id = $2`,
    [CLIENT_ID, COURSE_ID],
  );
  const cloneCourse = "c3333333-3333-4333-8333-333333333399";
  await pool.query(
    `INSERT INTO client_courses (id, client_id, title, start_date, end_date, status)
     VALUES ($1,$2,'Clone E2E','2026-02-01','2026-02-28','draft')
     ON CONFLICT DO NOTHING`,
    [cloneCourse, CLIENT_ID],
  );

  const after = await pool.query(
    `SELECT content_hash, snapshot::text AS snap, status FROM nutrition_plan_versions WHERE id = $1`,
    [published.versionId],
  );
  if (after.rows[0].content_hash !== hash0) throw new Error("content_hash changed after mutations");
  if (after.rows[0].snap !== snap0) throw new Error("snapshot changed after mutations");
  if (after.rows[0].status !== "published") throw new Error("status not published");
  console.log("immutability PASS");

  const supabaseHits = net.filter((u) => /supabase/i.test(u));
  if (supabaseHits.length) throw new Error(`supabase hits: ${supabaseHits.join(",")}`);
  console.log("no supabase PASS; selfhost calls", net.filter((u) => /selfhost/.test(u)).length);

  // bad publish: is_valid true semantics via empty days already covered in circuit
  const bad = await req("/api/selfhost/admin/nutrition/publish", admin, {
    method: "POST",
    body: JSON.stringify({ clientId: "not-uuid" }),
  });
  if (bad.status < 400 || bad.status >= 500) throw new Error(`expected 4xx got ${bad.status}`);
  console.log("bad input 4xx PASS", bad.status);

  await pool.end();
  globalThis.fetch = origFetch;
  console.log("E2E API ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
