/**
 * Найти Анну и её программы.
 * node --env-file=.env scripts/find-anna-programs.mjs
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

async function get(qs) {
  const res = await fetch(`${url}/rest/v1/${qs}`, { headers: h });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${qs}: ${text.slice(0, 400)}`);
  return data;
}

const sample = await get("profiles?select=*&limit=1");
console.log("Profile columns:", Object.keys(sample[0] || {}));

const profiles = await get(
  "profiles?select=*&or=(full_name.ilike.*анн*,full_name.ilike.*anna*)&order=full_name",
);
console.log("Profiles:", profiles.length);
for (const p of profiles) {
  console.log(`- ${p.full_name} | ${p.id}`);
}

if (!profiles.length) {
  const all = await get("profiles?select=id,full_name&order=full_name&limit=300");
  console.log("\nAll profiles:");
  for (const p of all) console.log(`- ${p.full_name} | ${p.id}`);
  process.exit(0);
}

for (const p of profiles) {
  console.log(`\n======== ${p.full_name} (${p.id}) ========`);
  const programs = await get(
    `training_programs?select=*&user_id=eq.${p.id}&order=updated_at.desc`,
  );
  console.log(`Programs: ${programs.length}`);
  for (const pr of programs) {
    console.log(
      `  program ${pr.id}\n    title=${pr.title}\n    status=${pr.status} weeks=${pr.weeks}\n    created=${pr.created_at} updated=${pr.updated_at}\n    notes=${(pr.notes || "").slice(0, 200)}`,
    );
    const days = await get(
      `training_program_days?select=id,week_index,day_index,title,warmup,exercises,cooldown,updated_at,created_at&program_id=eq.${pr.id}&order=week_index,day_index`,
    );
    console.log(`    days: ${days.length}`);
    for (const d of days.slice(0, 12)) {
      const warm = (d.warmup || []).length;
      const ex = (d.exercises || []).length;
      const cool = (d.cooldown || []).length;
      const first =
        (d.exercises || [])[0]?.exercise_id ||
        (d.warmup || [])[0]?.exercise_id ||
        null;
      console.log(
        `      w${d.week_index}d${d.day_index} ${d.title || ""} sets=${warm}/${ex}/${cool} updated=${d.updated_at || d.created_at} firstEx=${first}`,
      );
    }
  }
}
