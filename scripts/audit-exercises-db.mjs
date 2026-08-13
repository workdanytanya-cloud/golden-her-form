/**
 * Проверка базы упражнений: дубли slug/video/name, embed-URL, старые Rutube vs новые YouTube.
 * node --env-file=.env scripts/audit-exercises-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVideoEmbedUrl } from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const h = { apikey: key, Authorization: `Bearer ${key}` };

const all = [];
let offset = 0;
while (true) {
  const res = await fetch(
    `${url}/rest/v1/exercises?select=id,slug,name,video_url,tags,category&order=slug&offset=${offset}&limit=1000`,
    { headers: h },
  );
  const chunk = await res.json();
  if (!Array.isArray(chunk) || chunk.length === 0) break;
  all.push(...chunk);
  offset += chunk.length;
  if (chunk.length < 1000) break;
}

console.log(`\n=== Всего упражнений в БД: ${all.length} ===\n`);

function reportDupes(map, label) {
  const dupes = [...map.entries()].filter(([, v]) => v.length > 1);
  console.log(`${label}: ${dupes.length} групп дублей`);
  for (const [k, arr] of dupes.slice(0, 20)) {
    console.log(`  • ${k}`);
    for (const e of arr) console.log(`      ${e.slug} | ${e.name.slice(0, 60)}`);
  }
  if (dupes.length > 20) console.log(`  … ещё ${dupes.length - 20}`);
  return dupes;
}

const bySlug = new Map();
const byVideo = new Map();
const byName = new Map();

for (const e of all) {
  if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
  bySlug.get(e.slug).push(e);

  const v = (e.video_url || "").toLowerCase().trim();
  if (v) {
    if (!byVideo.has(v)) byVideo.set(v, []);
    byVideo.get(v).push(e);
  }

  const n = e.name.toLowerCase().trim();
  if (n) {
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(e);
  }
}

const slugDupes = reportDupes(bySlug, "Дубли slug");
const videoDupes = reportDupes(byVideo, "Дубли video_url");
const nameDupes = reportDupes(byName, "Дубли name (разные slug, одно имя)");

const panova = all.filter((e) => (e.tags || []).includes("panova"));
const sheetOnly = all.filter(
  (e) =>
    (e.tags || []).includes("sheet") &&
    !(e.tags || []).includes("panova") &&
    !e.slug.startsWith("sheet-yt-"),
);
const oldRutube = all.filter(
  (e) =>
    e.slug.startsWith("sheet-") &&
    (e.tags || []).includes("sheet") &&
    !(e.tags || []).includes("panova") &&
    /rutube\.ru/i.test(e.video_url || ""),
);
const legacyMit = all.filter((e) => !(e.tags || []).includes("sheet") && !(e.tags || []).includes("panova"));

console.log(`\n=== Категории ===`);
console.log(`panova (новая таблица): ${panova.length}`);
console.log(`sheet без panova (старые): ${sheetOnly.length}`);
console.log(`старые Rutube sheet-*: ${oldRutube.length}`);
console.log(`прочие (MIT/legacy): ${legacyMit.length}`);

let noEmbed = 0;
let hasEmbed = 0;
const noEmbedList = [];
for (const e of all) {
  if (!e.video_url) continue;
  const embed = getVideoEmbedUrl(e.video_url);
  if (embed) hasEmbed++;
  else {
    noEmbed++;
    noEmbedList.push(e);
  }
}
console.log(`\n=== Видео ===`);
console.log(`С video_url: ${all.filter((e) => e.video_url).length}`);
console.log(`Embed OK: ${hasEmbed}`);
console.log(`Без embed: ${noEmbed}`);
for (const e of noEmbedList.slice(0, 10)) {
  console.log(`  ✗ ${e.slug}: ${e.video_url}`);
}

// Same name, different video = likely duplicate content
const nameVideoConflicts = nameDupes.filter(([, arr]) => {
  const videos = new Set(arr.map((e) => (e.video_url || "").toLowerCase()));
  return videos.size > 1;
});
console.log(`\nОдинаковое имя, разные видео: ${nameVideoConflicts.length} групп`);

const exitCode =
  slugDupes.length > 0 || videoDupes.length > 0 ? 1 : noEmbed > 0 ? 1 : 0;
console.log(exitCode === 0 ? "\n✓ Критичных проблем не найдено" : "\n⚠ Есть проблемы — см. выше");
process.exit(exitCode);
