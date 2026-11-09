import { OIL_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";

/** Клиентские названия. Сырой и сухой вес названы явно. */
export const CLIENT_PRODUCT_NAMES: Record<string, string> = {
  "buckwheat-dry": "Гречка сухая",
  "rice-white-dry": "Рис сухой",
  "oats-dry": "Овсяные хлопья сухие",
  "bulgur-dry": "Булгур сухой",
  "couscous-dry": "Кускус сухой",
  "pearl-barley-dry": "Перловка сухая",
  "lentils-dry": "Чечевица сухая",
  "pasta-durum-dry": "Макароны сухие",
  "potato-raw": "Картофель сырой",
  "chicken-breast-raw": "Филе куриной грудки",
  "beef-lean-raw": "Говядина нежирная",
  "pollock-raw": "Минтай, филе",
  "cod-raw": "Треска, филе",
  "hake-raw": "Хек, филе",
  "pink-salmon-raw": "Горбуша, филе",
  "turkey-breast-raw": "Филе индейки",
  "ground-turkey-raw": "Фарш индейки",
  "chicken-thigh-raw": "Бедро куриное без кожи",
  "egg-whole": "Яйцо куриное",
  "egg-white-raw": "Яичный белок",
  cucumber: "Огурец",
  tomato: "Помидор",
  "bell-pepper": "Болгарский перец",
  zucchini: "Кабачок",
  eggplant: "Баклажан",
};

export function clientProductName(slug: string, fallback: string): string {
  return CLIENT_PRODUCT_NAMES[slug] ?? fallback;
}

/** Дубликаты не удаляются: остаются в базе и выключены из новой генерации. */
export const ARCHIVED_DUPLICATE_SLUGS = new Set(["omelette-tomato-pepper-cheese"]);

export const CANONICAL_RECIPE_OF: Record<string, string> = {
  "omelette-tomato-pepper-cheese": "omelette-tomato-pepper",
};

const SPICE_OR_WATER = new Set(["water", "salt", "black-pepper", "dried-herbs"]);

export function coreIngredientSlugs(slugs: string[]): string[] {
  return slugs.filter((slug) => !OIL_PRODUCT_SLUGS.has(slug) && !SPICE_OR_WATER.has(slug));
}

export function diversifyVariantGroup(group: string, requiredSlugs: string[]): string {
  if (group !== "none|veg|assemble") return group;
  const core = coreIngredientSlugs(requiredSlugs).sort();
  return core.length > 0 ? `${group}|${core.join("+")}` : group;
}

const STEP_MENTIONS: Array<{ pattern: RegExp; slugs: string[] }> = [
  { pattern: /сыр/i, slugs: ["hard-cheese"] },
  { pattern: /оливков/i, slugs: ["olive-oil"] },
  { pattern: /подсолнечн\w* масл/i, slugs: ["sunflower-oil"] },
  { pattern: /сливочн\w* масл/i, slugs: ["butter"] },
];

/** Убирает шаги про отсутствующий продукт и дополняет до 3 понятных шагов. */
export function ensureReadableSteps(steps: string[], ingredientSlugs: string[]): string[] {
  const present = new Set(ingredientSlugs);
  const kept = steps
    .map((step) => step.trim())
    .filter(Boolean)
    .filter((step) =>
      STEP_MENTIONS.every(
        (rule) => !rule.pattern.test(step) || rule.slugs.some((slug) => present.has(slug)),
      ),
    );
  const fillers = [
    "Подготовить продукты из списка и взвесить их.",
    "Собрать или приготовить простым способом: варка, тушение, запекание или сковорода.",
    "Подать сразу. Дополнительные соусы не добавлять.",
  ];
  const out = [...kept];
  for (const filler of fillers) {
    if (out.length >= 3) break;
    if (!out.includes(filler)) out.push(filler);
  }
  return out;
}

function ruNoun(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Строка для тренера. Клиенту внутренние id не показываются. */
export function formatTrainerVarietyLine(days: ConstructorDay[]): string {
  const uniqueDays = new Set(
    days.map((day) =>
      [...day.items]
        .sort((a, b) => a.slot.localeCompare(b.slot))
        .map((item) => `${item.slot}:${item.recipe_id}`)
        .join("|"),
    ),
  ).size;
  const ids = days.flatMap((day) => day.items.map((item) => item.recipe_id));
  const uniqueDishes = new Set(ids).size;
  const repeats = ids.length - uniqueDishes;
  const daysLabel = ruNoun(uniqueDays, "разный день", "разных дня", "разных дней");
  const dishesLabel = ruNoun(
    uniqueDishes,
    "уникальное блюдо",
    "уникальных блюда",
    "уникальных блюд",
  );
  const repeatLabel = repeats === 0 ? "повторов нет" : `повторов: ${repeats}`;
  return `${daysLabel} · ${dishesLabel} · ${repeatLabel}`;
}
