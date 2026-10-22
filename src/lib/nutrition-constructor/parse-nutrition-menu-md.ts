import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import { d, withinTolerance, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import type {
  ConstructorDay,
  FoodProduct,
  MealPlanItem,
  Recipe,
} from "@/lib/nutrition-constructor/types";

export type ParsedMenuIngredient = {
  name: string;
  grams: number;
};

export type ParsedMenuMeal = {
  slotLabel: string;
  slot: PlanSlot;
  name: string;
  ingredients: ParsedMenuIngredient[];
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  instructions: string;
  active_prep_minutes: number | null;
};

export type ParsedMenuDay = {
  day_index: number;
  meals: ParsedMenuMeal[];
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type ParsedNutritionMenuMarkdown = {
  intro: string[];
  dayNote: string | null;
  days: ParsedMenuDay[];
  prepPlan: string[];
  storage: string[];
  shoppingList: Array<{ name: string; amountText: string }>;
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  notes: string;
};

const SLOT_MAP: Record<string, PlanSlot> = {
  завтрак: "main1",
  обед: "main2",
  ужин: "main3",
};

/** Универсальные алиасы RU → slug каталога. Без клиентских UUID. */
export const MENU_INGREDIENT_ALIASES: Record<string, string> = {
  "овсяные хлопья": "oats-dry",
  овсянка: "oats-dry",
  яйцо: "egg-whole",
  яйца: "egg-whole",
  "яйца без скорлупы": "egg-whole",
  "пастеризованный яичный белок": "egg-white-raw",
  "готовый пастеризованный яичный белок": "egg-white-raw",
  "яичный белок": "egg-white-raw",
  груша: "pear-raw",
  "несолёный грецкий орех": "walnut",
  "грецкий орех": "walnut",
  "оливковое масло": "olive-oil",
  "оливковое масло для формы": "olive-oil",
  "филе индейки": "turkey-breast-raw",
  индейка: "turkey-breast-raw",
  рис: "rice-white-dry",
  морковь: "carrot",
  кабачок: "zucchini",
  треска: "cod-raw",
  картофель: "potato-raw",
  "куриная грудка": "chicken-breast-raw",
  курица: "chicken-breast-raw",
  "паста из твёрдых сортов": "pasta-durum-dry",
  паста: "pasta-durum-dry",
  тыква: "pumpkin-raw",
  гречка: "buckwheat-dry",
  "нежирная говядина": "beef-lean-raw",
  говядина: "beef-lean-raw",
  свёкла: "beet-raw",
  свекла: "beet-raw",
  минтай: "pollock-raw",
};

const PRODUCT_DISPLAY_OVERRIDES: Record<string, string> = {
  "egg-white-raw": "Готовый пастеризованный яичный белок",
};

function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ё/g, "е");
}

