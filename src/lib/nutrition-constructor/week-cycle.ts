import {
  MAIN_RECIPE_REPEAT_DAYS,
  type MealScheduleMode,
  type PlanSlot,
} from "@/lib/nutrition-constructor/config";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

/** Сколько разных валидных дней собираем для недельного цикла 7/14/28. */
export const UNIQUE_WEEK_TARGET = 7;
export const EXACT_DAY_POOL_TARGET = 12;

/** Бюджет поиска уникальной недели — оставляем запас до лимита 120 с в пилот-тесте. */
export const WEEK_SEARCH_BUDGET_MS = 55_000;

export function shouldUseWeekTiling(mode: MealScheduleMode, daysCount: number): boolean {
  if (!(daysCount === 7 || daysCount === 14 || daysCount === 28)) return false;
  // 2+2 и 3 без перекусов: неделя из уникальных дней + тайлинг.
  return mode === "two_main_two_snacks" || mode === "three_mains_only";
}

export function fingerprintFromRecipes(slotRecipes: Partial<Record<PlanSlot, Recipe>>): string {
  return (["main1", "main2", "main3", "snack1", "snack2", "snack3"] as const)
    .map((slot) => `${slot}:${slotRecipes[slot]?.id ?? ""}`)
    .join("|");
}

export function fingerprintDay(day: ConstructorDay): string {
  return [...day.items]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((item) => `${item.slot}:${item.recipe_id}`)
    .join("|");
}

/** Exact signature: recipe identity plus ingredient grams rounded to constructor precision. */
export function fingerprintExactDay(day: ConstructorDay): string {
  return [...day.items]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((item) => {
      const grams = [...item.ingredients]
        .sort((a, b) => a.product_id.localeCompare(b.product_id))
        .map((ingredient) => `${ingredient.product_id}:${Number(ingredient.grams).toFixed(1)}`)
        .join(",");
      return `${item.slot}:${item.recipe_id}[${grams}]`;
    })
    .join("|");
}

function arrangeDinnerLean(day: ConstructorDay): ConstructorDay {
  const normalized = {
    ...day,
    items: day.items.map((item) => ({
      ...item,
      ingredients: item.ingredients.filter((ingredient) => Number(ingredient.grams) > 0),
    })),
  };
  if (
    normalized.items.length !== 3 ||
    !normalized.items.every((item) => item.slot.startsWith("main"))
  ) {
    return normalized;
  }
  const byFat = [...normalized.items].sort(
    (a, b) => Number(b.fat_g) - Number(a.fat_g) || a.recipe_id.localeCompare(b.recipe_id),
  );
  return {
    ...normalized,
    items: byFat.map((item, index) => ({ ...item, slot: `main${index + 1}` as PlanSlot })),
  };
}

