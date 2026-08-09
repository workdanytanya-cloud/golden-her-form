/**
 * Сливает одинаковые блюда столов в один рецепт с тегами table_N.
 * Обновляет nutrition_plan_days.meals и replacements, удаляет дубли.
 *
 *   node scripts/merge-dish-table-dupes.mjs --dry-run
 *   node scripts/merge-dish-table-dupes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseDishName, tableIdsFromTags } from "./analyze-dish-table-dupes.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

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

function normalizeTags(tagLists) {
  const tables = new Set();
  const other = new Set();
  for (const tags of tagLists) {
    for (const t of tags ?? []) {
      const m = /^table_(\d+)$/.exec(t) || /^стол_(\d+)$/.exec(t);
      if (m) {
        tables.add(`table_${m[1]}`);
        continue;
      }
      other.add(t);
    }
  }
  const tableTags = [...tables].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  return [...tableTags, ...[...other].sort()];
}

function isTableRelated(items) {
  return items.some(
    (d) =>
      tableIdsFromTags(d.tags).length > 0 ||
      /\(\s*стол\s*№?\s*\d+\s*\)/i.test(d.name) ||
      /\(\s*добор\s+стол/i.test(d.name),
  );
}

function scoreCanonical(d) {
  let s = 0;
  if (d.image_url) s += 100;
  if (d.video_url) s += 20;
  if (!/\(\s*стол/i.test(d.name)) s += 15;
  if (!/-fill\d*-/i.test(d.slug || "")) s += 10;
  s += Math.min(String(d.ingredients ?? "").length, 80);
  s += Math.min(String(d.steps ?? "").length, 40);
  s += Math.min((d.tags ?? []).length, 10);
  if (d.description) s += 5;
  return s;
}

async function rest(url, key, pathname, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.Prefer = prefer ?? "return=representation";
  } else if (prefer) {
    headers.Prefer = prefer;
  }
  const res = await fetch(`${url}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function fetchAll(url, key, pathname) {
  const pageSize = 1000;
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const res = await fetch(`${url}${pathname}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${to}`,
        Prefer: "count=exact",
      },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : [];
    if (!res.ok) throw new Error(`GET ${pathname}: ${res.status} ${text}`);
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

console.log(dryRun ? "DRY RUN" : "APPLY");

const dishes = await fetchAll(
  url,
  key,
  "/rest/v1/dishes?select=id,slug,name,meal_type,tags,image_url,video_url,description,ingredients,steps,replacements,portion_weight_g,calories_per_100g,protein_per_100g,fat_per_100g,carbs_per_100g&order=name.asc",
);

const groups = new Map();
for (const d of dishes) {
  const base = baseDishName(d.name);
  const gKey = `${d.meal_type}::${base.toLowerCase()}`;
  if (!groups.has(gKey)) groups.set(gKey, []);
  groups.get(gKey).push(d);
}

const multi = [...groups.values()]
  .filter((items) => items.length > 1 && isTableRelated(items))
  .sort((a, b) => b.length - a.length);

const idToCanonical = new Map();
const slugToCanonical = new Map();
const updates = [];
const deleteIds = [];

for (const items of multi) {
  const ranked = [...items].sort((a, b) => scoreCanonical(b) - scoreCanonical(a));
  const keep = ranked[0];
  const drop = ranked.slice(1);
  const base = baseDishName(keep.name);
  const mergedTags = normalizeTags(items.map((i) => i.tags));
  const mergedReplacements = [
    ...new Set(
      items
        .flatMap((i) => i.replacements ?? [])
        .filter((s) => s && !drop.some((d) => d.slug === s) && s !== keep.slug),
    ),
  ];
  const image = items.find((i) => i.image_url)?.image_url ?? keep.image_url;
  const video = items.find((i) => i.video_url)?.video_url ?? keep.video_url;
  const ingredients =
    [...items].sort((a, b) => String(b.ingredients ?? "").length - String(a.ingredients ?? "").length)[0]
      .ingredients ?? keep.ingredients;
  const steps =
    [...items].sort((a, b) => String(b.steps ?? "").length - String(a.steps ?? "").length)[0].steps ??
    keep.steps;
  const description =
    items.find((i) => i.description && String(i.description).trim())?.description ?? keep.description;

  updates.push({
    id: keep.id,
    patch: {
      name: base,
      tags: mergedTags,
      replacements: mergedReplacements,
      image_url: image,
      video_url: video,
      ingredients,
      steps,
      description,
    },
    dropSlugs: drop.map((d) => d.slug),
    tables: tableIdsFromTags(mergedTags),
  });

  for (const d of drop) {
    idToCanonical.set(d.id, keep.id);
    slugToCanonical.set(d.slug, keep.slug);
    deleteIds.push(d.id);
  }
  slugToCanonical.set(keep.slug, keep.slug);
}

console.log(`groups to merge: ${multi.length}`);
console.log(`canonical updates: ${updates.length}`);
console.log(`duplicates to delete: ${deleteIds.length}`);
console.log(`dishes after: ${dishes.length - deleteIds.length}`);

const reportPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dish-table-merge-report.json");
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dryRun,
      before: dishes.length,
      after: dishes.length - deleteIds.length,
      removed: deleteIds.length,
      merges: updates.map((u) => ({
        keepId: u.id,
        name: u.patch.name,
        tables: u.tables,
        dropSlugs: u.dropSlugs,
      })),
    },
    null,
    2,
  ),
);
console.log("wrote", reportPath);

if (dryRun) {
  console.log("Пример:");
  for (const u of updates.slice(0, 5)) {
    console.log(`  ${u.patch.name} ← −${u.dropSlugs.length} · ${u.tables.join(",")}`);
  }
  process.exit(0);
}

// 1) Update canonical dishes
for (const u of updates) {
  await rest(url, key, `/rest/v1/dishes?id=eq.${u.id}`, {
    method: "PATCH",
    body: u.patch,
    prefer: "return=minimal",
  });
}
console.log("updated canonical dishes");

// 2) Remap replacements on remaining dishes that point at deleted slugs
const slugRemapNeeded = dishes.filter((d) => !deleteIds.includes(d.id));
let replFixed = 0;
for (const d of slugRemapNeeded) {
  const next = [...new Set((d.replacements ?? []).map((s) => slugToCanonical.get(s) ?? s))].filter(
    (s) => s !== d.slug,
  );
  const same =
    next.length === (d.replacements ?? []).length && next.every((s, i) => s === (d.replacements ?? [])[i]);
  // also normalize tags on singles that still have стол_N
  const normTags = normalizeTags([d.tags]);
  const tagsSame =
    normTags.length === (d.tags ?? []).length && normTags.every((t, i) => t === (d.tags ?? [])[i]);
  const wasUpdated = updates.some((u) => u.id === d.id);
  if (same && tagsSame) continue;
  if (wasUpdated && same) continue;
  const patch = {};
  if (!same) patch.replacements = next;
  if (!tagsSame && !wasUpdated) patch.tags = normTags;
  if (Object.keys(patch).length === 0) continue;
  await rest(url, key, `/rest/v1/dishes?id=eq.${d.id}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
  });
  replFixed++;
}
console.log("fixed replacements/tags on", replFixed, "dishes");

// 3) Remap nutrition_plan_days.meals
const days = await fetchAll(
  url,
  key,
  "/rest/v1/nutrition_plan_days?select=id,meals&order=id.asc",
);
let daysPatched = 0;
for (const day of days) {
  const meals = day.meals;
  if (!Array.isArray(meals)) continue;
  let changed = false;
  const next = meals.map((m) => {
    if (!m || typeof m !== "object") return m;
    const mapped = idToCanonical.get(m.dish_id);
    if (!mapped) return m;
    changed = true;
    return { ...m, dish_id: mapped };
  });
  if (!changed) continue;
  await rest(url, key, `/rest/v1/nutrition_plan_days?id=eq.${day.id}`, {
    method: "PATCH",
    body: { meals: next },
    prefer: "return=minimal",
  });
  daysPatched++;
}
console.log("patched plan days:", daysPatched, "/", days.length);

// 4) Delete duplicates in chunks
const chunkSize = 40;
for (let i = 0; i < deleteIds.length; i += chunkSize) {
  const chunk = deleteIds.slice(i, i + chunkSize);
  const ids = chunk.map((id) => `"${id}"`).join(",");
  await rest(url, key, `/rest/v1/dishes?id=in.(${ids})`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}
console.log("deleted", deleteIds.length, "duplicates");
console.log("done");
