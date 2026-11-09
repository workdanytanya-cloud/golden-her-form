import {
  buildIngredientLine,
  buildMealPlanItem,
  dayMacroFromItems,
  recalculateConstructorDay,
  recalculateMealFromProducts,
} from "@/lib/nutrition-constructor/calculator";
import { OIL_GRAM_MAX, type PlanSlot } from "@/lib/nutrition-constructor/config";
import {
  InvalidIngredientGramsError,
  normalizeMealPlanItem,
  parseIngredientGrams,
  prepareConstructorDaysForSave,
  shoppingListFromDays,
} from "@/lib/nutrition-constructor/ingredient-normalize";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { snapshotMacro } from "@/lib/nutrition-constructor/decimal-math";
import {
  suggestSwaps,
  swapMovesBeyondTolerance,
} from "@/lib/nutrition-constructor/ingredient-swap";
import { OIL_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import { verifiedIngredients } from "@/lib/nutrition-constructor/recipe-selection";
import type {
  ConstructorDay,
  FoodProduct,
  IngredientLine,
  MealPlanItem,
  Recipe,
} from "@/lib/nutrition-constructor/types";
import type { TrainerMealKind } from "@/lib/nutrition-constructor/trainer-slots";

export const ZERO_GRAMS_FORBIDDEN_MESSAGE = "Граммовка должна быть больше 0.";
export const ALLERGEN_BLOCKED_MESSAGE = "Нельзя добавить продукт с запрещённым аллергеном.";
export const COOKING_IN_SNACK_MESSAGE =
  "Перекус без приготовления не может содержать ингредиент, требующий приготовления.";
export const SWAP_TOLERANCE_MESSAGE =
  "После замены КБЖУ не укладываются в допуск ±5 ккал и ±1 г. Замена не применена.";
export const SWAP_ROLE_MESSAGE =
  "Этот продукт нельзя поставить вместо выбранного: у них разная роль в блюде или другое состояние (сырое и готовое не смешиваются).";
export const REQUIRED_INGREDIENT_MESSAGE =
  "Обязательный ингредиент нельзя убрать. Замените его на продукт той же роли.";

export class ManualMealEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualMealEditError";
  }
}

function assertPositiveGrams(grams: number): void {
  if (!Number.isFinite(grams) || grams <= 0) {
    throw new ManualMealEditError(ZERO_GRAMS_FORBIDDEN_MESSAGE);
  }
}

