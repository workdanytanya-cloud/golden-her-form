/**
 * Применить 4-недельную программу из таблицы тренера клиенту.
 *
 * node --env-file=.env scripts/apply-coach-sheet-program.mjs [userId|Anna]
 *
 * Требует SUPABASE_SERVICE_ROLE_KEY и миграцию training_program_weeks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || key.length < 80) {
  console.error("Нужны SUPABASE_URL и полный SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const arg = process.argv[2] ?? "Anna";
const ANNA_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

let userId = arg;
if (/anna/i.test(arg)) {
  const profiles = await fetch(
    `${url}/rest/v1/profiles?select=id,full_name&full_name=ilike.*${encodeURIComponent("Анн")}*&limit=5`,
    { headers: h },
  ).then((r) => r.json());
  userId = profiles[0]?.id ?? ANNA_ID;
  console.log("Клиент:", profiles[0]?.full_name ?? "Anna (fallback id)", userId);
}

const { buildCoachSheetProgramDays, coachProgramNotes, COACH_PROGRAM_WEEKS } =
  await import(pathToFileURL(path.join(root, "src/lib/coach-sheet-program.ts")).href);
const { inferGoal, inferLevel } = await import(
  pathToFileURL(path.join(root, "src/lib/training.ts")).href
);

const [exercises, onb, meas] = await Promise.all([
  fetch(`${url}/rest/v1/exercises?select=*&limit=2000`, { headers: h }).then((r) => r.json()),
  fetch(`${url}/rest/v1/onboarding_responses?select=*&user_id=eq.${userId}`, { headers: h }).then(
    (r) => r.json(),
  ),
  fetch(
    `${url}/rest/v1/measurements?select=weight_kg&user_id=eq.${userId}&order=measured_on.desc&limit=1`,
    { headers: h },
  ).then((r) => r.json()),
]);

const o = onb[0] ?? {};
const weight_kg = meas[0]?.weight_kg ?? null;
const input = {
  sessions_per_week: 3,
  goal: inferGoal(o.goal_primary),
  level: inferLevel(o.activity_level),
  has_injuries: Boolean(o.has_injuries),
  injuries_details: o.injuries_details,
  equipment: o.equipment ?? [],
  location: o.training_location,
  weight_kg,
};

const days = buildCoachSheetProgramDays(exercises, input);
const notes = coachProgramNotes(input);

const { data: existing } = await fetch(
  `${url}/rest/v1/training_programs?select=id&user_id=eq.${userId}`,
  { headers: h },
).then((r) => r.json()).then((rows) => ({ data: rows[0] }));

const payload = {
  user_id: userId,
  sessions_per_week: 3,
  goal: input.goal,
  level: input.level,
  has_injuries: input.has_injuries,
  injuries_details: input.injuries_details,
  equipment: input.equipment,
  location: input.location,
  notes,
  targets_manual: true,
  program_weeks: COACH_PROGRAM_WEEKS,
  generated_at: new Date().toISOString(),
};

let programId = existing?.id;
if (programId) {
  const res = await fetch(`${url}/rest/v1/training_programs?id=eq.${programId}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
} else {
  const res = await fetch(`${url}/rest/v1/training_programs`, {
    method: "POST",
    headers: { ...h, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const row = await res.json();
  programId = row[0].id;
}

await fetch(`${url}/rest/v1/training_program_days?program_id=eq.${programId}`, {
  method: "DELETE",
  headers: h,
});

const rows = days.map((d) => ({
  program_id: programId,
  week_index: d.week_index ?? 0,
  day_index: d.day_index,
  is_rest: d.is_rest,
  title: d.title,
  focus: d.focus,
  description: d.description,
  warmup: d.warmup,
  exercises: d.exercises,
  cooldown: d.cooldown,
  day_note: d.day_note,
}));

const ins = await fetch(`${url}/rest/v1/training_program_days`, {
  method: "POST",
  headers: h,
  body: JSON.stringify(rows),
});
if (!ins.ok) throw new Error(await ins.text());

console.log(`OK: ${days.length} дней (${COACH_PROGRAM_WEEKS} нед.) для ${userId}`);
