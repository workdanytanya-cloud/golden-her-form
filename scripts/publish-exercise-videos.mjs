/**
 * 1) Делает bucket media публичным
 * 2) Меняет все signed video_url → public URL
 *
 * node --env-file=.env scripts/publish-exercise-videos.mjs
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
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const bucketRes = await fetch(`${url}/storage/v1/bucket/media`, {
  method: "PUT",
  headers: h,
  body: JSON.stringify({
    public: true,
    fileSizeLimit: 104857600,
    allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime", "image/gif", "image/jpeg", "image/png", "image/webp"],
  }),
});
console.log("bucket update:", bucketRes.status, await bucketRes.text());

const all = [];
let offset = 0;
while (true) {
  const chunk = await fetch(
    `${url}/rest/v1/exercises?select=id,slug,video_url&offset=${offset}&limit=1000`,
    { headers: h },
  ).then((r) => r.json());
  if (!chunk.length) break;
  all.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

function toPublic(videoUrl) {
  if (!videoUrl) return null;
  try {
    const u = new URL(videoUrl);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/media\/(.+)$/);
    if (!m) return null;
    const objectPath = decodeURIComponent(m[1]);
    return `${url}/storage/v1/object/public/media/${objectPath}`;
  } catch {
    return null;
  }
}

let updated = 0;
for (const e of all) {
  const pub = toPublic(e.video_url);
  if (!pub || pub === e.video_url) continue;
  const res = await fetch(`${url}/rest/v1/exercises?id=eq.${e.id}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ video_url: pub }),
  });
  if (!res.ok) {
    console.error("fail", e.slug, await res.text());
    continue;
  }
  updated++;
  if (updated % 20 === 0) console.log(`updated ${updated}…`);
}
console.log(`✓ Converted ${updated} URLs to public`);

// Spot-check a few
const sample = all.filter((e) => toPublic(e.video_url) || /\/public\/media\//.test(e.video_url || "")).slice(0, 5);
for (const e of sample) {
  const target = toPublic(e.video_url) || e.video_url;
  const r = await fetch(target, { method: "HEAD", redirect: "follow" });
  console.log(e.slug, r.status, target.slice(0, 90));
}