function parseRuNumber(raw: string): number {
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Не удалось разобрать число: ${raw}`);
  return n;
}

function parseGrams(raw: string): number {
  const match = raw.match(/([\d\s]+(?:[.,]\d+)?)/);
  if (!match) throw new Error(`Не удалось разобрать граммы: ${raw}`);
  return parseRuNumber(match[1]!);
}

const NORMALIZED_INGREDIENT_ALIASES = new Map(
  Object.entries(MENU_INGREDIENT_ALIASES).map(([alias, slug]) => [normalizeName(alias), slug]),
);

export function resolveMenuIngredientSlug(name: string): string {
  const slug = NORMALIZED_INGREDIENT_ALIASES.get(normalizeName(name));
  if (!slug) throw new Error(`Неизвестный ингредиент меню: ${name}`);
  return slug;
}

function splitSections(markdown: string): {
  body: string;
  prep: string;
  shopping: string;
  footer: string;
} {
  const prepIdx = markdown.search(/^##\s+Две основные заготовки\s*$/m);
  const shopIdx = markdown.search(/^##\s+Список покупок\s*$/m);
  const footerIdx = markdown.search(/^##\s+Итог проверки\s*$/m);
  if (prepIdx < 0 || shopIdx < 0) {
    throw new Error("В markdown нет секций «Две основные заготовки» / «Список покупок»");
  }
  const body = markdown.slice(0, prepIdx).trim();
  const prep = markdown.slice(prepIdx, shopIdx).trim();
  const shoppingEnd = footerIdx > shopIdx ? footerIdx : markdown.length;
  const shopping = markdown.slice(shopIdx, shoppingEnd).trim();
  const footer = footerIdx > 0 ? markdown.slice(footerIdx).trim() : "";
  return { body, prep, shopping, footer };
}

function parseMealBlock(block: string): ParsedMenuMeal {
  const header = block.match(
    /^(Завтрак|Обед|Ужин)\s*[—–-]\s*(.+?):\s*$/m,
  );
  if (!header) throw new Error(`Не найден заголовок приёма пищи:\n${block.slice(0, 120)}`);
  const slotLabel = header[1]!;
  const slot = SLOT_MAP[normalizeName(slotLabel)];
  if (!slot) throw new Error(`Неизвестный слот: ${slotLabel}`);
  const name = header[2]!.trim().replace(/\.$/, "");

  const ingredients: ParsedMenuIngredient[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(.+?)\s*[—–-]\s*(.+?)\s*;?\s*$/);
    if (!m) continue;
    ingredients.push({ name: m[1]!.trim(), grams: parseGrams(m[2]!) });
  }
  if (ingredients.length === 0) throw new Error(`Нет ингредиентов у блюда «${name}»`);

  const kbju = block.match(
    /КБЖУ:\s*\*\*\s*([\d\s]+(?:[.,]\d+)?)\s*ккал\s*\/\s*Б\s*([\d\s]+(?:[.,]\d+)?)\s*\/\s*Ж\s*([\d\s]+(?:[.,]\d+)?)\s*\/\s*У\s*([\d\s]+(?:[.,]\d+)?)\s*\*\*/i,
  );
  if (!kbju) throw new Error(`Нет КБЖУ у блюда «${name}»`);

  const afterKbju = block.slice(block.indexOf(kbju[0]!) + kbju[0]!.length).trim();
  const instructionMatch = afterKbju.match(
    /^(.+?)\s*Активное время:\s*(\d+)\s*минут/is,
  );
  const instructions = (instructionMatch?.[1] ?? afterKbju)
    .replace(/\\\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  const active = instructionMatch ? Number(instructionMatch[2]) : null;

  return {
    slotLabel,
    slot,
    name,
    ingredients,
    kcal: parseRuNumber(kbju[1]!),
    protein_g: parseRuNumber(kbju[2]!),
    fat_g: parseRuNumber(kbju[3]!),
    carbs_g: parseRuNumber(kbju[4]!),
    instructions: instructions || "Приготовить по описанию.",
    active_prep_minutes: Number.isFinite(active) ? active : null,
  };
}

function parseDaySection(section: string, dayNumber: number): ParsedMenuDay {
  const mealStarts = [...section.matchAll(/^(Завтрак|Обед|Ужин)\s*[—–-]/gm)];
  if (mealStarts.length !== 3) {
    throw new Error(`День ${dayNumber}: ожидалось 3 приёма, найдено ${mealStarts.length}`);
  }
  const meals: ParsedMenuMeal[] = [];
  for (let i = 0; i < mealStarts.length; i++) {
    const start = mealStarts[i]!.index!;
    const end = i + 1 < mealStarts.length ? mealStarts[i + 1]!.index! : section.length;
    const chunk = section.slice(start, end);
    const beforeTotals = chunk.split(/^Итого:/m)[0] ?? chunk;
    meals.push(parseMealBlock(beforeTotals));
  }
  const totals = section.match(
    /Итого:\s*\*\*\s*([\d\s]+(?:[.,]\d+)?)\s*ккал\s*\/\s*Б\s*([\d\s]+(?:[.,]\d+)?)\s*\/\s*Ж\s*([\d\s]+(?:[.,]\d+)?)\s*\/\s*У\s*([\d\s]+(?:[.,]\d+)?)\s*\*\*/i,
  );
  if (!totals) throw new Error(`День ${dayNumber}: нет строки «Итого»`);
  return {
    day_index: dayNumber - 1,
    meals,
    kcal: parseRuNumber(totals[1]!),
    protein_g: parseRuNumber(totals[2]!),
    fat_g: parseRuNumber(totals[3]!),
    carbs_g: parseRuNumber(totals[4]!),
  };
}

function parsePrepAndStorage(prepSection: string): { prepPlan: string[]; storage: string[] } {
  const lines = prepSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("##"));
  const prepPlan: string[] = [];
  const storage: string[] = [];
  let mode: "prep" | "storage" = "prep";
  for (const line of lines) {
    if (/^готовые блюда хранить/i.test(line) || /^рыбу предпочтительно/i.test(line)) {
      mode = "storage";
    }
    if (mode === "prep") prepPlan.push(line.replace(/^-\s*/, ""));
    else storage.push(line.replace(/^-\s*/, ""));
  }
  return { prepPlan, storage };
}

function parseShopping(shoppingSection: string): Array<{ name: string; amountText: string }> {
  const items: Array<{ name: string; amountText: string }> = [];
  for (const line of shoppingSection.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(.+?)\s*[—–-]\s*(.+?)\s*;?\s*$/);
    if (!m) continue;
    items.push({ name: m[1]!.trim(), amountText: m[2]!.trim().replace(/;?\s*$/, "") });
  }
  if (items.length === 0) throw new Error("Список покупок пуст");
  return items;
}

function extractDayNote(introLines: string[]): string | null {
  const note = introLines.find((l) => /натрий не рассчитан/i.test(l));
  if (!note) return null;
  return note
    .replace(/^>\s*/, "")
    .split(".")[0]!
    .trim();
}

export function parseNutritionMenuMarkdown(markdown: string): ParsedNutritionMenuMarkdown {
  const { body, prep, shopping } = splitSections(markdown);
  const dayMatches = [...body.matchAll(/^##\s+День\s+(\d+)\s*$/gm)];
  if (dayMatches.length !== 7) {
    throw new Error(`Ожидалось 7 дней, найдено ${dayMatches.length}`);
  }
  const intro = body
    .slice(0, dayMatches[0]!.index!)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const days: ParsedMenuDay[] = [];
  for (let i = 0; i < dayMatches.length; i++) {
    const start = dayMatches[i]!.index!;
    const end = i + 1 < dayMatches.length ? dayMatches[i + 1]!.index! : body.length;
    const dayNumber = Number(dayMatches[i]![1]);
    days.push(parseDaySection(body.slice(start, end), dayNumber));
  }
  const { prepPlan, storage } = parsePrepAndStorage(prep);
  const shoppingList = parseShopping(shopping);
  const targets = {
    kcal: 1396,
    protein_g: 116.6,
    fat_g: 58.3,
    carbs_g: 101.2,
  };
  const dayNote = extractDayNote(intro);
  const notes = [
    ...intro.filter((l) => l.startsWith(">") || /натрий|калиев|последний приём/i.test(l)),
    "",
    "## План заготовок",
    ...prepPlan.map((l) => (l.startsWith("Первая") || l.startsWith("Вторая") ? l : `- ${l}`)),
    "",
    "## Хранение",
    ...storage,
    "",
    "## Список покупок",
    ...shoppingList.map((item) => `- ${item.name} — ${item.amountText}`),
  ]
    .join("\n")
    .replace(/^>\s*/gm, "")
    .trim();

  return { intro, dayNote, days, prepPlan, storage, shoppingList, targets, notes };
}

export function buildConstructorDaysFromParsedMenu(
  parsed: ParsedNutritionMenuMarkdown,
  productsBySlug: Map<string, FoodProduct>,
): ConstructorDay[] {
  return parsed.days.map((day) => {
    const items: MealPlanItem[] = day.meals.map((meal) => {
      const ingredients = meal.ingredients.map((ing, idx) => {
        const slug = resolveMenuIngredientSlug(ing.name);
        const product = productsBySlug.get(slug);
        if (!product) throw new Error(`Продукт не найден в каталоге: ${slug} (${ing.name})`);
        const line = buildIngredientLine(product, ing.grams, idx);
        const override = PRODUCT_DISPLAY_OVERRIDES[slug];
        return override ? { ...line, product_name: override } : line;
      });
      const recipe: Recipe = {
        id: `manual-${meal.slot}`,
        slug: `manual-${meal.slot}`,
        name: meal.name,
        meal_type: "main",
        steps: [meal.instructions],
        prep_time_min: meal.active_prep_minutes,
        requires_cooking: true,
        is_active: true,
        weighing_note: null,
        is_nutrient_dense: true,
        contains_protein_source: true,
        contains_fruit_or_vegetable: true,
        is_treat: false,
        allowed_schedule_modes: [
          "three_main_two_snacks",
          "three_mains_only",
          "one_main_three_snacks",
          "two_main_two_snacks",
        ],
        snack_action: null,
        active_prep_minutes: meal.active_prep_minutes,
      };
      return buildMealPlanItem({ slot: meal.slot, recipe, ingredients });
    });
    const totals = items.reduce(
      (acc, item) => ({
        kcal: acc.kcal.plus(d(item.kcal)),
        protein_g: acc.protein_g.plus(d(item.protein_g)),
        fat_g: acc.fat_g.plus(d(item.fat_g)),
        carbs_g: acc.carbs_g.plus(d(item.carbs_g)),
        fiber_g: acc.fiber_g.plus(d(item.fiber_g)),
      }),
      {
        kcal: d(0),
        protein_g: d(0),
        fat_g: d(0),
        carbs_g: d(0),
        fiber_g: d(0),
      } satisfies MacroBreakdown,
    );
    return {
      day_index: day.day_index,
      day_note: parsed.dayNote,
      items,
      kcal: totals.kcal.toFixed(4),
      protein_g: totals.protein_g.toFixed(4),
      fat_g: totals.fat_g.toFixed(4),
      carbs_g: totals.carbs_g.toFixed(4),
      fiber_g: totals.fiber_g.toFixed(4),
      is_valid: true,
    };
  });
}

export function assertDaysWithinTargets(
  days: ConstructorDay[],
  targets: { kcal: number; protein_g: number; fat_g: number; carbs_g: number },
  tolerance = { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 },
): void {
  const target: MacroBreakdown = {
    kcal: d(targets.kcal),
    protein_g: d(targets.protein_g),
    fat_g: d(targets.fat_g),
    carbs_g: d(targets.carbs_g),
    fiber_g: d(0),
  };
  for (const day of days) {
    const actual: MacroBreakdown = {
      kcal: d(day.kcal),
      protein_g: d(day.protein_g),
      fat_g: d(day.fat_g),
      carbs_g: d(day.carbs_g),
      fiber_g: d(day.fiber_g ?? 0),
    };
    if (!withinTolerance(actual, target, tolerance)) {
      throw new Error(
        `День ${day.day_index + 1} вне допуска: ${day.kcal}/${day.protein_g}/${day.fat_g}/${day.carbs_g}`,
      );
    }
  }
}
