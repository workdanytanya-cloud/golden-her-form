/**
 * Детали программы Анны + поиск бэкапов.
 * node --env-file=.env scripts/inspect-anna-program.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };

const ANNA = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

async function get(qs) {
  const res = await fetch(`${url}/rest/v1/${qs}`, { headers: h });
  const text = await res.text();
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 500)}`);
  return data;
}

const program = (
  await get(`training_programs?select=*&user_id=eq.${ANNA}`)
)[0];
console.log("Program:");
console.log({
  id: program.id,
  generated_at: program.generated_at,
  created_at: program.created_at,
  updated_at: program.updated_at,
  goal: program.goal,
  level: program.level,
  sessions_per_week: program.sessions_per_week,
  program_weeks: program.program_weeks,
  notes: program.notes,
});

const daySample = await get(
  `training_program_days?select=*&program_id=eq.${program.id}&limit=1`,
);
console.log("\nDay columns:", Object.keys(daySample[0] || {}));

const days = await get(
  `training_program_days?select=*&program_id=eq.${program.id}&order=day_index`,
);
console.log(`\nDays: ${days.length}`);

const exIds = new Set();
for (const d of days) {
  for (const key of ["warmup", "exercises", "cooldown"]) {
    for (const s of d[key] || []) if (s?.exercise_id) exIds.add(s.exercise_id);
  }
}
const ids = [...exIds];
const exercises = ids.length
  ? await get(
      `exercises?select=id,slug,name,tags&id=in.(${ids.join(",")})`,
    )
  : [];
const byId = Object.fromEntries(exercises.map((e) => [e.id, e]));

for (const d of days) {
  const week = d.week_index ?? "?";
  console.log(
    `\n--- day_index=${d.day_index} week=${week} rest=${d.is_rest} title=${d.title} updated=${d.updated_at}`,
  );
  for (const key of ["warmup", "exercises", "cooldown"]) {
    const sets = d[key] || [];
    if (!sets.length) continue;
    console.log(`  ${key}:`);
    for (const s of sets) {
      const e = byId[s.exercise_id];
      console.log(
        `    - ${e?.name || s.exercise_id} [${e?.slug || "?"}] ${s.sets || ""}x${s.reps || ""}`,
      );
    }
  }
}

// Check if any of the remapped day IDs belong to Anna
const remapped = [
  "19408494-a37a-474b-8387-90a6d3b73dba",
  "afb60daa-a7d2-4b9c-8f4f-497781ba61a7",
  "985c78f6-0cae-4a38-9b62-b9309fcd8287",
  "0d2205d6-569d-4b9f-9cf9-a6e91a688fa3",
  "e6b8474f-2807-41d4-962a-03f13b221977",
  "3585f084-23c4-464d-8ea5-954535d9eca1",
];
const annaDayIds = new Set(days.map((d) => d.id));
console.log("\nRemapped days belonging to Anna:");
for (const id of remapped) {
  console.log(`  ${id}: ${annaDayIds.has(id) ? "YES" : "no"}`);
}

// Save dump for safety
const dumpPath = path.join(__dirname, `_anna_program_dump_${Date.now()}.json`);
fs.writeFileSync(
  dumpPath,
  JSON.stringify({ program, days, exercises }, null, 2),
);
console.log("\nCurrent dump saved:", dumpPath);
