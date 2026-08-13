/** node --env-file=.env scripts/list-remaining-exercises.mjs */
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

const all = [];
let offset = 0;
while (true) {
  const chunk = await fetch(
    `${url}/rest/v1/exercises?select=slug,name,tags,video_url&order=name&offset=${offset}&limit=1000`,
    { headers: h },
  ).then((r) => r.json());
  if (!chunk.length) break;
  all.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

const panova = all.filter((e) => (e.tags || []).includes("panova"));
const other = all.filter((e) => !(e.tags || []).includes("panova"));
console.log(`Total ${all.length}, panova ${panova.length}, other ${other.length}`);
console.log("\n--- other ---");
for (const e of other) {
  console.log(`${e.slug}\t${e.name}\tvideo=${!!e.video_url}\ttags=${(e.tags || []).join(",")}`);
}
const stillBad = all.filter((e) => /тросов|кабел|\bряд\b|паук локон|смит /i.test(e.name));
console.log(`\nStill bad pattern: ${stillBad.length}`);
for (const e of stillBad) console.log(`  ${e.name}`);
