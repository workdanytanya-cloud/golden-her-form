import type { MealScheduleMode } from "@/lib/nutrition-constructor/config";
import type { MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";
import { buildExactWeek, orderExactDays } from "@/lib/nutrition-constructor/exact-week-search";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { reportNutritionProgress } from "@/lib/nutrition-constructor/nutrition-progress";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

export function dayMenuKey(day: ConstructorDay): string {
  return [...day.items]
    .map((item) => item.recipe_id)
    .sort()
    .join("|");
}

export function mealDifferenceRatio(previous: ConstructorDay[], next: ConstructorDay[]): number {
  const count = Math.min(previous.length, next.length);
  let slots = 0;
  let different = 0;
  for (let index = 0; index < count; index += 1) {
    const before = new Map(previous[index]!.items.map((item) => [item.slot, item.recipe_id]));
    for (const item of next[index]!.items) {
      slots += 1;
      if (before.get(item.slot) !== item.recipe_id) different += 1;
    }
  }
  return slots === 0 ? 1 : different / slots;
}

function recipeIdsOf(days: ConstructorDay[]): Set<string> {
  return new Set(days.flatMap((day) => day.items.map((item) => item.recipe_id)));
}

export function planRotatingWeeks(params: {
  ctx: OptimizerContext;
  mode: MealScheduleMode;
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  days: 14 | 28;
  seed: number;
  excluded: Set<string>;
  deadlineMs: number;
}): {
  ok: boolean;
  days: ConstructorDay[];
  checked: number;
  timedOut: boolean;
  message: string | null;
} {
  const weeks = params.days / 7;
  const recipeById = new Map(params.ctx.recipes.map((recipe) => [recipe.id, recipe] as const));
  const all: ConstructorDay[] = [];
  const forbidden = new Set<string>();
  const useCount = new Map<string, number>();
  let checked = 0;
  let timedOut = false;
  reportNutritionProgress({
    stage: "Подготовка каталога",
    progress: 2,
    found: 0,
    total: params.days,
  });

  for (let week = 0; week < weeks; week += 1) {
    if (Date.now() >= params.deadlineMs) {
      timedOut = true;
      break;
    }
    const blocked = new Set<string>();
    if (week > 0) {
      for (const id of recipeIdsOf(all.slice((week - 1) * 7, week * 7))) blocked.add(id);
    }
    for (const [id, count] of useCount) {
      if (count >= 2) blocked.add(id);
    }
    const remainingWeeks = weeks - week;
    const reserveLater = (remainingWeeks - 1) * 8_000;
    const slice = Math.min(35_000, Math.max(12_000, params.deadlineMs - Date.now() - reserveLater));
    const built = buildExactWeek({
      ctx: params.ctx,
      mode: params.mode,
      targets: params.targets,
      tolerance: params.tolerance,
      days: 7,
      seed: params.seed + week * 97,
      excluded: params.excluded,
      deadlineMs: Math.min(params.deadlineMs, Date.now() + slice),
      blockedRecipeIds: blocked,
      forbiddenDayKeys: forbidden,
      onFound: (count) =>
        reportNutritionProgress({
          stage: "Поиск точных дней",
          progress: Math.min(90, Math.round(((all.length + count) / params.days) * 90)),
          found: all.length + count,
          total: params.days,
        }),
    });
    checked += built.checked;
    timedOut = timedOut || built.timedOut;
    const ordered = orderExactDays(built.days, params.ctx.recipes as Recipe[], 7);
    if (ordered.length < 7) {
      return {
        ok: false,
        days: [],
        checked,
        timedOut,
        message: `Точных дней без повтора блюда: ${all.length + ordered.length} из ${params.days}`,
      };
    }
    const violation = evaluateStrictWeekVariety(ordered, recipeById, { allowRepeats: false });
    if (violation) {
      return {
        ok: false,
        days: [],
        checked,
        timedOut,
        message: `Точных дней без повтора блюда: ${all.length} из ${params.days}`,
      };
    }
    if (week > 0 && mealDifferenceRatio(all.slice((week - 1) * 7, week * 7), ordered) < 0.75) {
      return {
        ok: false,
        days: [],
        checked,
        timedOut,
        message: "Новая неделя слишком похожа на предыдущую",
      };
    }
    for (const day of ordered) {
      const key = dayMenuKey(day);
      if (forbidden.has(key)) {
        return {
          ok: false,
          days: [],
          checked,
          timedOut,
          message: "Повтор суточного набора",
        };
      }
      forbidden.add(key);
      for (const item of day.items) {
        useCount.set(item.recipe_id, (useCount.get(item.recipe_id) ?? 0) + 1);
        if ((useCount.get(item.recipe_id) ?? 0) > 2) {
          return {
            ok: false,
            days: [],
            checked,
            timedOut,
            message: "Блюдо встречается чаще двух раз за 28 дней",
          };
        }
      }
    }
    all.push(
      ...ordered.map((day, index) => ({
        ...day,
        day_index: week * 7 + index,
      })),
    );
  }

  if (all.length !== params.days) {
    return {
      ok: false,
      days: [],
      checked,
      timedOut,
      message: timedOut
        ? "Поиск точных дней остановлен по времени"
        : `Точных дней без повтора блюда: ${all.length} из ${params.days}`,
    };
  }
  reportNutritionProgress({
    stage: "Проверка разнообразия",
    progress: 94,
    found: params.days,
    total: params.days,
  });
  return { ok: true, days: all, checked, timedOut, message: null };
}
