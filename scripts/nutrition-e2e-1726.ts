/**
 * Postgres E2E: 1726 three_mains_only → draft → reopen → publish → client → PDF.
 * Requires local server on :3000 and panovapro_nutrition_e2e DB.
 *
 * npx tsx scripts/nutrition-e2e-1726.ts
 */
import pg from "pg";

const BASE = "http://127.0.0.1:3000";
const CLIENT_ID = "b2222222-2222-4222-8222-222222222222";
const COURSE_ID = "c3333333-3333-4333-8333-333333333333";
const DB = "postgres://panovapro:panovapro_local@127.0.0.1:54332/panovapro_nutrition_e2e";

const TARGETS = { kcal: 1726, protein_g: 99, fat_g: 49.5, carbs_g: 221.2 };

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

function dayMacros(day: {
  kcal?: string | number;
  protein_g?: string | number;
  fat_g?: string | number;
  carbs_g?: string | number;
}) {
  return {
    kcal: Number(day.kcal),
    protein_g: Number(day.protein_g),
    fat_g: Number(day.fat_g),
    carbs_g: Number(day.carbs_g),
  };
}

function macrosClose(
  a: ReturnType<typeof dayMacros>,
  b: ReturnType<typeof dayMacros>,
  eps = 1e-4,
): boolean {
  return (
    Math.abs(a.kcal - b.kcal) <= eps &&
    Math.abs(a.protein_g - b.protein_g) <= eps &&
    Math.abs(a.fat_g - b.fat_g) <= eps &&
    Math.abs(a.carbs_g - b.carbs_g) <= eps
  );
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

  console.log("generate 7d 1726 three_mains_only…");
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
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      targets_override: TARGETS,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!genRes.ok) throw new Error(`generate: ${genRes.status} ${await genRes.text()}`);
  const generated = (await genRes.json()) as {
    days: Array<Record<string, unknown>>;
    is_valid?: boolean;
    message?: string;
    reason_code?: string;
    diagnostics?: { reason_code?: string; timed_out?: boolean };
  };
  if (!generated.is_valid || !generated.days?.length) {
    throw new Error(`generate failed: ${generated.reason_code ?? generated.message}`);
  }
  console.log("generated", generated.days.length, "reason", generated.reason_code ?? "PASS");
  const genDay0 = dayMacros(generated.days[0] as never);

  const save1 = await req("/api/selfhost/admin/nutrition/draft", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      userId: CLIENT_ID,
      targets: TARGETS,
      plan_days_count: 7,
      plan_status: "draft",
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      days: generated.days,
    }),
  });
  if (!save1.ok) throw new Error(`save draft: ${save1.status} ${await save1.text()}`);
  console.log("draft saved");

  const reopen = await req(
    `/api/selfhost/admin/nutrition/draft?clientId=${CLIENT_ID}&courseId=${COURSE_ID}`,
    admin,
  );
  const opened = (await reopen.json()) as { days: Array<Record<string, unknown>> };
  if (!opened.days?.length) throw new Error("reopen empty");
  const reopenDay0 = dayMacros(opened.days[0] as never);
  if (!macrosClose(reopenDay0, genDay0)) {
    throw new Error(
      `reopen macros mismatch gen=${JSON.stringify(genDay0)} reopen=${JSON.stringify(reopenDay0)}`,
    );
  }
  console.log("reopen macros match");

  const idem = `e2e-1726-${Date.now()}`;
  const pub = await req("/api/selfhost/admin/nutrition/publish", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      reason: "e2e_1726_publish",
      idempotencyKey: idem,
    }),
  });
  if (!pub.ok) throw new Error(`publish: ${pub.status} ${await pub.text()}`);
  const published = (await pub.json()) as { versionId: string; contentHash: string };
  console.log("published", published);

  const pub2 = await req("/api/selfhost/admin/nutrition/publish", admin, {
    method: "POST",
    body: JSON.stringify({
      clientId: CLIENT_ID,
      courseId: COURSE_ID,
      reason: "e2e_1726_publish",
      idempotencyKey: idem,
    }),
  });
  if (!pub2.ok) {
    const text = await pub2.text();
    // 409 = тот же key с другим payload — недопустимо; иначе ошибка.
    throw new Error(`publish retry: ${pub2.status} ${text}`);
  }
  const published2 = (await pub2.json()) as {
    versionId: string;
    contentHash: string;
    idempotent?: boolean;
  };
  if (
    published2.versionId !== published.versionId ||
    published2.contentHash !== published.contentHash
  ) {
    throw new Error("idempotent publish created duplicate version");
  }
  if (!published2.idempotent) {
    throw new Error("expected idempotent:true on retry");
  }
  console.log("idempotent publish OK");

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
  const clientJson = (await view.json()) as { days?: Array<Record<string, unknown>> };
  const clientDays =
    clientJson.days ?? (clientJson as { program?: { days?: unknown[] } }).program?.days;
  if (!Array.isArray(clientDays) || clientDays.length === 0) {
    console.log("client view keys", Object.keys(clientJson));
  } else {
    const clientDay0 = dayMacros(clientDays[0] as never);
    if (Math.abs(clientDay0.kcal - genDay0.kcal) > 0.01) {
      throw new Error(`client kcal mismatch ${clientDay0.kcal} vs ${genDay0.kcal}`);
    }
    console.log("client macros match");
  }

  const pdf = await req("/api/selfhost/pdf", client, {
    method: "POST",
    body: JSON.stringify({ kind: "nutrition", courseId: COURSE_ID }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!pdf.ok) throw new Error(`pdf: ${pdf.status} ${await pdf.text()}`);
  const pdfJson = (await pdf.json()) as { pdfBase64?: string };
  if (!pdfJson.pdfBase64 || pdfJson.pdfBase64.length < 100) throw new Error("pdf empty");
  console.log("pdf ok bytes~", Math.floor((pdfJson.pdfBase64.length * 3) / 4));

  await pool.query(
    `UPDATE food_products SET name = name || ' X'
      WHERE id IN (SELECT id FROM food_products WHERE is_active = true LIMIT 3)`,
  );
  const after = await pool.query(
    `SELECT content_hash, snapshot::text AS snap, status FROM nutrition_plan_versions WHERE id = $1`,
    [published.versionId],
  );
  if (after.rows[0].content_hash !== hash0)
    throw new Error("content_hash changed after catalog mutation");
  if (after.rows[0].snap !== snap0) throw new Error("snapshot changed after catalog mutation");
  console.log("immutability PASS");

  // near-miss must not save: generate impossible then ensure we don't overwrite with empty valid claim
  const badGen = await req("/api/selfhost/admin/nutrition/generate", admin, {
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
      days_count: 1,
      excluded_product_ids: [],
      meal_schedule_mode: "three_mains_only",
      primary_meal_slot: "lunch",
      targets_override: { kcal: 2000, protein_g: 10, fat_g: 10, carbs_g: 10 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const badBody = (await badGen.json()) as {
    is_valid?: boolean;
    reason_code?: string;
    days?: unknown[];
  };
  if (badBody.is_valid) throw new Error("near-miss/invalid marked valid");
  if ((badBody.days?.length ?? 0) > 0 && badBody.reason_code === "INVALID_TARGET") {
    throw new Error("INVALID_TARGET returned days");
  }
  console.log("invalid target blocked", badBody.reason_code);

  const supabaseHits = net.filter((u) => /supabase/i.test(u));
  if (supabaseHits.length) throw new Error(`supabase hits: ${supabaseHits.join(",")}`);
  console.log("no supabase PASS");

  await pool.end();
  globalThis.fetch = origFetch;
  console.log("E2E 1726 ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
