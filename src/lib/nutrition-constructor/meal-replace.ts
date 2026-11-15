import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import type { PlanSlot } from "@/lib/nutrition-constructor/config";
import type {
  ConstructorDay,
  FoodProduct,
  MealPlanItem,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";

export const MEAL_REPLACE_TOLERANCE = { kcal: 5, protein_g: 1, fat_g: 1, carbs_g: 1 };
export const LEGACY_REBUILD_SEED = 20261022;
export const CANNOT_FIT_RECIPE =
  "Этот рецепт нельзя вписать в оставшиеся КБЖУ дня. Выберите другой вариант";
export const SAME_RECIPE_MESSAGE = "Это уже текущий рецепт этого приёма.";
export const RECIPE_ALREADY_USED = "Это блюдо уже используется в текущей неделе";
export const DRAFT_CONFLICT_MESSAGE =
  "Черновик уже изменён. Обновите страницу и повторите действие.";
export const REBUILD_UNCHANGED_MESSAGE =
  "Новый отличающийся вариант найти не удалось. Текущий рацион сохранён без изменений.";

export type MacroGrams = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type MealReplacePreview = {
  recipeId: string;
  recipeName: string;
  oldName: string;
  grams: Array<{ name: string; grams: number }>;
  before: MacroGrams;
  after: MacroGrams;
  item: MealPlanItem;
  day: ConstructorDay;
};

type FitResult =
  { ok: true; preview: MealReplacePreview } | { ok: false; message: string; deviationText: string };

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function macroOfItem(
  item: Pick<MealPlanItem, "kcal" | "protein_g" | "fat_g" | "carbs_g">,
): MacroGrams {
  return {
    kcal: num(item.kcal),
    protein_g: num(item.protein_g),
    fat_g: num(item.fat_g),
    carbs_g: num(item.carbs_g),
  };
}

export function sumMacros(items: MacroGrams[]): MacroGrams {
  return items.reduce(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      protein_g: acc.protein_g + item.protein_g,
      fat_g: acc.fat_g + item.fat_g,
      carbs_g: acc.carbs_g + item.carbs_g,
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );
}

export function withinMealReplaceTolerance(actual: MacroGrams, target: MacroGrams): boolean {
  return (
    Math.abs(actual.kcal - target.kcal) <= MEAL_REPLACE_TOLERANCE.kcal &&
    Math.abs(actual.protein_g - target.protein_g) <= MEAL_REPLACE_TOLERANCE.protein_g &&
    Math.abs(actual.fat_g - target.fat_g) <= MEAL_REPLACE_TOLERANCE.fat_g &&
    Math.abs(actual.carbs_g - target.carbs_g) <= MEAL_REPLACE_TOLERANCE.carbs_g
  );
}

export function formatMacroDeviation(actual: MacroGrams, target: MacroGrams): string {
  const signed = (value: number, digits = 1) => {
    const rounded = Number(value.toFixed(digits));
    return `${rounded > 0 ? "+" : ""}${rounded}`;
  };
  return `Ближайшее отклонение: калории ${signed(actual.kcal - target.kcal, 0)}, белки ${signed(actual.protein_g - target.protein_g)} г, жиры ${signed(actual.fat_g - target.fat_g)} г, углеводы ${signed(actual.carbs_g - target.carbs_g)} г`;
}

export function freshRebuildSeed(now = Date.now(), avoid?: number): number {
  let seed = Math.abs(Math.trunc(now) % 2147483647);
  if (seed === 0) seed = 1;
  if (seed === LEGACY_REBUILD_SEED || (avoid != null && seed === avoid)) {
    seed = (seed + 104729) % 2147483647;
  }
  return seed === 0 ? 1 : seed;
}

export function countReplacedMeals(
  before: Array<{ day_index: number; items: Array<{ slot: string; recipe_id: string }> }>,
  after: Array<{ day_index: number; items: Array<{ slot: string; recipe_id: string }> }>,
): { changed: number; total: number } {
  let changed = 0;
  let total = 0;
  for (const day of after) {
    const previous = before.find((item) => item.day_index === day.day_index);
    for (const item of day.items) {
      total += 1;
      const prev = previous?.items.find((meal) => meal.slot === item.slot);
      if (!prev || prev.recipe_id !== item.recipe_id) changed += 1;
    }
  }
  return { changed, total };
}

export function rebuildSaveDecision(input: {
  valid: boolean;
  changed: number;
  total: number;
  hadDraft: boolean;
}): { save: boolean; success: boolean; message: string } {
  if (!input.valid) {
    return {
      save: false,
      success: false,
      message: "Черновик не изменён. Текущий рацион сохранён без изменений.",
    };
  }
  if (input.hadDraft && input.changed === 0) {
    return { save: false, success: false, message: REBUILD_UNCHANGED_MESSAGE };
  }
  return {
    save: true,
    success: true,
    message: `Рацион пересобран: изменено ${input.changed} из ${input.total} приёмов`,
  };
}

export function recipeRepeatReason(
  days: ConstructorDay[],
  recipes: Recipe[],
  candidate: Recipe,
  except: { dayIndex: number; slot: PlanSlot },
): string | null {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  for (const day of days) {
    for (const item of day.items) {
      if (day.day_index === except.dayIndex && item.slot === except.slot) continue;
      if (item.recipe_id && item.recipe_id === candidate.id) return RECIPE_ALREADY_USED;
      const other = byId.get(item.recipe_id);
      if (
        candidate.variant_group &&
        other?.variant_group &&
        other.variant_group === candidate.variant_group
      ) {
        return RECIPE_ALREADY_USED;
      }
      if (
        candidate.ingredient_signature &&
        other?.ingredient_signature &&
        other.ingredient_signature === candidate.ingredient_signature
      ) {
        return RECIPE_ALREADY_USED;
      }
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dayFromItems(day: ConstructorDay, items: MealPlanItem[], valid: boolean): ConstructorDay {
  const totals = sumMacros(items.map(macroOfItem));
  const fiber = items.reduce((acc, item) => acc + num(item.fiber_g), 0);
  return {
    ...day,
    items,
    kcal: totals.kcal.toFixed(4),
    protein_g: totals.protein_g.toFixed(4),
    fat_g: totals.fat_g.toFixed(4),
    carbs_g: totals.carbs_g.toFixed(4),
    fiber_g: fiber.toFixed(4),
    is_valid: valid,
  };
}

export function fitRecipeIntoDay(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  products: Map<string, FoodProduct>;
  targets: MacroGrams;
}): FitResult {
  const current = params.day.items.find((item) => item.slot === params.slot);
  if (!current) {
    return {
      ok: false,
      message: "В этом дне нет выбранного приёма.",
      deviationText: "",
    };
  }
  const others = params.day.items.filter((item) => item.slot !== params.slot);
  const before = sumMacros(params.day.items.map(macroOfItem));
  const otherMacros = sumMacros(others.map(macroOfItem));
  const desired: MacroGrams = {
    kcal: params.targets.kcal - otherMacros.kcal,
    protein_g: params.targets.protein_g - otherMacros.protein_g,
    fat_g: params.targets.fat_g - otherMacros.fat_g,
    carbs_g: params.targets.carbs_g - otherMacros.carbs_g,
  };
  const rows = params.ingredients
    .map((ingredient) => {
      const product = params.products.get(ingredient.product_id);
      if (!product) return null;
      const min = Math.max(1, ingredient.min_g || 1);
      const max = Math.max(min, ingredient.max_g || min);
      const start = clamp(
        ingredient.default_g && ingredient.default_g > 0 ? ingredient.default_g : min,
        min,
        max,
      );
      return {
        ingredient,
        product,
        min,
        max,
        start,
        scalable: ingredient.is_scalable !== false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  if (rows.length === 0) {
    return { ok: false, message: "У рецепта нет допустимых ингредиентов.", deviationText: "" };
  }

  const evaluate = (grams: number[]) => {
    const lines = rows.map((row, index) =>
      buildIngredientLine(row.product, grams[index] ?? row.min, row.ingredient.sort_order ?? index),
    );
    const item = buildMealPlanItem({
      slot: params.slot,
      recipe: params.recipe,
      ingredients: lines,
    });
    item.id = current.id;
    const meal = macroOfItem(item);
    const after = sumMacros([otherMacros, meal]);
    const score =
      Math.abs(after.kcal - params.targets.kcal) +
      Math.abs(after.protein_g - params.targets.protein_g) * 4 +
      Math.abs(after.fat_g - params.targets.fat_g) * 9 +
      Math.abs(after.carbs_g - params.targets.carbs_g) * 4;
    return {
      item,
      after,
      meal,
      score,
      grams: grams.map((value) => (Number.isFinite(value) ? value : 0)),
    };
  };

  let grams = rows.map((row) => row.min);
  const seeded = evaluate(rows.map((row) => (row.scalable ? row.start : row.min)));
  const kcal = Math.max(seeded.meal.kcal, 1);
  const factor = desired.kcal > 0 ? desired.kcal / kcal : 1;
  grams = rows.map((row, index) =>
    row.scalable
      ? clamp(Math.round((seeded.grams[index] ?? row.start) * factor), row.min, row.max)
      : row.min,
  );
  let best = evaluate(grams);
  const deltas = [25, 10, 5, 2, 1, -1, -2, -5, -10, -25];
  for (let pass = 0; pass < 30; pass += 1) {
    let improved = false;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      if (!row.scalable) continue;
      for (const delta of deltas) {
        const nextGrams = best.grams.slice();
        nextGrams[index] = clamp((best.grams[index] ?? row.min) + delta, row.min, row.max);
        const trial = evaluate(nextGrams);
        if (trial.score + 0.001 < best.score) {
          best = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const valid = withinMealReplaceTolerance(best.after, params.targets);
  const deviationText = formatMacroDeviation(best.after, params.targets);
  if (!valid) {
    return {
      ok: false,
      message: CANNOT_FIT_RECIPE,
      deviationText,
    };
  }
  const nextItems = params.day.items.map((item) => (item.slot === params.slot ? best.item : item));
  return {
    ok: true,
    preview: {
      recipeId: params.recipe.id,
      recipeName: params.recipe.name,
      oldName: current.recipe_name,
      grams: best.item.ingredients.map((line) => ({
        name: line.product_name,
        grams: Math.round(num(line.grams)),
      })),
      before,
      after: best.after,
      item: best.item,
      day: dayFromItems(params.day, nextItems, true),
    },
  };
}

export function manualMealWithinDay(params: {
  day: ConstructorDay;
  slot: PlanSlot;
  item: MealPlanItem;
  targets: MacroGrams;
}): FitResult {
  const current = params.day.items.find((item) => item.slot === params.slot);
  if (!current) {
    return { ok: false, message: "В этом дне нет выбранного приёма.", deviationText: "" };
  }
  const others = params.day.items.filter((item) => item.slot !== params.slot);
  const before = sumMacros(params.day.items.map(macroOfItem));
  const after = sumMacros([...others.map(macroOfItem), macroOfItem(params.item)]);
  const deviationText = formatMacroDeviation(after, params.targets);
  if (!withinMealReplaceTolerance(after, params.targets)) {
    return { ok: false, message: CANNOT_FIT_RECIPE, deviationText };
  }
  const nextItem = { ...params.item, id: current.id, slot: params.slot };
  const nextItems = params.day.items.map((item) => (item.slot === params.slot ? nextItem : item));
  return {
    ok: true,
    preview: {
      recipeId: nextItem.recipe_id,
      recipeName: nextItem.recipe_name,
      oldName: current.recipe_name,
      grams: nextItem.ingredients.map((line) => ({
        name: line.product_name,
        grams: Math.round(num(line.grams)),
      })),
      before,
      after,
      item: nextItem,
      day: dayFromItems(params.day, nextItems, true),
    },
  };
}
