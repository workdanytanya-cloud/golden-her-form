import {
  buildIngredientLine,
  comparisonRows,
  dayMacroFromItems,
  recalculateConstructorDay,
  recalculateMealFromProducts,
} from "@/lib/nutrition-constructor/calculator";
import { DEFAULT_TOLERANCE } from "@/lib/nutrition-constructor/config";
import {
  d,
  displayMacro,
  type MacroBreakdown,
  withinTolerance,
} from "@/lib/nutrition-constructor/decimal-math";
import { parseIngredientGrams } from "@/lib/nutrition-constructor/ingredient-normalize";
import {
  AUTOGEN_OIL_PRODUCT_SLUGS,
  FAT_LEVER_SLUGS,
  PROTEIN_MAIN_PRODUCT_SLUGS,
  PROTEIN_SNACK_PRODUCT_SLUGS,
} from "@/lib/nutrition-constructor/recipe-meta";
import { formatMacroDeviationSummary } from "@/lib/nutrition-constructor/validation-messages";
import type { ConstructorDay, FoodProduct, MealPlanItem } from "@/lib/nutrition-constructor/types";

export type GramChangePreview = {
  slot: string;
  productId: string;
  productName: string;
  fromG: number;
  toG: number;
};

export type DeviationProposal = {
  id: string;
  title: string;
  currentSummary: string;
  whatChanges: string[];
  newGrams: GramChangePreview[];
  mealMacros: Array<{
    slot: string;
    recipeName: string;
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  }>;
  dayTotals: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  deviation: ReturnType<typeof comparisonRows>;
  deviationText: string;
  nextDay: ConstructorDay;
};

const CARB_SLUGS = new Set([
  "rice-white-dry",
  "buckwheat-dry",
  "oats-dry",
  "crispbread",
  "lavash",
  "canned-corn",
  "banana",
]);

function productSlug(products: Map<string, FoodProduct>, productId: string): string {
  return products.get(productId)?.slug ?? productId;
}

function remainderSummary(comparison: ReturnType<typeof comparisonRows>): string {
  const bits = comparison
    .filter((row) => Math.abs(row.diff) >= 0.5)
    .map((row) => {
      const sign = row.diff > 0 ? "+" : "−";
      const n = Math.abs(Math.round(row.diff * 10) / 10);
      if (row.label === "Белки") return `${sign}${n} г белка`;
      if (row.label === "Углеводы") return `${sign}${n} г углеводов`;
      if (row.label === "Жиры") return `${sign}${n} г жиров`;
      return `${sign}${n} ккал`;
    });
  return bits.length ? `Сейчас: ${bits.join(", ")}` : "Сейчас: в допуске";
}

function applyGramMap(
  day: ConstructorDay,
  products: Map<string, FoodProduct>,
  changes: Map<string, number>,
): ConstructorDay {
  const items = day.items.map((item) => {
    const newIngs = item.ingredients.map((ing) => {
      const key = `${item.slot}:${ing.product_id}`;
      const nextG = changes.get(key);
      if (nextG == null) return ing;
      const product = products.get(ing.product_id);
      if (!product) return { ...ing, grams: String(nextG) };
      return buildIngredientLine(product, nextG, ing.sort_order);
    });
    return recalculateMealFromProducts({ ...item, ingredients: newIngs }, products);
  });
  return recalculateConstructorDay({ ...day, items }, products);
}

function findLine(
  day: ConstructorDay,
  products: Map<string, FoodProduct>,
  pred: (slug: string, item: MealPlanItem) => boolean,
) {
  for (const item of day.items) {
    for (const ing of item.ingredients) {
      const slug = productSlug(products, ing.product_id);
      if (pred(slug, item)) {
        return { item, ing, slug, grams: parseIngredientGrams(ing.grams) };
      }
    }
  }
  return null;
}

