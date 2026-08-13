/**
 * Upsert упражнений из panova-exercises.json / вкладок в Supabase.
 * node --env-file=.env scripts/apply-exercises-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectExercisesFromTabsDir } from "./collect-panova-exercises.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

const tabsDir = path.join(__dirname, "_sheet_tabs");
const jsonPath = path.join(__dirname, "panova-exercises.json");
let payload;
if (fs.existsSync(tabsDir) && fs.readdirSync(tabsDir).some((f) => f.endsWith(".csv"))) {
  payload = collectExercisesFromTabsDir(tabsDir).exercises;
} else if (fs.existsSync(jsonPath)) {
  payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
} else {
  console.error("Нет panova-exercises.json — node scripts/fetch-exercises-sheet.mjs && node scripts/collect-panova-exercises.mjs");
  process.exit(1);
}

console.log(`Upserting ${payload.length} exercises…`);

const endpoint = `${url.replace(/\/$/, "")}/rest/v1/exercises?on_conflict=slug`;
const chunkSize = 50;
let total = 0;
for (let i = 0; i < payload.length; i += chunkSize) {
  const chunk = payload.slice(i, i + chunkSize);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(chunk),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("FAIL", res.status, body.slice(0, 500));
    process.exit(1);
  }
  const inserted = JSON.parse(body);
  total += inserted.length;
  console.log(`  chunk ${i / chunkSize + 1}: ${inserted.length}`);
}

console.log(`OK: upserted ${total} exercises`);

const check = await fetch(
  `${url.replace(/\/$/, "")}/rest/v1/exercises?select=slug&tags=cs.{sheet}`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
const checkBody = await check.json();
console.log(`Verify sheet-tagged count: ${checkBody.length}`);