export function allowedProductsForManualMeal(params: {
  ctx: OptimizerContext;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): FoodProduct[] {
  return [...params.ctx.products.values()].filter((product) => {
    if (!product.is_active || !product.is_verified) return false;
    if (params.forbiddenIds.has(product.id)) return false;
    if (params.mealKind === "snack" && product.requires_cooking) return false;
    return true;
  });
}

export function eligibleRecipesForManualPick(params: {
  ctx: OptimizerContext;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): Recipe[] {
  const pool = params.mealKind === "main" ? params.ctx.mainRecipes : params.ctx.snackRecipes;
  return pool.filter((recipe) => {
    if (!recipe.is_active) return false;
    if (params.mealKind === "snack" && recipe.requires_cooking) return false;
    const ings = verifiedIngredients(params.ctx, recipe, params.forbiddenIds);
    return ings.length > 0;
  });
}

function applyDayItems(
  day: ConstructorDay,
  items: MealPlanItem[],
  products: Map<string, FoodProduct>,
): ConstructorDay {
  const next: ConstructorDay = { ...day, items };
  return recalculateConstructorDay(next, products);
}

export function addMealToDay(params: {
  day: ConstructorDay;
  item: MealPlanItem;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const existing = params.day.items.find((item) => item.slot === params.item.slot);
  if (existing) {
    throw new ManualMealEditError(`Слот ${params.item.slot} уже занят — используйте замену.`);
  }
  return applyDayItems(params.day, [...params.day.items, params.item], params.products);
}

export function replaceMealInDay(params: {
  day: ConstructorDay;
  item: MealPlanItem;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const items = params.day.items.some((item) => item.slot === params.item.slot)
    ? params.day.items.map((item) => (item.slot === params.item.slot ? params.item : item))
    : [...params.day.items, params.item];
  return applyDayItems(params.day, items, params.products);
}

export function deleteMealFromDay(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  return applyDayItems(
    params.day,
    params.day.items.filter((item) => item.slot !== params.slot),
    params.products,
  );
}

export function setIngredientGrams(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  productId: string;
  grams: number;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  assertPositiveGrams(params.grams);
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    const newIngs = item.ingredients.map((ing) =>
      ing.product_id === params.productId ? { ...ing, grams: String(params.grams) } : ing,
    );
    return recalculateMealFromProducts({ ...item, ingredients: newIngs }, params.products);
  });
  return applyDayItems(params.day, items, params.products);
}

export function addIngredientToMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  product: FoodProduct;
  grams: number;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  assertPositiveGrams(params.grams);
  if (params.forbiddenIds.has(params.product.id)) {
    throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
  }
  if (params.mealKind === "snack" && params.product.requires_cooking) {
    throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
  }
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    const existing = item.ingredients.find((ing) => ing.product_id === params.product.id);
    if (existing) {
      throw new ManualMealEditError("Этот продукт уже есть в приёме — измените граммовку.");
    }
    const line = buildIngredientLine(params.product, params.grams, item.ingredients.length);
    return recalculateMealFromProducts(
      { ...item, ingredients: [...item.ingredients, line] },
      params.products,
    );
  });
  return applyDayItems(params.day, items, params.products);
}

const GENERIC_NAME_STEMS = new Set(["филе", "сырое", "сухой", "сухая", "кожи"]);

function renameDishText(text: string, sourceName: string, replacementName: string): string {
  if (!text) return text;
  if (text.includes(sourceName)) return text.split(sourceName).join(replacementName);
  const stems = sourceName
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zа-яё]/gi, ""))
    .filter((word) => word.length >= 3 && !GENERIC_NAME_STEMS.has(word))
    .map((word) => word.slice(0, 4))
    .sort((a, b) => b.length - a.length);
  for (const stem of stems) {
    const pattern = new RegExp(`${stem}[a-zа-яё]*`, "i");
    const matched = pattern.exec(text);
    if (!matched || matched.index == null) continue;
    const word = matched[0];
    const replacement =
      word[0] === word[0]?.toLowerCase()
        ? replacementName.charAt(0).toLowerCase() + replacementName.slice(1)
        : replacementName;
    return text.slice(0, matched.index) + replacement + text.slice(matched.index + word.length);
  }
  return text;
}

function swapGap(before: MacroSnap, after: MacroSnap): number {
  const over = (value: number, limit: number) => Math.max(0, Math.abs(value) - limit);
  return (
    over(after.kcal - before.kcal, 4.6) +
    over(after.protein_g - before.protein_g, 0.85) +
    over(after.fat_g - before.fat_g, 0.85) +
    over(after.carbs_g - before.carbs_g, 0.85)
  );
}

type MacroSnap = { kcal: number; protein_g: number; fat_g: number; carbs_g: number };

function balanceSwappedMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  replacementId: string;
  before: MacroSnap;
  products: Map<string, FoodProduct>;
}): ConstructorDay | null {
  const item = params.day.items.find((row) => row.slot === params.slot);
  if (!item) return null;
  const adjustable = item.ingredients.filter((line) => line.product_id !== params.replacementId);
  if (adjustable.length === 0) return null;
  const grams = new Map(adjustable.map((line) => [line.product_id, Number(line.grams)]));
  const original = new Map(grams);
  const vectors = new Map(
    adjustable.map((line) => [
      line.product_id,
      {
        k: Number(line.kcal_per_100g) / 100,
        p: Number(line.protein_per_100g) / 100,
        f: Number(line.fat_per_100g) / 100,
        c: Number(line.carbs_per_100g) / 100,
      },
    ]),
  );
  const allowed = (productId: string, next: number) => {
    const start = original.get(productId) ?? next;
    const product = params.products.get(productId);
    if (!Number.isFinite(next) || next > 400) return false;
    if (product && OIL_PRODUCT_SLUGS.has(product.slug)) return next >= 1 && next <= OIL_GRAM_MAX;
    return next >= Math.max(5, start - 30) && next <= Math.min(400, start + 30);
  };
  const applyMoves = (base: MacroSnap, moves: Array<[string, number]>) => {
    const next = { ...base };
    for (const [id, shift] of moves) {
      const vector = vectors.get(id);
      if (!vector || shift === 0) continue;
      next.kcal += shift * vector.k;
      next.protein_g += shift * vector.p;
      next.fat_g += shift * vector.f;
      next.carbs_g += shift * vector.c;
    }
    return next;
  };
  let current: MacroSnap = {
    kcal: Number(params.day.kcal),
    protein_g: Number(params.day.protein_g),
    fat_g: Number(params.day.fat_g),
    carbs_g: Number(params.day.carbs_g),
  };
  const ids = [...vectors.keys()];
  for (let step = 0; step < 6 && swapGap(params.before, current) > 0; step++) {
    const best: {
      current: { moves: Array<[string, number]>; next: MacroSnap; score: number } | null;
    } = {
      current: null,
    };
    const scoreNow = swapGap(params.before, current);
    const consider = (moves: Array<[string, number]>) => {
      if (moves.every(([, shift]) => shift === 0)) return;
      for (const [id, shift] of moves) {
        if (!allowed(id, Math.round((grams.get(id) ?? 0) + shift))) return;
      }
      const next = applyMoves(current, moves);
      const score = swapGap(params.before, next);
      if (!best.current || score < best.current.score) best.current = { moves, next, score };
    };
    for (const id of ids) {
      for (let move = -30; move <= 30; move++) consider([[id, move]]);
    }
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const a = ids[left]!;
        const b = ids[right]!;
        for (let moveA = -30; moveA <= 30; moveA += 1) {
          for (let moveB = -30; moveB <= 30; moveB += 1)
            consider([
              [a, moveA],
              [b, moveB],
            ]);
        }
      }
    }
    const chosen = best.current;
    if (!chosen || chosen.score >= scoreNow) break;
    for (const [id, shift] of chosen.moves) grams.set(id, Math.round((grams.get(id) ?? 0) + shift));
    current = chosen.next;
  }
  if (swapGap(params.before, current) > 0) return null;
  const items = params.day.items.map((row) => {
    if (row.slot !== params.slot) return row;
    const ingredients = row.ingredients.map((line) => {
      const nextGrams = grams.get(line.product_id);
      if (nextGrams == null || Math.abs(nextGrams - Number(line.grams)) < 0.5) return line;
      const product = params.products.get(line.product_id);
      return product ? buildIngredientLine(product, nextGrams, line.sort_order) : line;
    });
    return recalculateMealFromProducts({ ...row, ingredients }, params.products);
  });
  return applyDayItems(params.day, items, params.products);
}

