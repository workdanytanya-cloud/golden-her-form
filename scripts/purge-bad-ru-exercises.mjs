/**
 * Удаляет упражнения с машинным переводом (LogPress/MIT и т.п.),
 * оставляет panova/sheet каталог тренера.
 *
 * node --env-file=.env scripts/purge-bad-ru-exercises.mjs [--dry-run]
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
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

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

/** Машинный перевод / чужая библиотека — не panova */
function isBadTranslation(e) {
  const tags = e.tags || [];
  if (tags.includes("panova") || tags.includes("sheet")) return false;

  const slug = e.slug || "";
  // LogPress / ExerciseDB dumps
  if (slug.startsWith("lp-")) return true;
  if (slug.startsWith("edb-")) return true;

  const name = e.name || "";
  // Характерные кривые кальки
  const badName =
    /тросов/i.test(name) ||
    /кабел/i.test(name) ||
    /\bряд\b/i.test(name) ||
    /паук локон/i.test(name) ||
    /накачать мышцы/i.test(name) ||
    /пожимает плечами/i.test(name) ||
    /смит /i.test(name) ||
    /^смит/i.test(name) ||
    /ez штан/i.test(name) ||
    /кабельное опускание/i.test(name) ||
    /рычагом/i.test(name) ||
    /отряда на четвереньках/i.test(name) ||
    /воздушный велосипед/i.test(name);

  return badName;
}

const exercises = await fetchAll("exercises", "id,slug,name,video_url,tags");
const usedIds = new Set();
const days = await fetchAll("training_program_days", "id,warmup,exercises,cooldown");
for (const d of days) {
  for (const key of ["warmup", "exercises", "cooldown"]) {
    for (const set of d[key] || []) {
      if (set?.exercise_id) usedIds.add(set.exercise_id);
    }
  }
}

const toDelete = [];
const skipUsed = [];
for (const e of exercises) {
  if (!isBadTranslation(e)) continue;
  if (usedIds.has(e.id)) {
    skipUsed.push(e);
    continue;
  }
  toDelete.push(e);
}

const keep = exercises.filter((e) => !toDelete.some((d) => d.id === e.id));
const panovaKeep = keep.filter((e) => (e.tags || []).includes("panova"));

console.log(`Total: ${exercises.length}`);
console.log(`Delete (bad RU / MIT dump): ${toDelete.length}${dryRun ? " (dry-run)" : ""}`);
console.log(`Skip (used in programs): ${skipUsed.length}`);
console.log(`Would remain: ${exercises.length - toDelete.length} (panova: ${panovaKeep.length})`);

const samples = toDelete.filter((e) => /тросов/i.test(e.name)).slice(0, 12);
console.log("\nSample «тросовый…»:");
for (const e of samples) console.log(`  - ${e.name}`);

if (skipUsed.length) {
  console.log("\nUsed in programs (not deleted):");
  for (const e of skipUsed.slice(0, 20)) console.log(`  - ${e.slug} | ${e.name}`);
}

if (dryRun || toDelete.length === 0) {
  console.log(dryRun ? "\nDry run — ничего не удалено" : "\nНечего удалять");
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < toDelete.length; i += 40) {
  const batch = toDelete.slice(i, i + 40);
  const ids = batch.map((e) => e.id).join(",");
  const res = await fetch(`${url}/rest/v1/exercises?id=in.(${ids})`, {
    method: "DELETE",
    headers: h,
  });
  if (!res.ok) {
    console.error("DELETE failed:", res.status, (await res.text()).slice(0, 400));
    process.exit(1);
  }
  deleted += batch.length;
  console.log(`Deleted ${deleted}/${toDelete.length}`);
}

console.log(`\n✓ Удалено ${deleted} упражнений с неверным переводом`);
