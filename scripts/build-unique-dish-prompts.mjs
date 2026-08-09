/**
 * Готовит промпты для уникальных визуальных групп блюд без фото.
 * Одно фото → копируется на все столы с тем же названием.
 *
 * node scripts/build-unique-dish-prompts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const STYLE =
  "Authentic handheld smartphone photo of homemade food, looks like a real iPhone kitchen snapshot not AI art, slightly imperfect framing, soft uneven window daylight from one side, natural shadows, true-to-life colors not oversaturated, matte surfaces no plastic shine, visible real food texture crumbs sauce spots irregular plating, plain white or beige home plate on ordinary wooden table or linen, tiny kitchen clutter softly blurred in background optional, shot from 45 degree angle, no text no watermark no logo no hands no utensils floating, no studio softboxes, no CGI, no uncanny perfection";

/** Англ. описание по нормализованному русскому названию */
const HINTS = {
  "амарантовая каша с ягодами": "bowl of cooked amaranth porridge topped with mixed berries",
  "белковый омлет с зеленью": "egg-white omelette with chopped dill and parsley on a plate",
  "вязкая овсянка на молоке": "thick viscous oatmeal porridge cooked in milk in a bowl",
  "гречка с кефиром": "bowl of boiled buckwheat with a glass of plain kefir beside it",
  "гречка с яйцом": "plate of boiled buckwheat with a soft boiled egg cut open",
  "гречка с яйцом и огурцом": "buckwheat porridge with boiled egg and cucumber slices",
  "запеканка лёгкая": "simple cottage cheese casserole slice on a small plate",
  "манная каша на воде": "thin semolina porridge cooked in water in a bowl",
  "молочная овсянка": "creamy oatmeal cooked in milk in a ceramic bowl",
  "омлет с овощами": "homemade vegetable omelette with tomato and greens",
  "омлет с огурцом": "plain omelette served with fresh cucumber slices",
  "творог с добавкой": "bowl of cottage cheese with a simple topping",
  "творожная запеканка без сахара": "sugar-free cottage cheese bake portion",
  "сыроники на пару без сахара": "steamed sugar-free cottage cheese pancakes",
  "яйцо с гречкой": "boiled egg next to a portion of buckwheat",
  "яичница со шпинатом и авокадо": "fried eggs with spinach and avocado slices",
  "яйца с брокколи в духовке": "baked eggs with broccoli florets in a small dish",
};

function hintFor(name, key) {
  if (HINTS[key]) return HINTS[key];
  return `homemade Russian diet meal: ${name}, simple home plating, medical diet friendly, modest portion`;
}

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

function visualKey(name) {
  return name
    .replace(/\s*\(стол\s*№?\s*\d+\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(
  `${url}/rest/v1/dishes?select=id,slug,name,meal_type,image_url&order=name.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
const dishes = await res.json();
const without = dishes.filter((d) => !d.image_url);
const groups = new Map();
for (const d of without) {
  const k = visualKey(d.name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(d);
}

const items = [...groups.entries()].map(([key, list]) => {
  const name = list[0].name.replace(/\s*\(стол\s*№?\s*\d+\)\s*/gi, "").trim();
  const meal = list[0].meal_type;
  const primarySlug =
    list.find((i) => i.slug.startsWith("gen-") && !i.slug.includes("-fill"))?.slug ||
    list.find((i) => !i.slug.includes("-fill"))?.slug ||
    list[0].slug;
  const hint = hintFor(name, key);
  return {
    key,
    name,
    meal_type: meal,
    count: list.length,
    primarySlug,
    filename: `${primarySlug}.png`,
    ids: list.map((x) => x.id),
    slugs: list.map((x) => x.slug),
    prompt: `${STYLE}. ${meal} serving of ${hint}. Casual home cooking portion, modest and believable.`,
  };
});

items.sort((a, b) => a.meal_type.localeCompare(b.meal_type) || a.name.localeCompare(b.name, "ru"));

const out = path.join(__dirname, "dish-image-unique-prompts.json");
fs.writeFileSync(out, JSON.stringify({ style: STYLE, count: items.length, items }, null, 2), "utf8");
console.log(`Unique groups needing photos: ${items.length}`);
console.log(`Wrote ${out}`);
