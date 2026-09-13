/**
 * Upsert продуктов и рецептов конструктора из seed-data.ts в Supabase (service role).
 * Не трогает nutrition_plan_versions / client_program_assignments / меню клиентов.
 *
 * Требует: миграция 20260830120000_nutrition_constructor.sql уже применена.
 *
 * Запуск:
 *   node scripts/apply-nutrition-constructor-seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

async function loadSeedData() {
  const entry = path.join(root, "src/lib/nutrition-constructor/seed-data.ts");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-seed-"));
  const outfile = path.join(outDir, "seed-data.mjs");
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  const mod = await import(pathToFileURL(outfile).href);
  const metaOut = path.join(outDir, "recipe-meta.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "src/lib/nutrition-constructor/recipe-meta.ts")],
    outfile: metaOut,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  const metaMod = await import(pathToFileURL(metaOut).href);
  return {
    products: mod.SEED_PRODUCTS,
    recipes: mod.SEED_RECIPES,
    inferRecipeMeta: metaMod.inferRecipeMeta,
    snackActionForRecipe: metaMod.snackActionForRecipe,
  };
}

async function rest(base, key, method, tablePath, body, prefer) {
  const res = await fetch(`${base}/rest/v1/${tablePath}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer ?? "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 && /food_products|recipes|PGRST205/i.test(text)) {
      throw new Error(
        `${method} ${tablePath} → таблицы конструктора ещё не созданы. Сначала выполните supabase/migrations/20260830120000_nutrition_constructor.sql в Supabase SQL Editor.`,
      );
    }
    throw new Error(`${method} ${tablePath} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

function mapProduct(p) {
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    brand: p.brand ?? null,
    state: p.state,
    measurement_basis: p.measurement_basis,
    kcal_per_100g: p.kcal,
    protein_per_100g: p.protein,
    fat_per_100g: p.fat,
    carbs_per_100g: p.carbs,
    fiber_per_100g: p.fiber ?? null,
    density: p.density ?? null,
    source_name: p.source_name,
    source_url: p.source_url ?? null,
    verified_at: p.is_verified ? new Date().toISOString() : null,
    is_verified: p.is_verified,
    is_active: true,
    allowed_for_snack: p.allowed_for_snack,
    requires_cooking: p.requires_cooking,
    weighing_note: p.weighing_note,
  };
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env");
  process.exit(1);
}

const { products, recipes, inferRecipeMeta, snackActionForRecipe } = await loadSeedData();
console.log(`Seed: ${products.length} продуктов, ${recipes.length} рецептов`);

const chunkSize = 25;
for (let i = 0; i < products.length; i += chunkSize) {
  const chunk = products.slice(i, i + chunkSize).map(mapProduct);
  await rest(
    url,
    key,
    "POST",
    "food_products?on_conflict=slug",
    chunk,
    "resolution=merge-duplicates,return=minimal",
  );
}
console.log("✓ food_products upserted");

const productRows = await rest(
  url,
  key,
  "GET",
  "food_products?select=id,slug",
  null,
  "return=representation",
);
const slugToId = new Map(productRows.map((r) => [r.slug, r.id]));

let mainCount = 0;
let snackCount = 0;
let skipped = 0;

for (const r of recipes) {
  const resolved = r.ingredients
    .map((ing, idx) => {
      const productId = slugToId.get(ing.product_slug);
      if (!productId) return null;
      return {
        product_id: productId,
        min_g: ing.min_g,
        max_g: ing.max_g,
        default_g: ing.default_g,
        is_scalable: true,
        sort_order: idx,
        optional: false,
      };
    })
    .filter(Boolean);

  if (resolved.length === 0) {
    skipped++;
    continue;
  }

  const meta = inferRecipeMeta({
    meal_type: r.meal_type,
    requires_cooking: r.requires_cooking,
    ingredients: r.ingredients,
  });
  const slugs = r.ingredients.map((ing) => ing.product_slug);

  const recipeRows = await rest(
    url,
    key,
    "POST",
    "recipes?on_conflict=slug",
    [
      {
        slug: r.slug,
        name: r.name,
        meal_type: r.meal_type,
        steps: r.steps,
        prep_time_min: r.prep_time_min,
        requires_cooking: r.requires_cooking,
        is_active: true,
        weighing_note: r.weighing_note,
        is_nutrient_dense: meta.is_nutrient_dense,
        contains_protein_source: meta.contains_protein_source,
        contains_fruit_or_vegetable: meta.contains_fruit_or_vegetable,
        is_treat: meta.is_treat,
        allowed_schedule_modes: meta.allowed_schedule_modes,
        snack_action: r.meal_type === "snack" ? snackActionForRecipe(slugs) : null,
      },
    ],
    "resolution=merge-duplicates,return=representation",
  );
  const recipeId = recipeRows[0].id;

  await rest(url, key, "DELETE", `recipe_ingredients?recipe_id=eq.${recipeId}`, null);

  await rest(
    url,
    key,
    "POST",
    "recipe_ingredients",
    resolved.map((ing) => ({ ...ing, recipe_id: recipeId })),
  );

  if (r.meal_type === "main") mainCount++;
  else snackCount++;
}

console.log(
  `✓ recipes upserted: ${mainCount} main, ${snackCount} snack (${skipped} skipped — нет продуктов в БД)`,
);
console.log("Готово. Перезагрузите schema cache в Supabase при необходимости.");
