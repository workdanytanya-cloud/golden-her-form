/**
 * Upsert блюд из JSON в Supabase (service role).
 * Запуск:
 *   node scripts/apply-dishes-seed.mjs
 *   node scripts/apply-dishes-seed.mjs scripts/dishes-special-no-sgl.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const jsonArg = process.argv[2];
const jsonPath = jsonArg
  ? path.isAbsolute(jsonArg)
    ? jsonArg
    : path.join(root, jsonArg)
  : path.join(__dirname, "dishes-calorizator-expand.json");

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

const dishes = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
console.log("Source:", jsonPath, "rows:", dishes.length);

const rows = dishes.map((d) => ({
  slug: d.slug,
  name: d.name,
  meal_type: d.meal,
  tags: d.tags,
  calories_per_100g: d.calories,
  protein_per_100g: d.p,
  fat_per_100g: d.f,
  carbs_per_100g: d.c,
  portion_weight_g: d.portion,
  ingredients: d.ingredients,
  steps: d.steps,
  replacements: d.replacements ?? [],
  description: d.description,
}));

const endpoint = `${url.replace(/\/$/, "")}/rest/v1/dishes?on_conflict=slug`;
const chunkSize = 20;
let ok = 0;

for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Upsert failed", res.status, text);
    process.exit(1);
  }
  ok += chunk.length;
  console.log(`Upserted ${ok}/${rows.length}`);
}

const allRes = await fetch(`${url.replace(/\/$/, "")}/rest/v1/dishes?select=slug`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "count=exact",
    Range: "0-0",
  },
});
console.log("Done. content-range:", allRes.headers.get("content-range"));
