/** node --env-file=.env scripts/list-legacy-sheet.mjs */
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

const ex = await fetch(
  `${url}/rest/v1/exercises?select=slug,name,video_url,tags&tags=cs.{sheet}&order=slug`,
  { headers: h },
).then((r) => r.json());

for (const e of ex) {
  const panova = (e.tags || []).includes("panova") ? "panova" : "LEGACY";
  console.log(`${panova}\t${e.slug}\t${e.name}\t${e.video_url || ""}`);
}