export function replaceIngredientInMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  productId: string;
  replacement: FoodProduct;
  forbiddenIds: Set<string>;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  if (params.forbiddenIds.has(params.replacement.id)) {
    throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
  }
  if (!params.replacement.is_active || !params.replacement.is_verified) {
    throw new ManualMealEditError("Непроверенный продукт нельзя подставлять в замену.");
  }
  const source = params.products.get(params.productId);
  if (!source) throw new ManualMealEditError("Исходный продукт не найден в каталоге.");
  const item = params.day.items.find((row) => row.slot === params.slot);
  const line = item?.ingredients.find((ing) => ing.product_id === params.productId);
  if (!item || !line) throw new ManualMealEditError("Ингредиент в этом приёме не найден.");
  const suggestions = suggestSwaps(
    {
      id: source.id,
      name: source.name,
      kcal_per_100g: Number(source.kcal_per_100g),
      protein_per_100g: Number(source.protein_per_100g),
      fat_per_100g: Number(source.fat_per_100g),
      carbs_per_100g: Number(source.carbs_per_100g),
      category: source.category,
      state: source.state,
      verified: source.is_verified,
    },
    Number(line.grams),
    [
      {
        id: params.replacement.id,
        name: params.replacement.name,
        kcal_per_100g: Number(params.replacement.kcal_per_100g),
        protein_per_100g: Number(params.replacement.protein_per_100g),
        fat_per_100g: Number(params.replacement.fat_per_100g),
        carbs_per_100g: Number(params.replacement.carbs_per_100g),
        category: params.replacement.category,
        state: params.replacement.state,
        verified: params.replacement.is_verified,
        autogen: params.replacement.is_active_for_autogeneration !== false,
      },
    ],
    1,
  );
  const suggestion = suggestions[0];
  if (!suggestion) throw new ManualMealEditError(SWAP_ROLE_MESSAGE);
  const before = {
    kcal: Number(params.day.kcal),
    protein_g: Number(params.day.protein_g),
    fat_g: Number(params.day.fat_g),
    carbs_g: Number(params.day.carbs_g),
  };
  const items = params.day.items.map((row) => {
    if (row.slot !== params.slot) return row;
    const ingredients = row.ingredients.map((ing) =>
      ing.product_id === params.productId
        ? buildIngredientLine(params.replacement, suggestion.grams, ing.sort_order)
        : ing,
    );
    const rename = (text: string) => renameDishText(text, source.name, params.replacement.name);
    return recalculateMealFromProducts(
      {
        ...row,
        recipe_name: rename(row.recipe_name ?? ""),
        steps: (row.steps ?? []).map(rename),
        ingredients,
      },
      params.products,
    );
  });
  let next = applyDayItems(params.day, items, params.products);
  const afterOf = (day: ConstructorDay): MacroSnap => ({
    kcal: Number(day.kcal),
    protein_g: Number(day.protein_g),
    fat_g: Number(day.fat_g),
    carbs_g: Number(day.carbs_g),
  });
  if (swapMovesBeyondTolerance(before, afterOf(next))) {
    const balanced = balanceSwappedMeal({
      day: next,
      slot: params.slot,
      replacementId: params.replacement.id,
      before,
      products: params.products,
    });
    if (!balanced || swapMovesBeyondTolerance(before, afterOf(balanced))) {
      throw new ManualMealEditError(SWAP_TOLERANCE_MESSAGE);
    }
    next = balanced;
  }
  return next;
}

export function removeIngredientFromMeal(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  productId: string;
  products: Map<string, FoodProduct>;
}): ConstructorDay {
  const product = params.products.get(params.productId);
  if (!product || !OIL_PRODUCT_SLUGS.has(product.slug)) {
    throw new ManualMealEditError(REQUIRED_INGREDIENT_MESSAGE);
  }
  const items = params.day.items.map((item) => {
    if (item.slot !== params.slot) return item;
    return recalculateMealFromProducts(
      {
        ...item,
        ingredients: item.ingredients.filter((ing) => ing.product_id !== params.productId),
      },
      params.products,
    );
  });
  return applyDayItems(params.day, items, params.products);
}

