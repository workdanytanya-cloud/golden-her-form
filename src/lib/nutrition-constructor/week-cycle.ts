import {
  MAIN_RECIPE_REPEAT_DAYS,
  type MealScheduleMode,
  type PlanSlot,
} from "@/lib/nutrition-constructor/config";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

/** Сколько разных валидных дней собираем для недельного цикла 7/14/28. */
export const UNIQUE_WEEK_TARGET = 7;

/** Бюджет поиска уникальной недели — оставляем запас до лимита 120 с в пилот-тесте. */
export const WEEK_SEARCH_BUDGET_MS = 90_000;

export function shouldUseWeekTiling(mode: MealScheduleMode, daysCount: number): boolean {
  return (
    mode === "two_main_two_snacks" && (daysCount === 7 || daysCount === 14 || daysCount === 28)
  );
}

export function fingerprintFromRecipes(slotRecipes: Partial<Record<PlanSlot, Recipe>>): string {
  return (["main1", "main2", "snack1", "snack2"] as const)
    .map((slot) => `${slot}:${slotRecipes[slot]?.id ?? ""}`)
    .join("|");
}

export function fingerprintDay(day: ConstructorDay): string {
  return [...day.items]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((item) => `${item.slot}:${item.recipe_id}`)
    .join("|");
}

export function snackPairKeyFromRecipes(slotRecipes: Partial<Record<PlanSlot, Recipe>>): string {
  return [slotRecipes.snack1?.id, slotRecipes.snack2?.id].filter(Boolean).sort().join("+");
}

export function snackPairKeyFromDay(day: ConstructorDay): string {
  return day.items
    .filter((item) => item.slot.startsWith("snack"))
    .map((item) => item.recipe_id)
    .sort()
    .join("+");
}

export function cloneConstructorDay(day: ConstructorDay, dayIndex: number): ConstructorDay {
  const cloned = structuredClone(day);
  cloned.day_index = dayIndex;
  return cloned;
}

export function tileConstructorWeek(
  uniqueDays: ConstructorDay[],
  totalDays: number,
): ConstructorDay[] {
  if (uniqueDays.length === 0) return [];
  return Array.from({ length: totalDays }, (_, i) =>
    cloneConstructorDay(uniqueDays[i % uniqueDays.length]!, i),
  );
}

export function applyCircularMainBlocks(
  recentMain: Map<string, number>,
  uniqueDays: ConstructorDay[],
  dayIndex: number,
  weekLength: number,
): void {
  for (let j = 0; j < uniqueDays.length; j++) {
    const forward = dayIndex - j;
    const wrapToJ = j + weekLength - dayIndex;
    if (forward < MAIN_RECIPE_REPEAT_DAYS || wrapToJ < MAIN_RECIPE_REPEAT_DAYS) {
      for (const item of uniqueDays[j]!.items) {
        if (!item.slot.startsWith("main")) continue;
        recentMain.set(item.recipe_id, dayIndex - 1);
      }
    }
  }
}

export function makeComboReject(
  uniqueDays: ConstructorDay[],
  weekLength: number,
): (slotRecipes: Partial<Record<PlanSlot, Recipe>>) => boolean {
  return (slotRecipes) => {
    const dayIndex = uniqueDays.length;
    const main1 = slotRecipes.main1?.id;
    const main2 = slotRecipes.main2?.id;
    if (main1 && main2 && main1 === main2) return true;
    if (uniqueDays.some((day) => fingerprintDay(day) === fingerprintFromRecipes(slotRecipes))) {
      return true;
    }
    const snacks = snackPairKeyFromRecipes(slotRecipes);
    const prevSnacks = uniqueDays[dayIndex - 1]
      ? snackPairKeyFromDay(uniqueDays[dayIndex - 1]!)
      : null;
    if (prevSnacks && snacks === prevSnacks) return true;
    const wrapSnacks =
      dayIndex === weekLength - 1 && uniqueDays[0] ? snackPairKeyFromDay(uniqueDays[0]) : null;
    if (wrapSnacks && snacks === wrapSnacks) return true;

    for (const recipe of [slotRecipes.main1, slotRecipes.main2]) {
      if (!recipe) continue;
      for (let j = 0; j < uniqueDays.length; j++) {
        const usedHere = uniqueDays[j]!.items.some(
          (item) => item.slot.startsWith("main") && item.recipe_id === recipe.id,
        );
        if (!usedHere) continue;
        const forward = dayIndex - j;
        const wrapToJ = j + weekLength - dayIndex;
        if (forward < MAIN_RECIPE_REPEAT_DAYS || wrapToJ < MAIN_RECIPE_REPEAT_DAYS) return true;
      }
    }
    return false;
  };
}

export function weekCycleVarietyOk(days: ConstructorDay[]): boolean {
  const n = days.length;
  if (n === 0) return false;

  for (const day of days) {
    const mains = day.items
      .filter((item) => item.slot.startsWith("main"))
      .map((item) => item.recipe_id);
    if (mains.length !== 2 || mains[0] === mains[1]) return false;
  }

  if (n === 1) return false;

  for (let i = 0; i < n; i++) {
    const a = days[i]!;
    const b = days[(i + 1) % n]!;
    if (fingerprintDay(a) === fingerprintDay(b)) return false;
    if (snackPairKeyFromDay(a) === snackPairKeyFromDay(b)) return false;
  }

  const uses = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const item of days[i]!.items) {
      if (!item.slot.startsWith("main")) continue;
      const arr = uses.get(item.recipe_id) ?? [];
      arr.push(i);
      uses.set(item.recipe_id, arr);
    }
  }

  for (const positions of uses.values()) {
    const sorted = [...positions].sort((a, b) => a - b);
    if (sorted.length === 1) {
      if (n < MAIN_RECIPE_REPEAT_DAYS) return false;
      continue;
    }
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k]!;
      const b = sorted[(k + 1) % sorted.length]!;
      const gap = k === sorted.length - 1 ? b + n - a : b - a;
      if (gap < MAIN_RECIPE_REPEAT_DAYS) return false;
    }
  }

  return true;
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permute(rest)) out.push([items[i]!, ...p]);
  }
  return out;
}

/** Переставляет уникальные дни так, чтобы недельный цикл соблюдал разнообразие. */
export function arrangeWeekCycle(uniqueDays: ConstructorDay[]): ConstructorDay[] {
  if (uniqueDays.length <= 1) return uniqueDays;
  if (weekCycleVarietyOk(uniqueDays)) return uniqueDays;
  for (const perm of permute(uniqueDays)) {
    if (weekCycleVarietyOk(perm)) return perm;
  }
  return uniqueDays;
}

/** Берёт наибольший поднабор уникальных дней, из которого складывается валидный цикл. */
export function arrangeBestWeekCycle(uniqueDays: ConstructorDay[]): ConstructorDay[] {
  for (let n = uniqueDays.length; n >= 3; n--) {
    if (n === uniqueDays.length) {
      const arranged = arrangeWeekCycle(uniqueDays);
      if (weekCycleVarietyOk(arranged)) return arranged;
      continue;
    }
    const combos = combinations(uniqueDays, n);
    for (const combo of combos) {
      const arranged = arrangeWeekCycle(combo);
      if (weekCycleVarietyOk(arranged)) return arranged;
    }
  }
  return arrangeWeekCycle(uniqueDays);
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

export function uniqueDayFingerprints(days: ConstructorDay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    const fp = fingerprintDay(day);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(fp);
  }
  return out;
}
