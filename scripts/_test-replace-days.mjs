import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function strip(v) {
  v = (v ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
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
const programId = "41472090-e7b1-4e8e-85d6-51aa535a0144";
const courseId = "67923ead-4764-46a1-917c-9df62e678f52";
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const upd = await fetch(`${url}/rest/v1/training_programs?id=eq.${programId}`, {
  method: "PATCH",
  headers: { ...h, Prefer: "return=representation" },
  body: JSON.stringify({ course_id: courseId, notes: "persist test", program_weeks: 4, targets_manual: true }),
});
console.log("update", upd.status, await upd.text());

await fetch(`${url}/rest/v1/training_program_days?program_id=eq.${programId}`, { method: "DELETE", headers: h });

const ins = await fetch(`${url}/rest/v1/training_program_days`, {
  method: "POST",
  headers: { ...h, Prefer: "return=minimal" },
  body: JSON.stringify([
    { program_id: programId, week_index: 0, day_index: 0, is_rest: false, title: "D1", warmup: [], exercises: [], cooldown: [] },
    { program_id: programId, week_index: 0, day_index: 2, is_rest: false, title: "D2", warmup: [], exercises: [], cooldown: [] },
    { program_id: programId, week_index: 1, day_index: 0, is_rest: false, title: "W2D1", warmup: [], exercises: [], cooldown: [] },
  ]),
});
console.log("insert days", ins.status, await ins.text());
