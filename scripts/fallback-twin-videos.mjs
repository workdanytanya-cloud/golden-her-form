/**
 * Для недоступных YouTube/Rutube подставляет mp4 от «близнеца» без суффикса -2/-3,
 * если такой уже залит в Storage.
 *
 * node --env-file=.env scripts/fallback-twin-videos.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dry = process.argv.includes("--dry-run");
const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  if (!line || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

function isFile(u) {
  return /\/storage\/v1\/object\//i.test(u || "") || /\.(mp4|webm)(\?|$)/i.test(u || "");
}
function isExternal(u) {
  return /youtu|rutube/i.test(u || "");
}

const all = await fetch(
  `${url}/rest/v1/exercises?select=id,slug,name,video_url&order=slug&limit=5000`,
  { headers: h },
).then((r) => r.json());

const bySlug = new Map(all.map((e) => [e.slug, e]));
const byNameFile = new Map();
for (const e of all) {
  if (!isFile(e.video_url)) continue;
  const key = e.name.toLowerCase().trim();
  if (!byNameFile.has(key)) byNameFile.set(key, e);
}

let fixed = 0;
for (const e of all) {
  if (!isExternal(e.video_url)) continue;

  // 1) twin slug without -2/-3
  const twinSlug = e.slug.replace(/-\d+$/, "");
  let twin = twinSlug !== e.slug ? bySlug.get(twinSlug) : null;
  if (!twin || !isFile(twin.video_url)) {
    twin = byNameFile.get(e.name.toLowerCase().trim());
  }
  if (!twin || twin.id === e.id || !isFile(twin.video_url)) {
    console.log(`? no twin for ${e.slug}`);
    continue;
  }

  console.log(`${e.slug} → ${twin.slug}`);
  if (dry) {
    fixed++;
    continue;
  }
  const res = await fetch(`${url}/rest/v1/exercises?id=eq.${e.id}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ video_url: twin.video_url }),
  });
  if (!res.ok) {
    console.error(await res.text());
    continue;
  }
  fixed++;
}
console.log(`\nFixed ${fixed}${dry ? " (dry-run)" : ""}`);
