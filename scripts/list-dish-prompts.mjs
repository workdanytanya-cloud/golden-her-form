/**
 * Список блюд без фото + промпты для food-фото.
 * node scripts/list-dish-prompts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

/** Анти-ИИ: домашнее фото с телефона, без студийного глянца и идеальной симметрии */
const STYLE =
  "Authentic handheld smartphone photo of homemade food, looks like a real iPhone kitchen snapshot not AI art, slightly imperfect framing, soft uneven window daylight from one side, natural shadows, true-to-life colors not oversaturated, matte surfaces no plastic shine, visible real food texture crumbs sauce spots irregular plating, plain white or beige home plate on ordinary wooden table or linen, tiny kitchen clutter softly blurred in background optional, shot from 45 degree angle, no text no watermark no logo no hands no utensils floating, no studio softboxes, no CGI, no uncanny perfection";

/** Короткие англ. описания для стабильной генерации */
const NAME_HINTS = {
  "Овсяная каша на воде с ягодами": "oatmeal porridge bowl topped with fresh berries",
  "Омлет из 2 яиц с овощами": "fluffy vegetable omelette with spinach and tomato",
  "Творог 5% с огурцом и зеленью": "cottage cheese bowl with cucumber and fresh herbs",
  "Куриная грудка с гречкой и овощами": "grilled chicken breast with buckwheat and fresh vegetables",
  "Индейка с рисом басмати и салатом": "sliced turkey breast with basmati rice and green salad",
  "Запечённая треска с картофелем": "baked cod fillet with boiled potatoes and herbs",
  "Тушёная говядина с овощами": "stewed lean beef with zucchini carrot onion",
  "Лосось на пару с брокколи": "steamed salmon fillet with broccoli",
  "Салат с курицей и листьями": "chicken salad with mixed greens cucumber olive oil",
  "Йогурт натуральный с яблоком": "plain yogurt bowl with sliced apple",
  "Творог с ягодами": "cottage cheese topped with mixed berries",
  "Яйцо варёное с овощами": "hard boiled eggs with fresh cucumber and tomato",
};

function hintFor(name) {
  if (NAME_HINTS[name]) return NAME_HINTS[name];
  // fallback: transliterate-ish description from Russian name as English food phrase
  return `healthy Russian diet dish: ${name}, neatly plated, medical diet friendly presentation`;
}

function promptFor(dish) {
  const meal =
    dish.meal_type === "breakfast"
      ? "breakfast"
      : dish.meal_type === "lunch"
        ? "lunch"
        : dish.meal_type === "dinner"
          ? "dinner"
          : "snack";
  const hint = hintFor(dish.name);
  return `${STYLE}. ${meal} serving of ${hint}. Portion looks realistic for home cooking.`;
}

const env = loadEnv();
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const res = await fetch(
  `${url}/rest/v1/dishes?select=id,slug,name,meal_type,image_url,tags&order=meal_type.asc,name.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
const dishes = await res.json();
if (!Array.isArray(dishes)) {
  console.error(dishes);
  process.exit(1);
}

const items = dishes.map((d) => ({
  id: d.id,
  slug: d.slug,
  name: d.name,
  meal_type: d.meal_type,
  has_image: Boolean(d.image_url),
  tags: d.tags,
  prompt: promptFor(d),
  filename: `${d.slug}.png`,
}));

const out = path.join(__dirname, "dish-image-prompts.json");
fs.writeFileSync(out, JSON.stringify({ style: STYLE, count: items.length, items }, null, 2), "utf8");

const missing = items.filter((i) => !i.has_image);
console.log(`Total dishes: ${items.length}`);
console.log(`Without image: ${missing.length}`);
console.log(`Wrote ${out}`);
console.log(JSON.stringify(missing.map((m) => ({ slug: m.slug, name: m.name })), null, 2));
