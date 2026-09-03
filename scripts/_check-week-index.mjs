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
const h = { apikey: key, Authorization: `Bearer ${key}` };
const pid = "41472090-e7b1-4e8e-85d6-51aa535a0144";

const days = await fetch(
  `${url}/rest/v1/training_program_days?program_id=eq.${pid}&select=week_index,day_index,is_rest,title&order=week_index,day_index`,
  { headers: h },
).then((r) => r.json());

console.log("days count", days.length);
console.log(JSON.stringify(days, null, 2));

const test = await fetch(`${url}/rest/v1/training_program_days`, {
  method: "POST",
  headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify({
    program_id: pid,
    week_index: 1,
    day_index: 6,
    is_rest: true,
    title: "test week1",
    warmup: [],
    exercises: [],
    cooldown: [],
  }),
});
const txt = await test.text();
console.log("week_index=1 insert", test.status, txt);
