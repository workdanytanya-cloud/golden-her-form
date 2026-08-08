/**
 * Доводит пулы блюд до ≥7 вариантов на каждый приём (завтрак/обед/ужин/перекус),
 * чтобы неделя из 3 приёмов могла идти без повторов.
 *
 * Идеи блюд — по типам с calorizator.ru/recipes (салаты, супы, вторые, каши),
 * тексты рецептов и названия — свои, без копипаста.
 *
 * node scripts/generate-dishes-pool-fill.mjs
 * node scripts/apply-dishes-seed.mjs scripts/dishes-pool-fill.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = 7;
const outSql = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260808170000_seed_dishes_pool_fill.sql",
);
const outJson = path.join(__dirname, "dishes-pool-fill.json");

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
  if (calories < 25 || calories > 550) throw new Error(`kcal ${calories} ${d.slug}`);
  dishes.push({ ...d, calories });
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ─── Общая библиотека: +2 на каждый приём → 8 ───────────────────────────────
const generalExtra = [
  ["breakfast", "amaranth-berry", "Амарантовая каша с ягодами", { p: 3.6, f: 2.8, c: 16.2 }, 280,
    "Каша из амаранта на воде с ягодами — без сахара.",
    [{ raw: "Амарант", raw_g: 45, cooked_g: 160 }, { raw: "Ягоды", raw_g: 70, cooked_g: 70 }, { raw: "Вода", raw_g: 220, cooked_g: 0 }],
    ["Амарант промыть и варить 20–25 мин", "Добавить ягоды в конце"], ["овсянка", "ягоды"]],
  ["breakfast", "syrniki-steam", "Сырники на пару без сахара", { p: 12.4, f: 4.8, c: 9.6 }, 220,
    "Творожные сырники на пару — без жарки и сахара.",
    [{ raw: "Творог 5%", raw_g: 160, cooked_g: 150 }, { raw: "Яйцо", raw_g: 40, cooked_g: 40 }, { raw: "Мука цельнозерновая", raw_g: 20, cooked_g: 20 }],
    ["Смешать творог с яйцом и мукой", "Сформовать, готовить на пару 15 мин"], ["молочка", "белок"]],
  ["lunch", "ratatouille-chicken", "Овощной рататуй с курицей", { p: 11.8, f: 4.6, c: 7.4 }, 360,
    "Тушёные овощи в духе рататуя и кусок курицы.",
    [{ raw: "Куриная грудка", raw_g: 130, cooked_g: 105 }, { raw: "Кабачок, баклажан, перец, томат", raw_g: 250, cooked_g: 210 }, { raw: "Масло", raw_g: 8, cooked_g: 8 }],
    ["Овощи тушить до мягкости", "Курицу запечь отдельно", "Подать вместе"], ["птица", "овощи"]],
  ["lunch", "lentil-soup", "Суп из чечевицы с зеленью", { p: 6.2, f: 2.8, c: 11.4 }, 350,
    "Густой суп из красной чечевицы — первое блюдо без жира.",
    [{ raw: "Чечевица красная", raw_g: 55, cooked_g: 140 }, { raw: "Морковь, сельдерей", raw_g: 120, cooked_g: 100 }, { raw: "Масло", raw_g: 6, cooked_g: 6 }],
    ["Чечевицу и овощи варить до мягкости", "Пробить блендером частично", "Заправить маслом"], ["бобовые", "суп"]],
  ["dinner", "tuna-veg-salad", "Салат с тунцом и овощами", { p: 14.2, f: 5.6, c: 4.2 }, 300,
    "Салат с консервированным тунцом в собственном соку и свежими овощами.",
    [{ raw: "Тунец в собственном соку", raw_g: 120, cooked_g: 120 }, { raw: "Огурец, томат, салат", raw_g: 180, cooked_g: 180 }, { raw: "Масло оливковое", raw_g: 7, cooked_g: 7 }],
    ["Овощи нарезать", "Добавить тунец", "Заправить маслом"], ["рыба", "овощи"]],
  ["dinner", "shrimp-quinoa", "Креветки с киноа", { p: 13.6, f: 3.8, c: 12.8 }, 320,
    "Креветки и киноа с лимоном — лёгкий ужин.",
    [{ raw: "Креветки очищенные", raw_g: 140, cooked_g: 120 }, { raw: "Киноа сухая", raw_g: 45, cooked_g: 125 }, { raw: "Масло", raw_g: 6, cooked_g: 6 }],
    ["Киноа отварить", "Креветки быстро обжарить", "Смешать с лимоном"], ["морепродукты", "киноа"]],
  ["snack", "hummus-veg", "Хумус с овощными палочками", { p: 5.4, f: 6.2, c: 10.8 }, 180,
    "Нутовый хумус и сырые овощи вместо хлеба.",
    [{ raw: "Нут варёный", raw_g: 80, cooked_g: 80 }, { raw: "Тахини/масло", raw_g: 10, cooked_g: 10 }, { raw: "Морковь, огурец", raw_g: 100, cooked_g: 100 }],
    ["Нут пробить с маслом и специями", "Подать с овощами"], ["бобовые", "овощи"]],
  ["snack", "ryazhenka-berries", "Ряженка с ягодами", { p: 3.4, f: 2.8, c: 8.6 }, 220,
    "Ряженка и ягоды без добавленного сахара.",
    [{ raw: "Ряженка 2,5%", raw_g: 180, cooked_g: 180 }, { raw: "Ягоды", raw_g: 60, cooked_g: 60 }],
    ["Смешать"], ["молочка", "ягоды"]],
];

for (const [meal, suf, name, macros, portion, description, ingredients, steps, extra] of generalExtra) {
  add({
    slug: `gen-${meal}-${suf}`,
    name,
    meal,
    tags: ["general", ...extra],
    p: macros.p, f: macros.f, c: macros.c,
    portion, description, ingredients, steps,
    replacements: [],
  });
}

// ─── Спец-меню без сахара/глютена/лактозы: до 7 ────────────────────────────
const SGL = "special_no_sugar_gluten_lactose";
const sglExtra = [
  ["breakfast", "millet-water-herbs", "Пшённая каша на воде с зеленью", { p: 3.8, f: 3.2, c: 15.4 }, 280,
    "Пшено на воде — без молока, сахара и овсянки.",
    [{ raw: "Пшено", raw_g: 50, cooked_g: 170 }, { raw: "Вода", raw_g: 240, cooked_g: 0 }, { raw: "Масло оливковое", raw_g: 6, cooked_g: 6 }, { raw: "Зелень", raw_g: 10, cooked_g: 10 }],
    ["Пшено промыть несколько раз", "Варить до мягкости", "Заправить маслом и зеленью"], ["крупа"]],
  ["breakfast", "egg-broccoli-bake", "Яйца с брокколи в духовке", { p: 11.2, f: 8.4, c: 3.2 }, 240,
    "Запечённые яйца и брокколи без сыра и сливок.",
    [{ raw: "Яйца", raw_g: 110, cooked_g: 110 }, { raw: "Брокколи", raw_g: 120, cooked_g: 100 }, { raw: "Масло", raw_g: 5, cooked_g: 5 }],
    ["Брокколи бланшировать", "Залить яйцами, запечь 12–15 мин"], ["яйца", "овощи"]],
  ["breakfast", "chicken-pepper-morning", "Курица с перцем (утро)", { p: 15.2, f: 3.6, c: 3.8 }, 280,
    "Белковый завтрак без круп с глютеном и без молочки.",
    [{ raw: "Куриная грудка", raw_g: 150, cooked_g: 120 }, { raw: "Перец болгарский", raw_g: 120, cooked_g: 100 }, { raw: "Масло", raw_g: 5, cooked_g: 5 }],
    ["Курицу и перец быстро обжарить/запечь"], ["птица", "овощи"]],
  ["lunch", "rabbit-buckwheat", "Кролик с гречкой", { p: 14.4, f: 4.2, c: 12.6 }, 350,
    "Кролик и гречка — без риса и макарон.",
    [{ raw: "Кролик", raw_g: 150, cooked_g: 120 }, { raw: "Гречка", raw_g: 50, cooked_g: 140 }, { raw: "Масло", raw_g: 5, cooked_g: 5 }],
    ["Кролика тушить до мягкости", "Гречку отварить"], ["птица", "гречка"]],
  ["lunch", "mackerel-cabbage", "Скумбрия запечённая с капустой", { p: 13.2, f: 9.4, c: 3.6 }, 330,
    "Жирная рыба и капуста — без панировки.",
    [{ raw: "Скумбрия филе", raw_g: 140, cooked_g: 120 }, { raw: "Капуста", raw_g: 180, cooked_g: 150 }, { raw: "Лимон", raw_g: 8, cooked_g: 0 }],
    ["Запечь рыбу и капусту 20 мин"], ["рыба", "овощи"]],
  ["lunch", "beef-green-beans", "Говядина со стручковой фасолью", { p: 14.8, f: 5.2, c: 4.8 }, 340,
    "Говядина и зелёная фасоль без сладких соусов.",
    [{ raw: "Говядина", raw_g: 150, cooked_g: 120 }, { raw: "Стручковая фасоль", raw_g: 180, cooked_g: 150 }, { raw: "Масло", raw_g: 7, cooked_g: 7 }],
    ["Мясо тушить", "Фасоль отварить/обжарить отдельно"], ["говядина", "овощи"]],
  ["dinner", "turkey-eggplant", "Индейка с баклажаном", { p: 14.2, f: 4.6, c: 4.2 }, 320,
    "Индейка и баклажан без сыра и томатного сахара.",
    [{ raw: "Филе индейки", raw_g: 150, cooked_g: 120 }, { raw: "Баклажан", raw_g: 180, cooked_g: 140 }, { raw: "Масло", raw_g: 7, cooked_g: 7 }],
    ["Баклажан запечь", "Индейку довести до готовности"], ["птица", "овощи"]],
  ["dinner", "pollock-spinach", "Минтай со шпинатом", { p: 14.6, f: 3.2, c: 2.4 }, 300,
    "Белая рыба и шпинат на пару/в духовке.",
    [{ raw: "Минтай", raw_g: 170, cooked_g: 140 }, { raw: "Шпинат", raw_g: 120, cooked_g: 80 }, { raw: "Масло", raw_g: 5, cooked_g: 5 }],
    ["Рыбу запечь", "Шпинат прогреть с маслом"], ["рыба", "овощи"]],
  ["dinner", "veal-cucumber-salad", "Телятина с огуречным салатом", { p: 15.0, f: 4.0, c: 2.8 }, 310,
    "Отварная телятина и свежие огурцы с зеленью.",
    [{ raw: "Телятина", raw_g: 150, cooked_g: 120 }, { raw: "Огурец, зелень", raw_g: 160, cooked_g: 160 }, { raw: "Масло", raw_g: 5, cooked_g: 5 }],
    ["Мясо отварить", "Салат заправить маслом"], ["говядина", "овощи"]],
  ["snack", "walnut-cucumber", "Грецкий орех с огурцом", { p: 4.2, f: 13.6, c: 4.8 }, 120,
    "Перекус без фруктовых соков и йогурта.",
    [{ raw: "Грецкий орех", raw_g: 25, cooked_g: 25 }, { raw: "Огурец", raw_g: 90, cooked_g: 90 }],
    ["Подать вместе"], ["орехи", "овощи"]],
  ["snack", "chicken-celery", "Курица с сельдереем", { p: 15.8, f: 2.2, c: 1.8 }, 150,
    "Нарезка курицы и сельдерей.",
    [{ raw: "Куриная грудка готовая", raw_g: 100, cooked_g: 100 }, { raw: "Сельдерей", raw_g: 80, cooked_g: 80 }],
    ["Нарезать и подать"], ["птица", "овощи"]],
  ["snack", "olives-pepper", "Оливки с перцем", { p: 1.6, f: 10.8, c: 4.2 }, 130,
    "Оливки и болгарский перец без хлеба.",
    [{ raw: "Оливки", raw_g: 40, cooked_g: 40 }, { raw: "Перец", raw_g: 90, cooked_g: 90 }],
    ["Нарезать перец, подать с оливками"], ["овощи"]],
];

for (const [meal, suf, name, macros, portion, description, ingredients, steps, extra] of sglExtra) {
  add({
    slug: `sgl-${meal}-${suf}`,
    name,
    meal,
    tags: [SGL, "без_сахара", "без_глютена", "без_лактозы", ...extra],
    p: macros.p, f: macros.f, c: macros.c,
    portion, description, ingredients, steps,
    replacements: [],
  });
}

/**
 * Шаблоны «добора» для столов Певзнера (по 5 новых на приём → итого 7).
 * Ингредиенты подстраиваются под номер стола.
 */
