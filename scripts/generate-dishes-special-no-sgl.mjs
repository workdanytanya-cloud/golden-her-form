/**
 * Меню «Без сахара, глютена и лактозы» (не противокандидная формулировка).
 * Тег пула: special_no_sugar_gluten_lactose
 * Ккал всегда = round(P×4 + C×4 + F×9).
 *
 * node scripts/generate-dishes-special-no-sgl.mjs
 * node scripts/apply-dishes-seed.mjs scripts/dishes-special-no-sgl.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "special_no_sugar_gluten_lactose";
const migrationName = "20260808160000_seed_dishes_special_no_sgl.sql";
const outSql = path.join(__dirname, "..", "supabase", "migrations", migrationName);
const outJson = path.join(__dirname, "dishes-special-no-sgl.json");

function kcal(p, f, c) {
  return Math.round(p * 4 + c * 4 + f * 9);
}
function esc(s) {
  return String(s).replace(/'/g, "''");
}
function arr(a) {
  return `ARRAY[${a.map((x) => `'${esc(x)}'`).join(",")}]::text[]`;
}
function jsonb(v) {
  return `'${esc(JSON.stringify(v))}'::jsonb`;
}

/** @type {any[]} */
const dishes = [];

function add(d) {
  const calories = kcal(d.p, d.f, d.c);
  if (calories < 20 || calories > 600) throw new Error(`Odd kcal ${calories} for ${d.slug}`);
  if (Math.abs(calories - (d.p * 4 + d.c * 4 + d.f * 9)) > 0.51) {
    throw new Error(`Macro drift ${d.slug}`);
  }
  dishes.push({ ...d, calories });
}

function dish(meal, slugSuffix, name, macros, portion, description, ingredients, steps, extraTags = [], replacements = []) {
  add({
    slug: `sgl-${meal}-${slugSuffix}`,
    name,
    meal,
    tags: [TAG, "без_сахара", "без_глютена", "без_лактозы", ...extraTags],
    p: macros.p,
    f: macros.f,
    c: macros.c,
    portion,
    description,
    ingredients,
    steps,
    replacements,
  });
}

// ─── Завтраки ───────────────────────────────────────────────────────────────
dish(
  "breakfast", "eggs-spinach-avocado", "Яичница со шпинатом и авокадо",
  { p: 10.2, f: 12.4, c: 2.8 }, 260,
  "Белок и полезные жиры: яйца, шпинат, авокадо. Без молока, хлеба и сахара.",
  [
    { raw: "Яйца куриные", raw_g: 110, cooked_g: 110 },
    { raw: "Шпинат", raw_g: 60, cooked_g: 40 },
    { raw: "Авокадо", raw_g: 70, cooked_g: 70 },
    { raw: "Масло оливковое", raw_g: 5, cooked_g: 5 },
  ],
  [
    "Шпинат слегка прогреть на капле масла",
    "Влить яйца, довести до готовности на среднем огне",
    "Подать с дольками авокадо",
  ],
  ["яйца", "овощи", "завтрак"],
  ["Омлет с цукини", "Яйца пашот с зеленью"],
);

