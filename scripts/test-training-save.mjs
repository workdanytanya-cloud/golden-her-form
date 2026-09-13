/** node --env-file=.env scripts/test-training-save.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function strip(v) {
  v = (v ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

const raw = fs.readFileSync(path.join(__dirname, "../.env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = strip(line.slice(i + 1));
}

const url = strip(env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = strip(env.SUPABASE_SERVICE_ROLE_KEY);
const ANNA_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(pathSuffix, opts = {}) {
  const r = await fetch(`${url}/rest/v1/${pathSuffix}`, { ...opts, headers: { ...h, ...(opts.headers ?? {}) } });
  const text = await r.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: r.status, body, headers: r.headers };
}

// Удалить старый черновик Anna (service role)
const existing = await rest(
  `training_programs?user_id=eq.${ANNA_ID}&select=id`,
);
const oldId = existing.body?.[0]?.id;
if (oldId) {
  await rest(`training_program_days?program_id=eq.${oldId}`, { method: "DELETE" });
  await rest(`training_programs?id=eq.${oldId}`, { method: "DELETE" });
}

const insertProgram = await rest("training_programs", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    user_id: ANNA_ID,
    sessions_per_week: 3,
    goal: "tone",
    level: "beginner",
    has_injuries: false,
    equipment: [],
    faq: [],
    targets_manual: true,
    program_weeks: 4,
    notes: "test save via service role",
  }),
});

if (insertProgram.status >= 400) {
  console.error("INSERT program failed", insertProgram.status, insertProgram.body);
  process.exit(1);
}

const programId = insertProgram.body[0].id;
const sampleDay = {
  program_id: programId,
  week_index: 0,
  day_index: 0,
  is_rest: false,
  title: "Test day",
  focus: "test",
  warmup: [],
  exercises: [],
  cooldown: [],
};

const insertDay = await rest("training_program_days", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify(sampleDay),
});

if (insertDay.status >= 400) {
  console.error("INSERT day failed", insertDay.status, insertDay.body);
  process.exit(1);
}

const verify = await rest(
  `training_programs?user_id=eq.${ANNA_ID}&select=id,program_weeks,notes`,
);
console.log("OK program saved:", verify.body);
console.log("programId:", programId);