function tableProfile(t) {
  const gentle = t === 1 || t === 4 || t === 13;
  const lowSalt = t === 7 || t === 10;
  const lowPurine = t === 6;
  const lowCarbFast = t === 8 || t === 9;
  const enrich = t === 11;
  const acid = t === 14;
  return { gentle, lowSalt, lowPurine, lowCarbFast, enrich, acid };
}

function grainFor(t) {
  if (t === 1 || t === 4 || t === 13) return { raw: "Рис", dry: 45, cooked: 160 };
  if (t === 8 || t === 9) return { raw: "Гречка", dry: 45, cooked: 125 };
  if (t === 14) return { raw: "Гречка", dry: 55, cooked: 150 };
  return { raw: "Гречка", dry: 50, cooked: 140 };
}

function proteinFor(t, i) {
  const opts = [
    { raw: "Куриная грудка", g: 140, cooked: 110, tag: "птица" },
    { raw: "Индейка", g: 140, cooked: 110, tag: "птица" },
    { raw: "Треска", g: 150, cooked: 125, tag: "рыба" },
    { raw: "Говядина постная", g: 140, cooked: 110, tag: "говядина" },
    { raw: "Хек", g: 150, cooked: 125, tag: "рыба" },
  ];
  if (t === 6) return opts.filter((o) => o.tag !== "говядина")[i % 3]; // меньше мяса
  return opts[i % opts.length];
}

