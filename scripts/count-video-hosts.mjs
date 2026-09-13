/**
 * Считает источники video_url у panova-упражнений.
 * node --env-file=.env scripts/count-video-hosts.mjs
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

const all = [];
let offset = 0;
while (true) {
  const chunk = await fetch(
    `${url}/rest/v1/exercises?select=slug,video_url&tags=cs.{panova}&offset=${offset}&limit=1000`,
    { headers: h },
  ).then((r) => r.json());
  if (!Array.isArray(chunk) || !chunk.length) break;
  all.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

let youtube = 0;
let rutube = 0;
let file = 0;
let other = 0;
for (const e of all) {
  const v = e.video_url || "";
  if (/youtu\.?be|youtube/i.test(v)) youtube++;
  else if (/rutube/i.test(v)) rutube++;
  else if (/\.(mp4|webm|mov)(\?|$)/i.test(v)) file++;
  else if (v) other++;
}
console.log({ total: all.length, youtube, rutube, file, other });
