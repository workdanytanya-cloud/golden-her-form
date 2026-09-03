/** node --env-file=.env scripts/_test-full-persist.mjs */
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
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest(pathSuffix, opts = {}) {
  const r = await fetch(`${url}/rest/v1/${pathSuffix}`, {
    ...opts,
    headers: { ...h, ...(opts.headers ?? {}) },
  });
  const text = await r.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: r.status, body, headers: r.headers };
}

function asWeekIndex(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function dayRow(programId, d, withWeek) {
  const row = {
    program_id: programId,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus ?? null,
    description: d.description ?? null,
    warmup: d.warmup ?? [],
    exercises: d.exercises ?? [],
    cooldown: d.cooldown ?? [],
    day_note: d.day_note ?? null,
  };
  if (withWeek) row.week_index = asWeekIndex(d.week_index);
  return row;
}

async function replaceDays(programId, rows) {
  const needsMultiWeek = rows.some((r) => asWeekIndex(r.week_index) > 0);
  await rest(`training_program_days?program_id=eq.${programId}`, { method: "DELETE" });

  if (needsMultiWeek) {
    const full = rows.map((d) => dayRow(programId, d, true));
    const ins = await rest("training_program_days", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(full),
    });
    if (ins.status < 400) return { multiWeek: true };
    console.warn("multi-week insert failed, fallback week 0", ins.status, ins.body);
    const week0 = rows.filter((r) => asWeekIndex(r.week_index) === 0).map((d) => dayRow(programId, d, false));
    const fb = await rest("training_program_days", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(week0),
    });
    if (fb.status >= 400) throw new Error(JSON.stringify(fb.body));
    return { multiWeek: false };
  }

  const legacy = rows.map((d) => dayRow(programId, d, false));
  const ins = await rest("training_program_days", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(legacy),
  });
  if (ins.status >= 400) throw new Error(JSON.stringify(ins.body));
  return { multiWeek: false };
}

const ANNA_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
const COURSE_ID = "67923ead-4764-46a1-917c-9df62e678f52";

const planDays = [];
const programWeeks = 4;
for (let w = 0; w < 4; w++) {
  for (let d = 0; d < 7; d++) {
    planDays.push({
      week_index: w,
      day_index: d,
      is_rest: ![0, 2, 4].includes(d),
      title: `W${w + 1}D${d + 1}`,
      focus: "test",
      description: null,
      warmup: [],
      exercises: [],
      cooldown: [],
      day_note: null,
    });
  }
}

console.log("Plan days:", planDays.length);

const existing = await rest(
  `training_programs?user_id=eq.${ANNA_ID}&course_id=eq.${COURSE_ID}&select=id`,
);
let programId = existing.body?.[0]?.id;

const payload = {
  user_id: ANNA_ID,
  course_id: COURSE_ID,
  sessions_per_week: 3,
  goal: "tone",
  level: "beginner",
  has_injuries: false,
  equipment: [],
  faq: [],
  targets_manual: true,
  program_weeks: programWeeks,
  notes: "full persist script",
  generated_at: new Date().toISOString(),
};

if (programId) {
  const upd = await rest(`training_programs?id=eq.${programId}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (upd.status >= 400) throw new Error(JSON.stringify(upd.body));
} else {
  const ins = await rest("training_programs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (ins.status >= 400) throw new Error(JSON.stringify(ins.body));
  programId = ins.body[0].id;
}

const { multiWeek } = await replaceDays(programId, planDays);
console.log("programId", programId, "multiWeek", multiWeek);

const countRes = await rest(`training_program_days?program_id=eq.${programId}&select=id`, {
  headers: { Prefer: "count=exact" },
});
const range = countRes.headers.get("content-range") ?? "";
const m = range.match(/\/(\d+)/);
console.log("Days saved:", m ? m[1] : countRes.body?.length);