function vegFor(t, i) {
  if (t === 1 || t === 4) {
    const v = [
      { raw: "Кабачок тушёный", g: 180 },
      { raw: "Морковь варёная", g: 150 },
      { raw: "Тыква тушёная", g: 180 },
      { raw: "Цветная капуста", g: 180 },
      { raw: "Картофельное пюре", g: 160 },
    ];
    return v[i % v.length];
  }
  if (t === 14) {
    const v = [
      { raw: "Макароны отварные", g: 160 },
      { raw: "Рис отварной", g: 160 },
      { raw: "Гречка", g: 150 },
    ];
    return v[i % v.length];
  }
  const v = [
    { raw: "Брокколи", g: 180 },
    { raw: "Кабачок", g: 180 },
    { raw: "Салат и огурец", g: 160 },
    { raw: "Капуста тушёная", g: 180 },
    { raw: "Стручковая фасоль", g: 170 },
  ];
  return v[i % v.length];
}

const breakfastNames = [
  ["Каша с яйцом", "porridge-egg"],
  ["Омлет с овощами", "omelette-veg"],
  ["Творожная масса", "curd-bowl"],
  ["Запеканка лёгкая", "light-bake"],
  ["Белковый боул", "protein-bowl"],
];
const lunchNames = [
  ["Суп с фрикадельками", "soup-meatballs"],
  ["Салат с белком", "protein-salad"],
  ["Крупа с мясом/рыбой", "grain-protein"],
  ["Рагу овощное с белком", "veg-ragout"],
  ["Запечённый белок с гарниром", "baked-protein"],
];
const dinnerNames = [
  ["Рыба/птица с овощами", "fish-or-poultry"],
  ["Салат-ужин", "dinner-salad"],
  ["Тушёное мясо с овощами", "stew-veg"],
  ["Суфле/котлета паровая", "steam-cutlet"],
  ["Овощной гарнир с яйцом", "veg-egg"],
];
const snackNames = [
  ["Кисломолочный перекус", "fermented"],
  ["Фрукт/ягоды с белком", "fruit-protein"],
  ["Овощной перекус", "veg-snack"],
  ["Яйцо с овощем", "egg-snack"],
  ["Компот/напиток с галетой", "drink-bite"],
];