function proposalFromChanges(params: {
  id: string;
  title: string;
  whatChanges: string[];
  day: ConstructorDay;
  nextDay: ConstructorDay;
  targets: MacroBreakdown;
  products: Map<string, FoodProduct>;
}): DeviationProposal {
  const changes: GramChangePreview[] = [];
  for (const item of params.nextDay.items) {
    const prev = params.day.items.find((x) => x.slot === item.slot);
    for (const ing of item.ingredients) {
      const old = prev?.ingredients.find((x) => x.product_id === ing.product_id);
      const fromG = old ? parseIngredientGrams(old.grams) : 0;
      const toG = parseIngredientGrams(ing.grams);
      if (Math.abs(fromG - toG) >= 0.5) {
        changes.push({
          slot: item.slot,
          productId: ing.product_id,
          productName: ing.product_name,
          fromG,
          toG,
        });
      }
    }
  }
  const actual = dayMacroFromItems(params.nextDay.items);
  const deviation = comparisonRows(params.targets, actual);
  return {
    id: params.id,
    title: params.title,
    currentSummary: remainderSummary(comparisonRows(params.targets, dayMacroFromItems(params.day.items))),
    whatChanges: params.whatChanges,
    newGrams: changes,
    mealMacros: params.nextDay.items.map((item) => {
      const m = displayMacro({
        kcal: d(item.kcal),
        protein_g: d(item.protein_g),
        fat_g: d(item.fat_g),
        carbs_g: d(item.carbs_g),
        fiber_g: d(item.fiber_g),
      });
      return {
        slot: item.slot,
        recipeName: item.recipe_name,
        kcal: m.kcal,
        protein_g: m.protein_g,
        fat_g: m.fat_g,
        carbs_g: m.carbs_g,
      };
    }),
    dayTotals: displayMacro(actual),
    deviation,
    deviationText: formatMacroDeviationSummary(deviation, DEFAULT_TOLERANCE) || "в строгом допуске",
    nextDay: params.nextDay,
  };
}

function scoreDay(day: ConstructorDay, targets: MacroBreakdown): number {
  const actual = dayMacroFromItems(day.items);
  return (
    Math.abs(actual.kcal.toNumber() - targets.kcal.toNumber()) +
    Math.abs(actual.protein_g.toNumber() - targets.protein_g.toNumber()) * 4 +
    Math.abs(actual.fat_g.toNumber() - targets.fat_g.toNumber()) * 4 +
    Math.abs(actual.carbs_g.toNumber() - targets.carbs_g.toNumber()) * 4
  );
}

