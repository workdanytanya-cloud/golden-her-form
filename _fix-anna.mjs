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

async function q(label, endpoint, query) {
  const res = await fetch(`${url}/rest/v1/${endpoint}?${query}`, { headers: h });
  const data = await res.json();
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

// Current assignments (should be on OLD_COURSE now)
const assignments = await q("CURRENT_ASSIGNMENTS", "client_program_assignments",
  `client_id=eq.${ANNA}&select=*`);

// Check if assignments already exist for NEW_COURSE
const newCourseAssignments = assignments.filter(a => a.course_id === NEW_COURSE);
const oldCourseAssignments = assignments.filter(a => a.course_id === OLD_COURSE);

console.log(`\nOld course assignments: ${oldCourseAssignments.length}`);
console.log(`New course assignments: ${newCourseAssignments.length}`);

// Create new assignments for NEW_COURSE by duplicating from old ones
if (newCourseAssignments.length === 0 && oldCourseAssignments.length > 0) {
  console.log("\nCreating assignments for new course...");
  for (const a of oldCourseAssignments) {
    const body = {
      client_id: a.client_id,
      kind: a.kind,
      active_version_id: a.active_version_id,
      course_id: NEW_COURSE,
    };
    const res = await fetch(`${url}/rest/v1/client_program_assignments`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`Created ${a.kind} for new course:`, JSON.stringify(data, null, 2));
  }
} else {
  console.log("\nAssignments for new course already exist or nothing to clone.");
}

// Verify
await q("FINAL_ASSIGNMENTS", "client_program_assignments",
  `client_id=eq.${ANNA}&select=*`);