for (let t = 1; t <= 15; t++) {
  const prof = tableProfile(t);
  for (let i = 0; i < 5; i++) {
    // breakfast
    {
      const [label, suf] = breakfastNames[i];
      const g = grainFor(t);
      let name, ingredients, steps, macros, portion, extra;
      if (i === 0) {
        name = `${g.raw} с яйцом (стол №${t})`;
        ingredients = [
          { raw: `${g.raw} сухой`, raw_g: g.dry, cooked_g: g.cooked },
          { raw: "Яйцо", raw_g: 55, cooked_g: 55 },
          { raw: prof.lowSalt ? "Масло без соли" : "Масло", raw_g: prof.enrich ? 10 : 5, cooked_g: prof.enrich ? 10 : 5 },
        ];
        steps = ["Крупу отварить на воде", "Подать с варёным яйцом"];
        macros = { p: 7.2 + (i % 3) * 0.3, f: 4.8 + (prof.enrich ? 2 : 0), c: 13.5 };
        portion = 290;
        extra = ["яйца", "завтрак"];
      } else if (i === 1) {
        name = `Омлет с овощами (стол №${t})`;
        const veg = vegFor(t, i);
        ingredients = [
          { raw: "Яйца", raw_g: 110, cooked_g: 110 },
          { raw: veg.raw, raw_g: Math.min(veg.g, 120), cooked_g: Math.min(veg.g, 100) },
          { raw: "Масло", raw_g: 5, cooked_g: 5 },
        ];
        steps = prof.gentle
          ? ["Овощи отварить/на пару", "Яйца приготовить на пару или под крышкой"]
          : ["Овощи прогреть", "Влить яйца, довести до готовности"];
        macros = { p: 9.6, f: 7.8, c: prof.lowCarbFast ? 2.8 : 4.2 };
        portion = 240;
        extra = ["яйца", "овощи"];
      } else if (i === 2) {
        if (t === 14 || (prof.lowPurine && i === 2)) {
          // стол 14 — меньше молока; стол 6 — творог ок
        }
        if (t === 14) {
          name = `Яйцо с гречкой (добор стол №${t})`;
          ingredients = [
            { raw: "Гречка", raw_g: 50, cooked_g: 140 },
            { raw: "Яйцо", raw_g: 55, cooked_g: 55 },
          ];
          steps = ["Отварить гречку и яйцо"];
          macros = { p: 8.2, f: 5.4, c: 14.0 };
          portion = 270;
          extra = ["яйца", "гречка"];
        } else {
          name = `Творог с добавкой (стол №${t})`;
          ingredients = [
            { raw: t === 5 || t === 8 || t === 9 ? "Творог 0–5%" : "Творог 5%", raw_g: 150, cooked_g: 150 },
            { raw: t === 1 || t === 4 ? "Печёное яблоко" : "Огурец или ягоды", raw_g: 70, cooked_g: 70 },
          ];
          steps = ["Смешать творог с добавкой"];
          macros = { p: 13.2, f: 3.6, c: 5.4 };
          portion = 220;
          extra = ["молочка", "белок"];
        }
      } else if (i === 3) {
        name = `Запеканка лёгкая (стол №${t})`;
        ingredients = [
          { raw: t === 14 ? "Фарш куриный" : "Творог/фарш куриный", raw_g: 140, cooked_g: 130 },
          { raw: "Яйцо", raw_g: 40, cooked_g: 40 },
          { raw: "Овощ тёртый", raw_g: 60, cooked_g: 50 },
        ];
        steps = ["Смешать", "Запечь 25 мин при 180°C"];
        macros = { p: 12.6, f: 4.8, c: 6.2 };
        portion = 230;
        extra = ["белок"];
      } else {
        const pr = proteinFor(t, i);
        name = `${pr.raw.split(" ")[0]} с овощами утром (стол №${t})`;
        const veg = vegFor(t, i);
        ingredients = [
          { raw: pr.raw, raw_g: pr.g, cooked_g: pr.cooked },
          { raw: veg.raw, raw_g: veg.g, cooked_g: Math.round(veg.g * 0.85) },
        ];
        steps = ["Белок приготовить отвариванием/запеканием", "Овощи — по правилам стола"];
        macros = { p: 13.8, f: 4.2, c: prof.lowCarbFast ? 4.0 : 6.5 };
        portion = 300;
        extra = [pr.tag, "овощи"];
      }
      if (prof.lowSalt) extra.push("без_соли");
      add({
        slug: `t${t}-breakfast-fill${i + 1}-${suf}`,
        name,
        meal: "breakfast",
        tags: [`table_${t}`, `стол_${t}`, ...extra],
        p: macros.p, f: macros.f, c: macros.c,
        portion,
        description: `Добор библиотеки стола №${t}: ${label.toLowerCase()}. Порции масштабируются под любую калорийность.`,
        ingredients,
        steps,
        replacements: [],
      });
    }

    // lunch
    {
      const [, suf] = lunchNames[i];
      const pr = proteinFor(t, i + 1);
      const g = grainFor(t);
      const veg = vegFor(t, i + 2);
      let name, ingredients, steps, macros, portion, extra;
      if (i === 0) {
        name = `Суп с фрикадельками (стол №${t})`;
        ingredients = [
          { raw: "Фарш постный", raw_g: 80, cooked_g: 70 },
          { raw: "Овощи для супа", raw_g: 180, cooked_g: 160 },
          { raw: "Крупа/вермишель по столу", raw_g: 25, cooked_g: 60 },
        ];
        steps = ["Сформовать фрикадельки", "Варить овощи", "Добавить фрикадельки"];
        if (t === 1 || t === 5) steps = ["Бульон слабый/овощной", "Фрикадельки на пару или в супе", "Без зажарки"];
        macros = { p: 7.4, f: 3.2, c: 7.8 };
        portion = 360;
        extra = ["суп", pr.tag];
      } else if (i === 1) {
        name = `Салат с ${pr.tag} (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: pr.g, cooked_g: pr.cooked },
          { raw: prof.gentle ? "Овощи варёные" : veg.raw, raw_g: 160, cooked_g: 150 },
          { raw: "Масло", raw_g: 7, cooked_g: 7 },
        ];
        steps = ["Белок приготовить", "Овощи нарезать/потушить", "Заправить маслом"];
        macros = { p: 13.4, f: 5.0, c: 4.6 };
        portion = 330;
        extra = [pr.tag, "овощи"];
      } else if (i === 2) {
        name = `${g.raw} с ${pr.raw.split(" ")[0].toLowerCase()} (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: pr.g, cooked_g: pr.cooked },
          { raw: `${g.raw} сухой`, raw_g: g.dry, cooked_g: g.cooked },
        ];
        steps = ["Крупу отварить", "Белок отварить или запечь"];
        macros = { p: 13.6, f: 4.0, c: 13.2 };
        portion = 350;
        extra = [pr.tag];
      } else if (i === 3) {
        name = `Овощное рагу с белком (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: 120, cooked_g: 100 },
          { raw: veg.raw, raw_g: veg.g + 40, cooked_g: Math.round((veg.g + 40) * 0.85) },
          { raw: "Масло", raw_g: 6, cooked_g: 6 },
        ];
        steps = ["Овощи тушить", "Добавить готовый белок"];
        macros = { p: 12.2, f: 4.4, c: 6.8 };
        portion = 340;
        extra = [pr.tag, "овощи"];
      } else {
        name = `Запечённый белок с гарниром (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: pr.g, cooked_g: pr.cooked },
          { raw: veg.raw, raw_g: veg.g, cooked_g: Math.round(veg.g * 0.85) },
        ];
        steps = ["Запечь белок", "Гарнир по правилам стола"];
        macros = { p: 14.0, f: 4.6, c: 5.8 };
        portion = 340;
        extra = [pr.tag];
      }
      if (prof.lowSalt) extra.push("без_соли");
      add({
        slug: `t${t}-lunch-fill${i + 1}-${suf}`,
        name,
        meal: "lunch",
        tags: [`table_${t}`, `стол_${t}`, ...extra],
        p: macros.p, f: macros.f, c: macros.c,
        portion,
        description: `Добор обедов стола №${t}. Рецепт оригинальный; идея подачи — из типовых вторых/супов/салатов.`,
        ingredients,
        steps,
        replacements: [],
      });
    }

    // dinner
    {
      const [, suf] = dinnerNames[i];
      const pr = proteinFor(t, i + 2);
      const veg = vegFor(t, i + 1);
      let name, ingredients, steps, macros, portion, extra;
      if (i === 0) {
        name = `${pr.raw} с овощами на ужин (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: pr.g, cooked_g: pr.cooked },
          { raw: veg.raw, raw_g: veg.g, cooked_g: Math.round(veg.g * 0.85) },
          { raw: "Масло", raw_g: 6, cooked_g: 6 },
        ];
        steps = ["Приготовить белок", "Овощи отдельно", "Подать тёплым"];
        macros = { p: 13.8, f: 4.4, c: 5.2 };
        portion = 330;
        extra = [pr.tag, "ужин"];
      } else if (i === 1) {
        name = `Лёгкий салат на ужин (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: 120, cooked_g: 100 },
          { raw: prof.gentle ? "Овощи мягкие" : "Салат, огурец", raw_g: 160, cooked_g: 150 },
          { raw: "Масло", raw_g: 7, cooked_g: 7 },
        ];
        steps = ["Собрать салат", "Добавить белок"];
        macros = { p: 12.8, f: 5.2, c: 3.8 };
        portion = 300;
        extra = [pr.tag, "овощи"];
      } else if (i === 2) {
        name = `Тушёное с овощами (стол №${t})`;
        ingredients = [
          { raw: pr.raw, raw_g: 130, cooked_g: 105 },
          { raw: veg.raw, raw_g: veg.g + 30, cooked_g: Math.round((veg.g + 30) * 0.85) },
        ];
        steps = ["Тушить под крышкой до мягкости"];
        macros = { p: 13.2, f: 4.8, c: 6.0 };
        portion = 330;
        extra = [pr.tag];
      } else if (i === 3) {
        name = `Паровая котлета с гарниром (стол №${t})`;
        ingredients = [
          { raw: "Фарш постный", raw_g: 130, cooked_g: 110 },
          { raw: "Яйцо/хлеб по столу", raw_g: 25, cooked_g: 20 },
          { raw: veg.raw, raw_g: 150, cooked_g: 130 },
        ];
        steps = ["Сформовать котлеты", "Готовить на пару", "Подать с гарниром"];
        macros = { p: 13.6, f: 5.0, c: 7.2 };
        portion = 320;
        extra = ["говядина"];
      } else {
        name = `Овощи с яйцом на ужин (стол №${t})`;
        ingredients = [
          { raw: "Яйца", raw_g: 100, cooked_g: 100 },
          { raw: veg.raw, raw_g: veg.g, cooked_g: Math.round(veg.g * 0.85) },
          { raw: "Масло", raw_g: 5, cooked_g: 5 },
        ];
        steps = ["Овощи приготовить", "Яйца всмятку или омлет"];
        macros = { p: 9.4, f: 7.2, c: 4.6 };
        portion = 280;
        extra = ["яйца", "овощи"];
      }
      if (prof.lowSalt) extra.push("без_соли");
      add({
        slug: `t${t}-dinner-fill${i + 1}-${suf}`,
        name,
        meal: "dinner",
        tags: [`table_${t}`, `стол_${t}`, ...extra],
        p: macros.p, f: macros.f, c: macros.c,
        portion,
        description: `Добор ужинов стола №${t}.`,
        ingredients,
        steps,
        replacements: [],
      });
    }

    // snack
    {
      const [, suf] = snackNames[i];
      let name, ingredients, steps, macros, portion, extra;
      if (i === 0) {
        if (t === 14) {
          name = `Яйцо с хлебцем (добор стол №${t})`;
          ingredients = [
            { raw: "Яйцо", raw_g: 55, cooked_g: 55 },
            { raw: "Хлебец", raw_g: 35, cooked_g: 35 },
          ];
          steps = ["Подать вместе"];
          macros = { p: 8.8, f: 6.2, c: 11.4 };
          portion = 150;
          extra = ["яйца"];
        } else {
          name = `Кефир/йогурт (стол №${t})`;
          ingredients = [{ raw: "Кефир или йогурт натуральный", raw_g: 200, cooked_g: 200 }];
          steps = ["Выпить комнатной температуры"];
          macros = { p: 3.4, f: 1.8, c: 4.2 };
          portion = 200;
          extra = ["молочка"];
        }
      } else if (i === 1) {
        name = t === 1 || t === 4
          ? `Печёное яблоко (стол №${t})`
          : `Ягоды или яблоко с творогом (стол №${t})`;
        ingredients = t === 1 || t === 4
          ? [{ raw: "Яблоко", raw_g: 150, cooked_g: 130 }]
          : t === 14
            ? [{ raw: "Яйцо", raw_g: 55, cooked_g: 55 }, { raw: "Хлеб", raw_g: 30, cooked_g: 30 }]
            : [
                { raw: "Творог", raw_g: 100, cooked_g: 100 },
                { raw: "Ягоды/яблоко", raw_g: 80, cooked_g: 80 },
              ];
        steps = ["Подготовить и подать"];
        macros = t === 1 || t === 4
          ? { p: 0.5, f: 0.3, c: 13.2 }
          : t === 14
            ? { p: 8.6, f: 6.0, c: 10.8 }
            : { p: 10.2, f: 2.8, c: 7.4 };
        portion = t === 1 || t === 4 ? 150 : 180;
        extra = t === 14 ? ["яйца"] : ["перекус"];
      } else if (i === 2) {
        name = `Овощной перекус (стол №${t})`;
        ingredients = [
          { raw: prof.gentle ? "Морковь варёная" : "Огурец и морковь", raw_g: 150, cooked_g: 140 },
        ];
        steps = ["Нарезать и подать"];
        macros = { p: 1.2, f: 0.3, c: 6.8 };
        portion = 150;
        extra = ["овощи"];
      } else if (i === 3) {
        name = `Яйцо с овощем (стол №${t})`;
        ingredients = [
          { raw: "Яйцо", raw_g: 55, cooked_g: 55 },
          { raw: prof.gentle ? "Кабачок тушёный" : "Огурец", raw_g: 80, cooked_g: 80 },
        ];
        steps = ["Подать вместе"];
        macros = { p: 8.4, f: 6.4, c: 2.2 };
        portion = 150;
        extra = ["яйца"];
      } else {
        name = `Компот и галета (стол №${t})`;
        ingredients = [
          { raw: "Компот несладкий", raw_g: 180, cooked_g: 180 },
          { raw: t === 4 ? "Сухарь белый" : "Галета простая", raw_g: 25, cooked_g: 25 },
        ];
        steps = ["Подать тёплым"];
        macros = { p: 1.4, f: 1.2, c: 12.6 };
        portion = 200;
        extra = ["перекус"];
      }
      add({
        slug: `t${t}-snack-fill${i + 1}-${suf}`,
        name,
        meal: "snack",
        tags: [`table_${t}`, `стол_${t}`, ...extra],
        p: macros.p, f: macros.f, c: macros.c,
        portion,
        description: `Добор перекусов стола №${t}.`,
        ingredients,
        steps,
        replacements: [],
      });
    }
  }
}

// uniqueness
const slugs = new Set();
for (const d of dishes) {
  if (slugs.has(d.slug)) throw new Error(`dup ${d.slug}`);
  slugs.add(d.slug);
}

const lines = [];
lines.push(`-- Добор пулов до ≥${TARGET} блюд на приём (неделя без повторов при 3 приёмах).`);
lines.push(`-- Идеи типов блюд: calorizator.ru/recipes; тексты свои.`);
lines.push(`-- scripts/generate-dishes-pool-fill.mjs`);
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

fs.writeFileSync(outSql, lines.join("\n"), "utf8");
fs.writeFileSync(outJson, JSON.stringify(dishes, null, 2), "utf8");
console.log(`Wrote ${dishes.length} dishes`);
console.log(`general+ ${dishes.filter((d) => d.tags.includes("general")).length}`);
console.log(`sgl+ ${dishes.filter((d) => d.tags.includes(SGL)).length}`);
console.log(`tables+ ${dishes.filter((d) => d.tags.some((t) => /^table_/.test(t))).length}`);
