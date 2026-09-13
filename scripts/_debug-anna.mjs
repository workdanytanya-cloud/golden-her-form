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
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const id = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

const programs = await fetch(`${url}/rest/v1/training_programs?user_id=eq.${id}&select=id,course_id,notes,generated_at`, { headers: h }).then((r) => r.json());
console.log("all programs", JSON.stringify(programs, null, 2));

const courses = await fetch(`${url}/rest/v1/client_courses?client_id=eq.${id}&select=id,title,status,start_date`, { headers: h }).then((r) => r.json());
console.log("courses", JSON.stringify(courses, null, 2));

const rpc = await fetch(`${url}/rest/v1/rpc/resolve_client_course_id`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_client_id: id, p_course_id: null }),
}).then(async (r) => ({ status: r.status, body: await r.text() }));
console.log("resolve_client_course_id", rpc);

const days = await fetch(
  `${url}/rest/v1/training_program_days?program_id=eq.41472090-e7b1-4e8e-85d6-51aa535a0144&select=title,week_index,day_index&order=week_index,day_index&limit=5`,
  { headers: h },
).then((r) => r.json());
console.log("first days", days);

// Published assignment
const assign = await fetch(
  `${url}/rest/v1/client_program_assignments?client_id=eq.${id}&kind=eq.training&select=*`,
  { headers: h },
).then((r) => r.json());
console.log("training assignments", JSON.stringify(assign, null, 2));