/** Phase B: assemble seven days from an immutable exact-PASS pool. */
export function assembleExactWeek(
  pool: ConstructorDay[],
  totalDays: number,
  seed = 0,
  options?: {
    recipeById?: Map<string, Recipe>;
    allowRepeats?: boolean;
  },
): ConstructorDay[] {
  const unique = new Map<string, ConstructorDay>();
  for (const raw of pool) {
    const day = arrangeDinnerLean(raw);
    if (!day.is_valid || day.items.some((item) => item.ingredients.length === 0)) {
      continue;
    }
    unique.set(fingerprintExactDay(day), day);
  }
  const hash = (value: string) => {
    let out = 2166136261 ^ seed;
    for (let i = 0; i < value.length; i++) out = Math.imul(out ^ value.charCodeAt(i), 16777619);
    return out >>> 0;
  };
  const candidates = [...unique.entries()]
    .sort((a, b) => hash(a[0]) - hash(b[0]))
    .map(([signature, day]) => ({ signature, day }));
  if (candidates.length < Math.min(4, totalDays)) return [];

  const recipeById = options?.recipeById ?? new Map<string, Recipe>();
  const allowRepeats = options?.allowRepeats === true;
  const selected: typeof candidates = [];
  const recipeUses = new Map<string, number>();
  const groupUses = new Map<string, number>();
  const signatureUses = new Map<string, number>();
  const daySignatures = new Set<string>();
  const visit = (): boolean => {
    if (selected.length === totalDays) {
      const days = selected.map((candidate, index) =>
        cloneConstructorDay(candidate.day, index),
      );
      if (allowRepeats) return daySignatures.size >= Math.min(4, totalDays);
      return evaluateStrictWeekVariety(days, recipeById, { allowRepeats: false }) == null;
    }
    const remaining = totalDays - selected.length;
    if (daySignatures.size + remaining < Math.min(4, totalDays)) return false;
    for (const candidate of candidates) {
      if (selected.at(-1)?.signature === candidate.signature) continue;
      if (candidates.length >= totalDays && daySignatures.has(candidate.signature)) continue;
      const ids = candidate.day.items.map((item) => item.recipe_id);
      const maxRecipeUses = allowRepeats ? 3 : 1;
      if (ids.some((id) => (recipeUses.get(id) ?? 0) >= maxRecipeUses)) continue;
      if (!allowRepeats) {
        let blocked = false;
        for (const item of candidate.day.items) {
          const recipe = recipeById.get(item.recipe_id);
          if (recipe?.variant_group && (groupUses.get(recipe.variant_group) ?? 0) >= 1) {
            blocked = true;
            break;
          }
          if (
            recipe?.ingredient_signature &&
            (signatureUses.get(recipe.ingredient_signature) ?? 0) >= 1
          ) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }
      selected.push(candidate);
      const wasNew = !daySignatures.has(candidate.signature);
      daySignatures.add(candidate.signature);
      for (const id of ids) recipeUses.set(id, (recipeUses.get(id) ?? 0) + 1);
      const touchedGroups: string[] = [];
      const touchedSignatures: string[] = [];
      for (const item of candidate.day.items) {
        const recipe = recipeById.get(item.recipe_id);
        if (recipe?.variant_group) {
          groupUses.set(recipe.variant_group, (groupUses.get(recipe.variant_group) ?? 0) + 1);
          touchedGroups.push(recipe.variant_group);
        }
        if (recipe?.ingredient_signature) {
          signatureUses.set(
            recipe.ingredient_signature,
            (signatureUses.get(recipe.ingredient_signature) ?? 0) + 1,
          );
          touchedSignatures.push(recipe.ingredient_signature);
        }
      }
      if (visit()) return true;
      selected.pop();
      for (const id of ids) recipeUses.set(id, recipeUses.get(id)! - 1);
      for (const group of touchedGroups) groupUses.set(group, groupUses.get(group)! - 1);
      for (const signature of touchedSignatures) {
        signatureUses.set(signature, signatureUses.get(signature)! - 1);
      }
      if (wasNew && !selected.some((item) => item.signature === candidate.signature)) {
        daySignatures.delete(candidate.signature);
      }
    }
    return false;
  };
  if (!visit()) return [];
  return selected.map((candidate, index) => cloneConstructorDay(candidate.day, index));
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
    const main3 = slotRecipes.main3?.id;
    const mainIds = [main1, main2, main3].filter(Boolean) as string[];
    if (new Set(mainIds).size !== mainIds.length) return true;
    if (uniqueDays.some((day) => fingerprintDay(day) === fingerprintFromRecipes(slotRecipes))) {
      return true;
    }
    const snacks = snackPairKeyFromRecipes(slotRecipes);
    const prevSnacks = uniqueDays[dayIndex - 1]
      ? snackPairKeyFromDay(uniqueDays[dayIndex - 1]!)
      : null;
    if (prevSnacks && snacks && snacks === prevSnacks) return true;
    const wrapSnacks =
      dayIndex === weekLength - 1 && uniqueDays[0] ? snackPairKeyFromDay(uniqueDays[0]) : null;
    if (wrapSnacks && snacks && snacks === wrapSnacks) return true;

    for (const recipe of [slotRecipes.main1, slotRecipes.main2, slotRecipes.main3]) {
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
    if (mains.length < 2 || mains.length > 3) return false;
    if (new Set(mains).size !== mains.length) return false;
  }

  if (n === 1) return false;

  for (let i = 0; i < n; i++) {
    const a = days[i]!;
    const b = days[(i + 1) % n]!;
    if (fingerprintDay(a) === fingerprintDay(b)) return false;
    const snacksA = snackPairKeyFromDay(a);
    const snacksB = snackPairKeyFromDay(b);
    if (snacksA && snacksB && snacksA === snacksB) return false;
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
