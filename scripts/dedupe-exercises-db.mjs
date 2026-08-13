/**
 * Удаляет только legacy sheet-* (старые Rutube без panova) и дубли video_url
 * рядом с panova-каталогом. MIT/LogPress упражнения не трогает.
 *
 * node --env-file=.env scripts/dedupe-exercises-db.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

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
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function fetchAll(table, select) {
  const all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&offset=${offset}&limit=1000`,
      { headers: h },
    );
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk);
    offset += chunk.length;
    if (chunk.length < 1000) break;
  }
  return all;
}

function normVideo(v) {
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.hostname.includes("youtu")) {
      const id =
        u.hostname === "youtu.be"
          ? u.pathname.slice(1).split("/")[0]
          : u.searchParams.get("v") ||
            u.pathname.match(/\/(?:embed|shorts)\/([^/?#]+)/)?.[1];
      return id ? `yt:${id.toLowerCase()}` : v.toLowerCase();
    }
    if (u.hostname.includes("rutube")) {
      const id = u.pathname.match(/\/video\/([a-f0-9]+)/i)?.[1];
      return id ? `rt:${id.toLowerCase()}` : v.toLowerCase();
    }
    return v.toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

const exercises = await fetchAll("exercises", "id,slug,name,video_url,tags");

/** exercise_id referenced in any program day */
const usedIds = new Set();
const days = await fetchAll("training_program_days", "warmup,exercises,cooldown");
for (const d of days) {
  for (const key of ["warmup", "exercises", "cooldown"]) {
    for (const set of d[key] || []) {
      if (set?.exercise_id) usedIds.add(set.exercise_id);
    }
  }
}

const panova = exercises.filter((e) => (e.tags || []).includes("panova"));
const panovaVideos = new Map();
for (const e of panova) {
  const vk = normVideo(e.video_url);
  if (vk) panovaVideos.set(vk, e);
}

const toDelete = [];
const reasons = {};

function mark(e, reason) {
  if (usedIds.has(e.id)) {
    console.warn(`SKIP (in program): ${e.slug}`);
    return;
  }
  if (toDelete.some((x) => x.id === e.id)) return;
  toDelete.push(e);
  reasons[reason] = (reasons[reason] || 0) + 1;
}

// 1) Старые sheet-* без panova (Rutube seed из прошлой таблицы)
for (const e of exercises) {
  const tags = e.tags || [];
  if (tags.includes("sheet") && !tags.includes("panova")) {
    mark(e, "legacy-sheet-without-panova");
  }
}

// 2) Любое упражнение с тем же video, что у panova, но без тега panova
for (const e of exercises) {
  if ((e.tags || []).includes("panova")) continue;
  const vk = normVideo(e.video_url);
  if (!vk || !panovaVideos.has(vk)) continue;
  mark(e, "duplicate-video-vs-panova");
}

console.log(`Exercises total: ${exercises.length}`);
console.log(`panova: ${panova.length}`);
console.log(`To delete: ${toDelete.length} ${dryRun ? "(dry-run)" : ""}`);
console.log("By reason:", reasons);

for (const e of toDelete) {
  console.log(`  - ${e.slug} | ${e.name.slice(0, 55)}`);
}

if (toDelete.length === 0) {
  console.log("\n✓ Нечего удалять");
  process.exit(0);
}

if (dryRun) {
  console.log("\nDry run — ничего не удалено");
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < toDelete.length; i += 20) {
  const batch = toDelete.slice(i, i + 20);
  const ids = batch.map((e) => e.id).join(",");
  const res = await fetch(`${url}/rest/v1/exercises?id=in.(${ids})`, {
    method: "DELETE",
    headers: h,
  });
  if (!res.ok) {
    console.error("DELETE failed:", res.status, (await res.text()).slice(0, 300));
    process.exit(1);
  }
  deleted += batch.length;
}

console.log(`\n✓ Удалено ${deleted} legacy/дублей`);