export function mealItemFromRecipe(params: {
  ctx: OptimizerContext;
  recipe: Recipe;
  slot: PlanSlot;
  forbiddenIds: Set<string>;
  mealKind: TrainerMealKind;
}): MealPlanItem {
  if (params.mealKind === "snack" && params.recipe.requires_cooking) {
    throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
  }
  const ings = verifiedIngredients(params.ctx, params.recipe, params.forbiddenIds);
  if (ings.length === 0) {
    throw new ManualMealEditError("У рецепта нет допустимых ингредиентов.");
  }
  const lines: IngredientLine[] = [];
  for (const [idx, ing] of ings.entries()) {
    const product = params.ctx.products.get(ing.product_id);
    if (!product) continue;
    if (params.forbiddenIds.has(product.id)) {
      throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
    }
    if (params.mealKind === "snack" && product.requires_cooking) {
      throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
    }
    const grams =
      ing.default_g != null && ing.default_g > 0 ? ing.default_g : Math.max(ing.min_g, 1);
    assertPositiveGrams(grams);
    lines.push(buildIngredientLine(product, grams, idx));
  }
  return normalizeMealPlanItem(
    buildMealPlanItem({
      slot: params.slot,
      recipe: {
        ...params.recipe,
        requires_cooking: params.mealKind === "snack" ? false : params.recipe.requires_cooking,
      },
      ingredients: lines,
    }),
  );
}

export function mealItemFromProducts(params: {
  slot: PlanSlot;
  name: string;
  mealKind: TrainerMealKind;
  lines: Array<{ product: FoodProduct; grams: number }>;
  forbiddenIds: Set<string>;
}): MealPlanItem {
  if (params.lines.length === 0) {
    throw new ManualMealEditError("Добавьте хотя бы один продукт.");
  }
  const ingredients: IngredientLine[] = [];
  for (const [idx, line] of params.lines.entries()) {
    assertPositiveGrams(line.grams);
    if (params.forbiddenIds.has(line.product.id)) {
      throw new ManualMealEditError(ALLERGEN_BLOCKED_MESSAGE);
    }
    if (params.mealKind === "snack" && line.product.requires_cooking) {
      throw new ManualMealEditError(COOKING_IN_SNACK_MESSAGE);
    }
    ingredients.push(buildIngredientLine(line.product, line.grams, idx));
  }
  const recipe: Recipe = {
    id: `manual-${params.slot}`,
    slug: `manual-${params.slot}`,
    name: params.name.trim() || (params.mealKind === "snack" ? "Ручной перекус" : "Ручной приём"),
    meal_type: params.mealKind === "snack" ? "snack" : "main",
    steps: ["Собрано тренером вручную."],
    prep_time_min: params.mealKind === "snack" ? 1 : 10,
    requires_cooking: params.mealKind === "main",
    is_active: true,
    weighing_note: null,
    is_nutrient_dense: true,
    contains_protein_source: ingredients.some((ing) => {
      const p = Number(ing.protein_g);
      return p >= 5;
    }),
    contains_fruit_or_vegetable: false,
    is_treat: false,
    allowed_schedule_modes: [
      "three_main_two_snacks",
      "three_mains_only",
      "one_main_three_snacks",
      "two_main_two_snacks",
    ],
    snack_action: params.mealKind === "snack" ? "Собрать" : null,
  };
  return normalizeMealPlanItem(buildMealPlanItem({ slot: params.slot, recipe, ingredients }));
}

export function replaceDaysDay(
  days: ConstructorDay[],
  nextDay: ConstructorDay,
  products: Map<string, FoodProduct>,
): ConstructorDay[] {
  return days.map((day) =>
    day.day_index === nextDay.day_index ? recalculateConstructorDay(nextDay, products) : day,
  );
}

export function persistableEditedDays(days: ConstructorDay[]): ConstructorDay[] {
  try {
    return prepareConstructorDaysForSave(days);
  } catch (error) {
    if (error instanceof InvalidIngredientGramsError) throw error;
    throw error;
  }
}

export function shoppingListAfterEdit(days: ConstructorDay[]) {
  return shoppingListFromDays(days);
}

export function dayTotalsSnapshot(day: ConstructorDay) {
  return snapshotMacro(dayMacroFromItems(day.items));
}

export function parsePositiveGramsOrThrow(grams: unknown): number {
  const n = parseIngredientGrams(grams);
  assertPositiveGrams(n);
  return n;
}
