import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  let k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[k] = v;
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: "Bearer " + key };
const ANNA = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";

const OLD_COURSE = "67923ead-4764-46a1-917c-9df62e678f52";
const NEW_COURSE = "b9e5fe8a-60c2-4f78-8bef-2e6245ed988e";

async function q(label, table, query) {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: h });
  const data = await res.json();
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

// 1. See all assignments
const assignments = await q("ALL_ASSIGNMENTS", "client_program_assignments",
  `client_id=eq.${ANNA}&select=*&order=updated_at.desc`);

// 2. See all courses
await q("ALL_COURSES", "client_courses",
  `client_id=eq.${ANNA}&select=*&order=created_at.desc`);

// 3. Training program versions for Anna's assignments
const trainingVersionId = assignments.find(a => a.kind === "training")?.active_version_id;
const nutritionVersionId = assignments.find(a => a.kind === "nutrition")?.active_version_id;

if (trainingVersionId) {
  await q("TRAINING_VERSION", "training_program_versions",
    `id=eq.${trainingVersionId}&select=*`);
}
if (nutritionVersionId) {
  await q("NUTRITION_VERSION", "nutrition_plan_versions",
    `id=eq.${nutritionVersionId}&select=*`);
}

// 4. All training program versions for this client
await q("ALL_TRAINING_VERSIONS", "training_program_versions",
  `client_id=eq.${ANNA}&select=id,program_id,version,status,created_at&order=created_at.desc`);

// 5. All nutrition plan versions
await q("ALL_NUTRITION_VERSIONS", "nutrition_plan_versions",
  `client_id=eq.${ANNA}&select=*&order=created_at.desc`);
