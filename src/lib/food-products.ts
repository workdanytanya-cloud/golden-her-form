/**
 * Словарь продуктов для свободного ввода: нормализация синонимов,
 * проверка правописания (Левенштейн) и матчинг с блюдами.
 */

export type FoodCanonical = {
  /** Канонический ключ (часто совпадает с тегом блюда). */
  key: string;
  /** Как показывать человеку. */
  label: string;
  /** Формы и синонимы для распознавания / словаря. */
  forms: string[];
};

/** Каталог известных продуктов и групп. */
export const FOOD_CATALOG: FoodCanonical[] = [
  { key: "птица", label: "курица / индейка", forms: ["птица", "курица", "курицы", "курицу", "куриный", "куриное", "индейка", "индейки", "индейку", "цыпленок", "цыплёнок"] },
  { key: "рыба", label: "рыба", forms: ["рыба", "рыбы", "рыбу", "рыбный", "лосось", "лосося", "треска", "трески", "семга", "сёмга", "форель", "хек", "тунец", "скумбрия"] },
  { key: "морепродукты", label: "морепродукты", forms: ["морепродукты", "морепродукт", "креветки", "креветка", "кальмар", "кальмары", "мидии", "устрицы", "краб", "крабы"] },
  { key: "говядина", label: "говядина", forms: ["говядина", "говядины", "говядину", "телятина", "телятины", "говяжий"] },
  { key: "свинина", label: "свинина", forms: ["свинина", "свинины", "свинину", "свиной"] },
  { key: "яйца", label: "яйца", forms: ["яйца", "яйцо", "яиц", "яичный", "яичница", "омлет"] },
  { key: "молочка", label: "молочные продукты", forms: ["молочка", "молоко", "молока", "молочный", "молочные", "творог", "творога", "творожок", "кефир", "йогурт", "йогурта", "сметана", "сыр", "сыра", "ряженка", "простокваша", "сливки", "масло сливочное", "лактоза"] },
  { key: "гречка", label: "гречка", forms: ["гречка", "гречки", "гречневая", "гречневая крупа"] },
  { key: "рис", label: "рис", forms: ["рис", "риса", "рисовый", "рисовая"] },
  { key: "овсянка", label: "овсянка", forms: ["овсянка", "овёс", "овес", "овсяная", "геркулес"] },
  { key: "цельнозерновое", label: "паста / цельнозерновое", forms: ["цельнозерновое", "паста", "макароны", "макарон", "спагетти", "хлеб", "хлебцы", "пшеница", "пшеничный", "глютен", "клейковина", "манка", "манная"] },
  { key: "киноа", label: "киноа", forms: ["киноа", "quinoa"] },
  { key: "овощи", label: "овощи", forms: ["овощи", "овощей", "овощ", "огурец", "огурцы", "помидор", "помидоры", "томат", "томаты", "кабачок", "кабачки", "баклажан", "баклажаны", "перец", "брокколи", "цветная капуста", "капуста", "морковь", "свёкла", "свекла", "лук", "чеснок", "шпинат", "салат", "зелень", "укроп", "петрушка", "тыква", "картофель", "картошка"] },
  { key: "фрукты", label: "фрукты", forms: ["фрукты", "фруктов", "фрукт", "яблоко", "яблоки", "груша", "груши", "банан", "бананы", "апельсин", "апельсины", "киви", "персик", "персики", "слива", "сливы", "абрикос", "манго"] },
  { key: "ягоды", label: "ягоды", forms: ["ягоды", "ягод", "ягода", "клубника", "малина", "черника", "голубика", "смородина", "ежевика", "вишня", "черешня"] },
  { key: "орехи", label: "орехи", forms: ["орехи", "орех", "орехов", "миндаль", "грецкий орех", "кэшью", "кешью", "фундук", "арахис", "семена", "семечки", "кунжут", "чиа", "лён", "лен"] },
  { key: "бобовые", label: "бобовые", forms: ["бобовые", "бобы", "нут", "чечевица", "фасоль", "горох", "соя", "тофу", "эдмаме"] },
  { key: "грибы", label: "грибы", forms: ["грибы", "гриб", "шампиньоны", "вешенки"] },
  { key: "мёд", label: "мёд", forms: ["мёд", "мед", "мёда", "меда"] },
  { key: "сахар", label: "сахар", forms: ["сахар", "сахара", "сладости", "конфеты", "шоколад"] },
  { key: "кофе", label: "кофе", forms: ["кофе"] },
  { key: "чай", label: "чай", forms: ["чай", "чая"] },
];

const FORM_TO_KEY = new Map<string, string>();
const DICTIONARY = new Set<string>();

