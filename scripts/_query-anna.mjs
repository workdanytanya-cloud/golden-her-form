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
const h = { apikey: key, Authorization: `Bearer ${key}` };
const id = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
const programs = await fetch(`${url}/rest/v1/training_programs?user_id=eq.${id}&select=id,course_id,program_weeks,notes,generated_at&order=generated_at.desc`, { headers: h }).then((r) => r.json());
console.log(JSON.stringify(programs, null, 2));
for (const p of programs) {
  const days = await fetch(`${url}/rest/v1/training_program_days?program_id=eq.${p.id}&select=id`, { headers: { ...h, Prefer: "count=exact" } }).then(async (r) => {
    const range = r.headers.get("content-range") ?? "";
    const m = range.match(/\/(\d+)/);
    return m ? Number(m[1]) : (await r.json()).length;
  });
  console.log(p.id, "course", p.course_id, "days", days);
}