export function proposeDayCorrections(params: {
  day: ConstructorDay;
  targets: MacroBreakdown;
  products: Map<string, FoodProduct>;
  limit?: number;
}): DeviationProposal[] {
  const { day, targets, products } = params;
  const limit = params.limit ?? 5;
  const current = comparisonRows(targets, dayMacroFromItems(day.items));
  const proteinDiff = current.find((r) => r.label === "Белки")?.diff ?? 0;
  const carbsDiff = current.find((r) => r.label === "Углеводы")?.diff ?? 0;
  const fatDiff = current.find((r) => r.label === "Жиры")?.diff ?? 0;
  const variants: Array<{
    id: string;
    title: string;
    what: string[];
    changes: Map<string, number>;
  }> = [];

  const carbLine = findLine(day, products, (slug) => CARB_SLUGS.has(slug));
  const proteinLine = findLine(
    day,
    products,
    (slug) => PROTEIN_MAIN_PRODUCT_SLUGS.has(slug) || PROTEIN_SNACK_PRODUCT_SLUGS.has(slug),
  );
  const oilLine = findLine(day, products, (slug) => AUTOGEN_OIL_PRODUCT_SLUGS.has(slug));
  const fatLine = findLine(day, products, (slug) => FAT_LEVER_SLUGS.has(slug));

  if (proteinDiff < -1 && carbsDiff > 1 && carbLine && proteinLine) {
    const changes = new Map<string, number>();
    changes.set(`${carbLine.item.slot}:${carbLine.ing.product_id}`, Math.max(1, carbLine.grams - 20));
    changes.set(
      `${proteinLine.item.slot}:${proteinLine.ing.product_id}`,
      proteinLine.grams + 25,
    );
    variants.push({
      id: "cut-carbs-add-protein",
      title: "Уменьшить углеводы и добавить постный белок",
      what: [
        `Уменьшить ${carbLine.ing.product_name} на 20 г`,
        `Увеличить ${proteinLine.ing.product_name} на 25 г`,
        "Пересчитать весь день",
      ],
      changes,
    });
  }

  if (proteinDiff < -1 && proteinLine) {
    const changes = new Map<string, number>();
    changes.set(
      `${proteinLine.item.slot}:${proteinLine.ing.product_id}`,
      proteinLine.grams + 20,
    );
    variants.push({
      id: "add-protein",
      title: "Увеличить постный белок",
      what: [`Увеличить ${proteinLine.ing.product_name} на 20 г`, "Пересчитать весь день"],
      changes,
    });
  }

  if (carbsDiff > 1 && carbLine) {
    const changes = new Map<string, number>();
    changes.set(`${carbLine.item.slot}:${carbLine.ing.product_id}`, Math.max(1, carbLine.grams - 15));
    variants.push({
      id: "cut-carbs",
      title: "Уменьшить крупу / хлебцы / кукурузу",
      what: [`Уменьшить ${carbLine.ing.product_name} на 15 г`, "Пересчитать весь день"],
      changes,
    });
  }

  if (fatDiff > 1 && (oilLine || fatLine)) {
    const line = oilLine ?? fatLine!;
    const delta = AUTOGEN_OIL_PRODUCT_SLUGS.has(line.slug) ? 2 : 8;
    const changes = new Map<string, number>();
    changes.set(`${line.item.slot}:${line.ing.product_id}`, Math.max(1, line.grams - delta));
    variants.push({
      id: "cut-fat",
      title: "Скорректировать масло / орехи / авокадо / сыр",
      what: [`Уменьшить ${line.ing.product_name} на ${delta} г`, "Пересчитать весь день"],
      changes,
    });
  }

  if (fatDiff < -1 && (oilLine || fatLine)) {
    const line = oilLine ?? fatLine!;
    const delta = AUTOGEN_OIL_PRODUCT_SLUGS.has(line.slug) ? 2 : 8;
    const changes = new Map<string, number>();
    changes.set(`${line.item.slot}:${line.ing.product_id}`, line.grams + delta);
    variants.push({
      id: "add-fat",
      title: "Добавить жир (масло / орехи / авокадо / сыр)",
      what: [`Увеличить ${line.ing.product_name} на ${delta} г`, "Пересчитать весь день"],
      changes,
    });
  }

  if (proteinDiff < -1 && carbsDiff > 1 && carbLine && proteinLine && (oilLine || fatLine)) {
    const fat = oilLine ?? fatLine!;
    const changes = new Map<string, number>();
    changes.set(`${carbLine.item.slot}:${carbLine.ing.product_id}`, Math.max(1, carbLine.grams - 15));
    changes.set(
      `${proteinLine.item.slot}:${proteinLine.ing.product_id}`,
      proteinLine.grams + 20,
    );
    const fatDelta = AUTOGEN_OIL_PRODUCT_SLUGS.has(fat.slug) ? 1 : 5;
    changes.set(`${fat.item.slot}:${fat.ing.product_id}`, Math.max(1, fat.grams - fatDelta));
    variants.push({
      id: "linked-rebalance",
      title: "Связанная корректировка дня",
      what: [
        `Уменьшить ${carbLine.ing.product_name}`,
        `Увеличить ${proteinLine.ing.product_name}`,
        `Подправить ${fat.ing.product_name}`,
        "Пересчитать весь день",
      ],
      changes,
    });
  }

  const scored = variants
    .map((variant) => {
      const nextDay = applyGramMap(day, products, variant.changes);
      return proposalFromChanges({
        id: variant.id,
        title: variant.title,
        whatChanges: variant.what,
        day,
        nextDay,
        targets,
        products,
      });
    })
    .filter((p) => p.newGrams.length > 0)
    .sort((a, b) => scoreDay(a.nextDay, targets) - scoreDay(b.nextDay, targets));

  const unique: DeviationProposal[] = [];
  for (const item of scored) {
    if (unique.some((u) => u.id === item.id)) continue;
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function dayWithinStrictTolerance(day: ConstructorDay, targets: MacroBreakdown): boolean {
  return withinTolerance(dayMacroFromItems(day.items), targets, DEFAULT_TOLERANCE);
}
