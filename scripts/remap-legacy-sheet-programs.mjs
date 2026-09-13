/**
 * Заменяет legacy sheet-* exercise_id на panova-аналоги в training_program_days.
 * node --env-file=.env scripts/remap-legacy-sheet-programs.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

/** Старый Rutube slug → panova slug из новой таблицы */
const SLUG_MAP = {
  "sheet-bokovye-vypady-s-pryzhkom":
    "sheet-vypady-v-pryzhke-yagodichnyy-mostik-dzhamping-dzhek-otvedeni",
  "sheet-bokovye-vypady-v-pruzhinke": "sheet-vypady-v-pruzhinke-otvedenie-nogi-nazad",
  "sheet-poluvypady-na-meste-s-podemom-ganteli-nad-golovoy":
    "sheet-vypady-s-podemom-ganteli-nad-golovoy",
  "sheet-lodochka-poocheredno":
    "sheet-prised-s-pruzhinkoy-lodochka-poocheredno-skruchivaniya-na-pr",
  "sheet-press-v-planke-na-pryamyh-rukah": "sheet-planka-na-pryamyh-rukah",
  "sheet-naklony-na-odnoy-noge": "sheet-naklony-na-odnoi-noge",
  "sheet-prisedaniya-s-kasaniem-ladoney": "sheet-prisedaniya-s-kasaniem-ladonei",
  "sheet-trenirovka": "sheet-kompleks-1",
};

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

const exercises = await fetchAll("exercises", "id,slug,name,video_url,tags");
const bySlug = new Map(exercises.map((e) => [e.slug, e]));

const remap = new Map();
for (const [oldSlug, newSlug] of Object.entries(SLUG_MAP)) {
  const old = bySlug.get(oldSlug);
  const neu = bySlug.get(newSlug);
  if (!old) {
    console.warn(`Legacy not found: ${oldSlug}`);
    continue;
  }
  if (!neu) {
    console.warn(`Panova target not found: ${newSlug}`);
    continue;
  }
  remap.set(old.id, neu);
  console.log(`Map: ${oldSlug} → ${newSlug}`);
}

const days = await fetchAll("training_program_days", "id,warmup,exercises,cooldown");
let updatedDays = 0;

for (const day of days) {
  let changed = false;
  const next = {};
  for (const key of ["warmup", "exercises", "cooldown"]) {
    next[key] = (day[key] || []).map((set) => {
      if (!set?.exercise_id || !remap.has(set.exercise_id)) return set;
      changed = true;
      return { ...set, exercise_id: remap.get(set.exercise_id).id };
    });
  }
  if (!changed) continue;
  updatedDays++;
  console.log(`Update day ${day.id}`);
  if (!dryRun) {
    const res = await fetch(`${url}/rest/v1/training_program_days?id=eq.${day.id}`, {
      method: "PATCH",
      headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({
        warmup: next.warmup,
        exercises: next.exercises,
        cooldown: next.cooldown,
      }),
    });
    if (!res.ok) {
      console.error("PATCH failed:", await res.text());
      process.exit(1);
    }
  }
}

console.log(`\nUpdated ${updatedDays} program days ${dryRun ? "(dry-run)" : ""}`);