dish(
  "breakfast", "buckwheat-egg-cucumber", "Гречка с яйцом и огурцом",
  { p: 8.4, f: 5.6, c: 14.2 }, 300,
  "Гречка вместо злаков с глютеном; яйцо и свежий огурец. Без молочных соусов.",
  [
    { raw: "Гречка сухая", raw_g: 55, cooked_g: 150 },
    { raw: "Яйцо варёное", raw_g: 55, cooked_g: 55 },
    { raw: "Огурец", raw_g: 80, cooked_g: 80 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
  ],
  [
    "Гречку отварить на воде без сахара",
    "Заправить маслом",
    "Подать с яйцом и огурцом",
  ],
  ["гречка", "яйца", "завтрак"],
  ["Киноа с яйцом", "Пшено с овощами"],
);

dish(
  "breakfast", "turkey-zucchini-scramble", "Индейка с кабачком (завтрак)",
  { p: 14.6, f: 4.2, c: 3.6 }, 280,
  "Тёплый белковый завтрак без круп быстрого приготовления и без сыра.",
  [
    { raw: "Филе индейки", raw_g: 140, cooked_g: 115 },
    { raw: "Кабачок", raw_g: 150, cooked_g: 120 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
    { raw: "Зелень", raw_g: 10, cooked_g: 10 },
  ],
  [
    "Индейку нарезать и довести до готовности",
    "Кабачок добавить позже, тушить до мягкости",
    "Посыпать зеленью",
  ],
  ["птица", "овощи", "завтрак"],
  ["Курица со шпинатом"],
);

dish(
  "breakfast", "quinoa-herbs-egg", "Киноа с яйцом и зеленью",
  { p: 9.2, f: 5.8, c: 13.6 }, 290,
  "Киноа на воде, яйцо, зелень и лимон — без овсянки, сахара и молока.",
  [
    { raw: "Киноа сухая", raw_g: 50, cooked_g: 140 },
    { raw: "Яйцо варёное", raw_g: 55, cooked_g: 55 },
    { raw: "Зелень, огурец", raw_g: 70, cooked_g: 70 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
  ],
  [
    "Киноа промыть и отварить",
    "Смешать с маслом и зеленью",
    "Подать с яйцом",
  ],
  ["киноа", "яйца", "завтрак"],
  ["Гречка с яйцом"],
);

// ─── Обеды ──────────────────────────────────────────────────────────────────
dish(
  "lunch", "chicken-buckwheat-broccoli", "Курица с гречкой и брокколи",
  { p: 14.8, f: 4.0, c: 12.2 }, 360,
  "Классический обед меню: птица, гречка, брокколи на пару. Без риса и картофеля.",
  [
    { raw: "Куриная грудка", raw_g: 150, cooked_g: 120 },
    { raw: "Гречка сухая", raw_g: 50, cooked_g: 140 },
    { raw: "Брокколи", raw_g: 150, cooked_g: 130 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
  ],
  [
    "Курицу запечь или отварить",
    "Гречку отварить на воде",
    "Брокколи на пару 6–8 мин, сбрызнуть маслом",
  ],
  ["птица", "гречка", "овощи", "обед"],
  ["Индейка с киноа"],
);

dish(
  "lunch", "beef-quinoa-salad", "Говядина с киноа и листовым салатом",
  { p: 14.2, f: 5.4, c: 11.8 }, 350,
  "Постная говядина, киноа и зелень. Без макарон, хлеба и сливочных соусов.",
  [
    { raw: "Говядина постная", raw_g: 140, cooked_g: 110 },
    { raw: "Киноа сухая", raw_g: 45, cooked_g: 125 },
    { raw: "Салат листовой, огурец", raw_g: 120, cooked_g: 120 },
    { raw: "Масло оливковое", raw_g: 8, cooked_g: 8 },
  ],
  [
    "Говядину запечь или отварить",
    "Киноа отварить",
    "Салат заправить маслом и подать с мясом",
  ],
  ["говядина", "киноа", "овощи", "обед"],
  ["Телятина с гречкой"],
);

dish(
  "lunch", "cod-cauli-stew", "Треска с цветной капустой",
  { p: 13.6, f: 3.8, c: 4.6 }, 340,
  "Белая рыба и цветная капуста — без кляра, картофеля и молочного соуса.",
  [
    { raw: "Филе трески", raw_g: 170, cooked_g: 140 },
    { raw: "Цветная капуста", raw_g: 200, cooked_g: 180 },
    { raw: "Масло оливковое", raw_g: 7, cooked_g: 7 },
    { raw: "Лимонный сок", raw_g: 5, cooked_g: 0 },
  ],
  [
    "Капусту разобрать и отварить/на пару",
    "Рыбу запечь 12–15 мин",
    "Полить маслом и лимоном",
  ],
  ["рыба", "овощи", "обед"],
  ["Хек с кабачками"],
);

dish(
  "lunch", "turkey-cabbage-stew", "Индейка с тушёной капустой",
  { p: 13.8, f: 3.6, c: 5.2 }, 350,
  "Объёмный обед на овощах: капуста и индейка без сахара в заправке.",
  [
    { raw: "Филе индейки", raw_g: 150, cooked_g: 120 },
    { raw: "Капуста белокочанная", raw_g: 220, cooked_g: 180 },
    { raw: "Морковь", raw_g: 40, cooked_g: 35 },
    { raw: "Масло оливковое", raw_g: 7, cooked_g: 7 },
  ],
  [
    "Индейку нарезать и обжарить на масле до готовности",
    "Капусту с морковью тушить до мягкости без сахара",
    "Соединить и прогреть вместе",
  ],
  ["птица", "овощи", "обед"],
  ["Курица с капустой"],
);

// ─── Ужины ──────────────────────────────────────────────────────────────────
dish(
  "dinner", "salmon-asparagus", "Лосось со спаржей",
  { p: 14.4, f: 9.2, c: 2.4 }, 300,
  "Рыба и спаржа на гриле/в духовке. Без глазури, мёда и гарнира из риса.",
  [
    { raw: "Филе лосося", raw_g: 150, cooked_g: 130 },
    { raw: "Спаржа", raw_g: 150, cooked_g: 130 },
    { raw: "Масло оливковое", raw_g: 5, cooked_g: 5 },
    { raw: "Лимон", raw_g: 10, cooked_g: 0 },
  ],
  [
    "Спаржу и рыбу сбрызнуть маслом",
    "Запечь 12–15 мин при 190°C",
    "Подать с лимоном",
  ],
  ["рыба", "овощи", "ужин"],
  ["Форель с брокколи"],
);

dish(
  "dinner", "chicken-avocado-salad", "Салат с курицей и авокадо",
  { p: 14.0, f: 8.6, c: 3.8 }, 320,
  "Лёгкий ужин: курица, листья, огурец, авокадо. Без сухариков и сыра.",
  [
    { raw: "Куриная грудка", raw_g: 140, cooked_g: 110 },
    { raw: "Салат, огурец", raw_g: 150, cooked_g: 150 },
    { raw: "Авокадо", raw_g: 60, cooked_g: 60 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
  ],
  [
    "Курицу отварить или запечь, нарезать",
    "Смешать с овощами и авокадо",
    "Заправить маслом",
  ],
  ["птица", "овощи", "ужин"],
  ["Индейка с рукколой"],
);

dish(
  "dinner", "beef-pepper-stir", "Говядина с перцем и кабачком",
  { p: 14.6, f: 5.8, c: 4.4 }, 330,
  "Быстрое тушение без соевых сладких соусов, крахмала и лапши.",
  [
    { raw: "Говядина постная", raw_g: 150, cooked_g: 120 },
    { raw: "Перец болгарский", raw_g: 100, cooked_g: 85 },
    { raw: "Кабачок", raw_g: 120, cooked_g: 100 },
    { raw: "Масло оливковое", raw_g: 7, cooked_g: 7 },
  ],
  [
    "Мясо обжарить до готовности",
    "Добавить овощи, тушить 5–7 мин",
    "Приправить травами, без сахара",
  ],
  ["говядина", "овощи", "ужин"],
  ["Телятина с баклажаном"],
);

dish(
  "dinner", "cod-zucchini-bake", "Запечённый хек с кабачками",
  { p: 13.8, f: 3.4, c: 3.6 }, 320,
  "Нежирная рыба и кабачки в духовке — без панировки и сырной корочки.",
  [
    { raw: "Хек", raw_g: 170, cooked_g: 140 },
    { raw: "Кабачок", raw_g: 180, cooked_g: 150 },
    { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 },
  ],
  [
    "Кабачки нарезать кружками",
    "Уложить с рыбой, сбрызнуть маслом",
    "Запечь 15–18 мин",
  ],
  ["рыба", "овощи", "ужин"],
  ["Треска с брокколи"],
);

// ─── Перекусы ───────────────────────────────────────────────────────────────
dish(
  "snack", "egg-cucumber", "Яйцо с огурцом",
  { p: 9.2, f: 6.8, c: 1.8 }, 160,
  "Быстрый перекус без йогурта, фруктов и хлебцев.",
  [
    { raw: "Яйцо варёное", raw_g: 55, cooked_g: 55 },
    { raw: "Огурец", raw_g: 100, cooked_g: 100 },
  ],
  ["Яйцо очистить", "Подать с нарезанным огурцом"],
  ["яйца", "овощи", "перекус"],
  ["Яйцо с сельдереем"],
);

dish(
  "snack", "almonds-celery", "Миндаль с сельдереем",
  { p: 6.4, f: 14.2, c: 5.2 }, 120,
  "Орехи и хрустящий овощ вместо сладкого перекуса и фруктовых соков.",
  [
    { raw: "Миндаль сырой", raw_g: 25, cooked_g: 25 },
    { raw: "Сельдерей", raw_g: 80, cooked_g: 80 },
  ],
  ["Промыть сельдерей", "Подать с миндалём"],
  ["орехи", "овощи", "перекус"],
  ["Грецкий орех с огурцом"],
);

dish(
  "snack", "avocado-lemon", "Авокадо с лимоном",
  { p: 2.2, f: 14.8, c: 6.4 }, 140,
  "Жировой перекус без молочных паст и сладких топпингов.",
  [
    { raw: "Авокадо", raw_g: 120, cooked_g: 120 },
    { raw: "Лимонный сок", raw_g: 8, cooked_g: 0 },
    { raw: "Соль по вкусу", raw_g: 1, cooked_g: 1 },
  ],
  ["Разрезать авокадо", "Сбрызнуть лимоном"],
  ["овощи", "перекус"],
  ["Оливки с огурцом"],
);

dish(
  "snack", "turkey-cucumber-roll", "Индейка с огурцом",
  { p: 16.2, f: 2.4, c: 1.6 }, 150,
  "Нарезка индейки и огурец — без сыра и тортильи.",
  [
    { raw: "Филе индейки варёное/запечённое", raw_g: 100, cooked_g: 100 },
    { raw: "Огурец", raw_g: 80, cooked_g: 80 },
  ],
  ["Нарезать индейку", "Свернуть с огурцом или подать рядом"],
  ["птица", "овощи", "перекус"],
  ["Куриная грудка с перцем"],
);

// ─── Verify + write ─────────────────────────────────────────────────────────
const slugs = new Set();
for (const d of dishes) {
  if (slugs.has(d.slug)) throw new Error(`dup ${d.slug}`);
  slugs.add(d.slug);
}
const meals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
for (const d of dishes) meals[d.meal]++;
for (const [k, v] of Object.entries(meals)) {
  if (v < 4) throw new Error(`Need 4 ${k}, got ${v}`);
}

const lines = [];
lines.push(`-- Меню без сахара, глютена и лактозы (тег ${TAG}).`);
lines.push(`-- Рецепты оригинальные; ккал = round(P×4+C×4+F×9).`);
lines.push(`-- scripts/generate-dishes-special-no-sgl.mjs`);
lines.push(``);
lines.push(`INSERT INTO public.dishes (`);
lines.push(`  slug, name, meal_type, tags,`);
lines.push(`  calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g,`);
lines.push(`  portion_weight_g, ingredients, steps, replacements, description`);
lines.push(`) VALUES`);

lines.push(
  ...dishes.map((d, i) => {
    const row = `(
  '${esc(d.slug)}',
  '${esc(d.name)}',
  '${d.meal}',
  ${arr(d.tags)},
  ${d.calories},
  ${d.p},
  ${d.f},
  ${d.c},
  ${d.portion},
  ${jsonb(d.ingredients)},
  ${jsonb(d.steps)},
  ${arr(d.replacements ?? [])},
  '${esc(d.description)}'
)`;
    return row + (i < dishes.length - 1 ? "," : "");
  }),
);

lines.push(`ON CONFLICT (slug) DO UPDATE SET`);
lines.push(`  name = EXCLUDED.name,`);
lines.push(`  meal_type = EXCLUDED.meal_type,`);
lines.push(`  tags = EXCLUDED.tags,`);
lines.push(`  calories_per_100g = EXCLUDED.calories_per_100g,`);
lines.push(`  protein_per_100g = EXCLUDED.protein_per_100g,`);
lines.push(`  fat_per_100g = EXCLUDED.fat_per_100g,`);
lines.push(`  carbs_per_100g = EXCLUDED.carbs_per_100g,`);
lines.push(`  portion_weight_g = EXCLUDED.portion_weight_g,`);
lines.push(`  ingredients = EXCLUDED.ingredients,`);
lines.push(`  steps = EXCLUDED.steps,`);
lines.push(`  replacements = EXCLUDED.replacements,`);
lines.push(`  description = EXCLUDED.description,`);
lines.push(`  updated_at = now();`);
lines.push(``);

fs.writeFileSync(outSql, lines.join("\n"), "utf8");
fs.writeFileSync(outJson, JSON.stringify(dishes, null, 2), "utf8");
console.log(`Wrote ${dishes.length} dishes → ${outSql}`);
