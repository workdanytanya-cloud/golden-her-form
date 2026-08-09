/**
 * Анализ дублей блюд по столам: одинаковое базовое имя × приём пищи.
 * node scripts/analyze-dish-table-dupes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

export function baseDishName(name) {
  return name
    .replace(/\s*\(добор\s+стол\s*№?\s*\d+\)\s*/gi, "")
    .replace(/\s*\(стол\s*№?\s*\d+\)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tableIdsFromTags(tags) {
  const out = new Set();
  for (const t of tags ?? []) {
    let m = /^table_(\d+)$/.exec(t);
    if (m) out.add(`table_${m[1]}`);
    m = /^стол_(\d+)$/.exec(t);
    if (m) out.add(`table_${m[1]}`);
  }
  return [...out].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const env = loadEnv();
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${url}/rest/v1/dishes?select=id,slug,name,meal_type,tags,image_url,calories_per_100g,portion_weight_g&order=name.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const dishes = await res.json();
  if (!Array.isArray(dishes)) {
    console.error(dishes);
    process.exit(1);
  }

  const groups = new Map();
  for (const d of dishes) {
    const base = baseDishName(d.name);
    const keyG = `${d.meal_type}::${base.toLowerCase()}`;
    if (!groups.has(keyG)) groups.set(keyG, []);
    groups.get(keyG).push(d);
  }

  const multi = [...groups.entries()]
    .map(([k, items]) => ({
      key: k,
      base: baseDishName(items[0].name),
      meal_type: items[0].meal_type,
      items,
    }))
    .filter((g) => g.items.length > 1)
    .sort((a, b) => b.items.length - a.items.length);

  console.log("total dishes", dishes.length);
  console.log("multi groups", multi.length);
  console.log("would remove", multi.reduce((s, g) => s + g.items.length - 1, 0));
  console.log("top:");
  for (const g of multi.slice(0, 25)) {
    const tables = [...new Set(g.items.flatMap((i) => tableIdsFromTags(i.tags)))].join(",");
    console.log(`  ${g.items.length}x [${g.meal_type}] ${g.base} → ${tables}`);
  }

  fs.writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "dish-table-dupe-groups.json"),
    JSON.stringify(
      {
        total: dishes.length,
        multiGroups: multi.length,
        removable: multi.reduce((s, g) => s + g.items.length - 1, 0),
        groups: multi.map((g) => ({
          base: g.base,
          meal_type: g.meal_type,
          count: g.items.length,
          tables: [...new Set(g.items.flatMap((i) => tableIdsFromTags(i.tags)))],
          slugs: g.items.map((i) => i.slug),
          ids: g.items.map((i) => i.id),
        })),
      },
      null,
      2,
    ),
  );
  console.log("wrote scripts/dish-table-dupe-groups.json");
}