for (const item of FOOD_CATALOG) {
  DICTIONARY.add(item.key);
  DICTIONARY.add(item.label);
  for (const part of item.label.split(/[\/,]/).map((s) => s.trim()).filter(Boolean)) {
    DICTIONARY.add(part.toLowerCase());
  }
  for (const f of item.forms) {
    const low = f.toLowerCase();
    DICTIONARY.add(low);
    FORM_TO_KEY.set(low, item.key);
  }
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Разбить свободный ввод на токены (запятая, точка с запятой, перевод строки). */
export function parseFoodList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const t = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export type SpellIssue = {
  original: string;
  suggestion: string;
  distance: number;
};

/** Порог опечатки: до 2 символов, но не больше ~40% длины. */
function maxDistanceFor(word: string): number {
  if (word.length <= 3) return 1;
  if (word.length <= 6) return 2;
  return Math.min(3, Math.ceil(word.length * 0.35));
}

export function suggestSpelling(token: string): SpellIssue | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (DICTIONARY.has(t) || FORM_TO_KEY.has(t)) return null;

  // Уже узнаваемый фрагмент словаря (подстрока длинной формы)
  for (const form of DICTIONARY) {
    if (form.length >= 4 && (t.includes(form) || form.includes(t))) return null;
  }

  let best: SpellIssue | null = null;
  const maxDist = maxDistanceFor(t);
  for (const word of DICTIONARY) {
    if (Math.abs(word.length - t.length) > maxDist) continue;
    const d = levenshtein(t, word);
    if (d === 0 || d > maxDist) continue;
    if (!best || d < best.distance || (d === best.distance && word.length < best.suggestion.length)) {
      best = { original: token, suggestion: word, distance: d };
    }
  }
  return best;
}

export function checkFoodSpelling(tokens: string[]): SpellIssue[] {
  const issues: SpellIssue[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const issue = suggestSpelling(t);
    if (!issue || seen.has(issue.original)) continue;
    seen.add(issue.original);
    issues.push(issue);
  }
  return issues;
}

/**
 * Нормализует список: синонимы → канонические ключи,
 * неизвестные, но осмысленные слова оставляем как есть (для матча по ингредиентам).
 */
export function normalizeFoodTerms(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tokens) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const key = FORM_TO_KEY.get(t);
    if (key) {
      out.add(key);
      continue;
    }
    // Попытка найти канон по вхождению формы в фразу
    let mapped = false;
    for (const [form, k] of FORM_TO_KEY) {
      if (form.length >= 4 && t.includes(form)) {
        out.add(k);
        mapped = true;
        break;
      }
    }
    if (!mapped) out.add(t);
  }
  return Array.from(out);
}

export function formatFoodList(items: string[] | null | undefined): string {
  if (!items?.length) return "";
  return items
    .map((p) => {
      const hit = FOOD_CATALOG.find((c) => c.key === p);
      return hit?.label ?? p;
    })
    .join(", ");
}

export function applySpellFixes(text: string, issues: SpellIssue[]): string {
  let next = text;
  for (const issue of issues) {
    const re = new RegExp(issue.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    next = next.replace(re, issue.suggestion);
  }
  return next;
}

/** Текст блюда для поиска продуктов (название, теги, ингредиенты). */
export function dishSearchText(dish: {
  name: string;
  tags: string[];
  ingredients?: Array<{ raw: string }>;
}): string {
  const parts = [dish.name, ...dish.tags];
  for (const ing of dish.ingredients ?? []) parts.push(ing.raw);
  return parts.join(" ").toLowerCase();
}

/**
 * Совпадает ли блюдо с продуктом (тег / канон / подстрока в названии и составе).
 */
export function dishMatchesProduct(
  dish: { name: string; tags: string[]; ingredients?: Array<{ raw: string }> },
  product: string,
): boolean {
  const p = product.trim().toLowerCase();
  if (!p) return false;
  const key = FORM_TO_KEY.get(p) ?? (FOOD_CATALOG.some((c) => c.key === p) ? p : null);
  if (key && dish.tags.some((t) => t.toLowerCase() === key)) return true;
  if (dish.tags.some((t) => t.toLowerCase() === p)) return true;

  const hay = dishSearchText(dish);
  if (hay.includes(p)) return true;

  // Синонимы канона: «птица» ловит «курица» в ингредиентах
  if (key) {
    const entry = FOOD_CATALOG.find((c) => c.key === key);
    if (entry) {
      for (const form of entry.forms) {
        if (form.length >= 3 && hay.includes(form)) return true;
      }
    }
  }
  return false;
}

export function mergeUnique(...lists: (string[] | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const x of list ?? []) {
      const t = x.trim().toLowerCase();
      if (t) out.add(t);
    }
  }
  return Array.from(out);
}
