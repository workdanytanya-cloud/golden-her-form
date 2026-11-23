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

const MIN_WEEK_DIFFERENCE = 0.5;

type LastUse = { dayIndex: number; weekday: number; slot: string };

export function repeatSpacingIssues(days: ConstructorDay[]): string | null {
  const last = new Map<string, LastUse>();
  for (let index = 0; index < days.length; index += 1) {
    const weekday = index % 7;
    for (const item of days[index]!.items) {
      const prev = last.get(item.recipe_id);
      if (prev) {
        if (index - prev.dayIndex < 7) return "повтор раньше 7 дней";
        if (prev.weekday === weekday && prev.slot === item.slot) return "повтор в тот же день и слот";
      }
      last.set(item.recipe_id, { dayIndex: index, weekday, slot: item.slot });
    }
  }
  for (let week = 1; week < days.length / 7; week += 1) {
    const ratio = mealDifferenceRatio(
      days.slice((week - 1) * 7, week * 7),
      days.slice(week * 7, week * 7 + 7),
    );
    if (ratio < MIN_WEEK_DIFFERENCE) return "неделя слишком похожа";
  }
  return null;
}

const FRESH_MAIN_SLUGS = [
  "lunch-turkey-potato-zucchini",
  "breakfast-chicken-buckwheat-carrot",
  "dinner-pollock-rice-pepper",
  "lunch-cod-barley-broccoli",
  "breakfast-cottage-oats-apple",
  "dinner-salmon-bulgur-beans",
  "lunch-turkey-cabbage-tomato",
  "dinner-chicken-zucchini-pepper",
  "lunch-lentil-zucchini-tomato",
  "dinner-chickpea-bulgur-spinach",
  "breakfast-egg-potato-spinach",
  "lunch-beef-carrot-buckwheat",
  "dinner-hake-potato-cabbage",
  "lunch-ground-turkey-rice-zucchini",
  "breakfast-salmon-couscous-tomato",
  "dinner-thigh-oats-broccoli",
];

function conflictIds(used: Set<string>, recipes: Recipe[]): Set<string> {
  const groups = new Set<string>();
  const signatures = new Set<string>();
  for (const recipe of recipes) {
    if (!used.has(recipe.id)) continue;
    if (recipe.variant_group) groups.add(recipe.variant_group);
    if (recipe.ingredient_signature) signatures.add(recipe.ingredient_signature);
  }
  const blocked = new Set(used);
  for (const recipe of recipes) {
    if (recipe.variant_group && groups.has(recipe.variant_group)) blocked.add(recipe.id);
    if (recipe.ingredient_signature && signatures.has(recipe.ingredient_signature)) blocked.add(recipe.id);
  }
  return blocked;
}

function assembleAnchoredWeek(params: {
  ctx: OptimizerContext;
  mode: MealScheduleMode;
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  seed: number;
  excluded: Set<string>;
  deadlineMs: number;
  weekStart: number;
  spent: Set<string>;
  forbidden: Set<string>;
  lastUse: Map<string, LastUse>;
  previous: ConstructorDay[];
  recipeById: Map<string, Recipe>;
}): ConstructorDay[] | null {
  const built: ConstructorDay[] = [];
  const weekUsed = new Set(params.spent);
  const localForbidden = new Set(params.forbidden);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    let accepted: ConstructorDay | null = null;
    for (let attempt = 0; attempt < 3 && !accepted; attempt += 1) {
      if (Date.now() >= params.deadlineMs) return null;
      const blocked = conflictIds(weekUsed, params.ctx.recipes as Recipe[]);
      for (const [id, prev] of params.lastUse) {
        if (params.weekStart + weekday - prev.dayIndex < 7 || prev.weekday === weekday) blocked.add(id);
      }
      const freshIds = new Set(
        params.ctx.recipes
          .filter(
            (recipe) =>
              !blocked.has(recipe.id) &&
              (recipe.meal_type === "snack" || FRESH_MAIN_SLUGS.includes(recipe.id)),
          )
          .map((recipe) => recipe.id),
      );
      const focused =
        attempt === 0 && freshIds.size > 0
          ? buildExactWeek({
              ctx: params.ctx,
              mode: params.mode,
              targets: params.targets,
              tolerance: params.tolerance,
              days: 1,
              seed: params.seed + weekday * 19,
              excluded: params.excluded,
              deadlineMs: Math.min(params.deadlineMs, Date.now() + 2_500),
              blockedRecipeIds: blocked,
              allowedRecipeIds: freshIds,
              forbiddenDayKeys: localForbidden,
              previousDay: built[built.length - 1],
            })
          : null;
      const found = focused?.days[0]
        ? focused
        : buildExactWeek({
        ctx: params.ctx,
        mode: params.mode,
        targets: params.targets,
        tolerance: params.tolerance,
        days: 1,
        seed: params.seed + weekday * 19 + attempt * 131,
        excluded: params.excluded,
        deadlineMs: Math.min(params.deadlineMs, Date.now() + 16_000),
        blockedRecipeIds: blocked,
        forbiddenDayKeys: localForbidden,
        previousDay: built[built.length - 1],
      });
      const candidate = found.days[0];
      if (!candidate) {
        if (process.env.NUTRITION_PLAN_TRACE) {
          console.error(
            `weekday ${weekday} empty checked ${found.checked} timeout ${found.timedOut} exact ${found.exactDays}`,
          );
        }
        break;
      }
      const key = dayMenuKey(candidate);
      const sameSlot = candidate.items.some((item) => {
        const prev = params.lastUse.get(item.recipe_id);
        return prev?.weekday === weekday && prev.slot === item.slot;
      });
      if (sameSlot || localForbidden.has(key)) {
        localForbidden.add(key);
        continue;
      }
      accepted = { ...candidate, day_index: params.weekStart + weekday };
      localForbidden.add(key);
    }
    if (!accepted) {
      if (process.env.NUTRITION_PLAN_TRACE) console.error(`anchored stopped at weekday ${weekday}`);
      return null;
    }
    built.push(accepted);
    for (const item of accepted.items) weekUsed.add(item.recipe_id);
  }
  if (mealDifferenceRatio(params.previous, built) < MIN_WEEK_DIFFERENCE) return null;
  if (evaluateStrictWeekVariety(built, params.recipeById, { allowRepeats: false })) return null;
  return built;
}

function adjacentClash(previous: ConstructorDay, next: ConstructorDay, recipeById: Map<string, Recipe>): boolean {
  const mains = next.items.filter((item) => item.slot.startsWith("main"));
  return mains.some((item, index) => {
    const recipe = recipeById.get(item.recipe_id);
    const neighbor = previous.items.find((entry) => entry.slot === item.slot);
    const prevRecipe = neighbor ? recipeById.get(neighbor.recipe_id) : undefined;
    if (neighbor?.recipe_id === item.recipe_id) return true;
    if (
      prevRecipe?.primary_protein &&
      recipe?.primary_protein &&
      prevRecipe.primary_protein === recipe.primary_protein &&
      recipe.primary_protein !== "none"
    ) {
      return true;
    }
    if (
      prevRecipe?.primary_carb &&
      recipe?.primary_carb &&
      prevRecipe.primary_carb === recipe.primary_carb &&
      !["veg", "none"].includes(recipe.primary_carb)
    ) {
      return true;
    }
    if (index === 0) return false;
    const left = recipeById.get(mains[index - 1]!.recipe_id);
    return Boolean(
      left?.primary_protein &&
      recipe?.primary_protein &&
      left.primary_protein === recipe.primary_protein &&
      recipe.primary_protein !== "none",
    );
  });
}

function placeWeek(
  ordered: ConstructorDay[],
  previous: ConstructorDay[] | null,
  weekStart: number,
  recipeById: Map<string, Recipe>,
  lastUse: Map<string, LastUse>,
): ConstructorDay[] | null {
  const chosen: ConstructorDay[] = [];
  const used = new Set<number>();
  const stats = { slot: 0, adjacent: 0, difference: 0, variety: 0 };
  const repeatBlocked = (day: ConstructorDay, weekday: number) =>
    day.items.some((item) => {
      const prev = lastUse.get(item.recipe_id);
      if (!prev) return false;
      if (weekStart + weekday - prev.dayIndex < 7) return true;
      return prev.weekday === weekday && prev.slot === item.slot;
    });
  const visit = (weekday: number): boolean => {
    if (weekday === ordered.length) {
      if (previous && mealDifferenceRatio(previous, chosen) < MIN_WEEK_DIFFERENCE) {
        stats.difference += 1;
        return false;
      }
      if (evaluateStrictWeekVariety(chosen, recipeById, { allowRepeats: false })) {
        stats.variety += 1;
        return false;
      }
      return true;
    }
    for (let index = 0; index < ordered.length; index += 1) {
      if (used.has(index)) continue;
      const day = ordered[index]!;
      if (repeatBlocked(day, weekday)) {
        stats.slot += 1;
        continue;
      }
      if (chosen.length > 0 && adjacentClash(chosen[chosen.length - 1]!, day, recipeById)) {
        stats.adjacent += 1;
        continue;
      }
      const eggs =
        chosen.filter((entry) =>
          entry.items.some((item) => item.slot === "main1" && recipeById.get(item.recipe_id)?.primary_protein === "egg"),
        ).length +
        (day.items.some((item) => item.slot === "main1" && recipeById.get(item.recipe_id)?.primary_protein === "egg") ? 1 : 0);
      if (eggs > 2) continue;
      used.add(index);
      chosen.push({ ...day, day_index: weekStart + weekday });
      if (visit(weekday + 1)) return true;
      chosen.pop();
      used.delete(index);
    }
    return false;
  };
  const placed = visit(0) ? chosen.map((day) => ({ ...day })) : null;
  if (!placed && process.env.NUTRITION_PLAN_TRACE) {
    console.error(
      `place reject slot ${stats.slot} adjacent ${stats.adjacent} difference ${stats.difference} variety ${stats.variety}`,
    );
  }
  return placed;
}

type PoolDay = {
  day: ConstructorDay;
  key: string;
  ids: string[];
  mainIds: string[];
  snackIds: string[];
  groups: string[];
  signatures: string[];
};

function toPoolDay(day: ConstructorDay, recipes: Map<string, Recipe>): PoolDay {
  const ids: string[] = [];
  const mainIds: string[] = [];
  const snackIds: string[] = [];
  const groups: string[] = [];
  const signatures: string[] = [];
  for (const item of day.items) {
    ids.push(item.recipe_id);
    if (item.slot.startsWith("snack")) snackIds.push(item.recipe_id);
    else mainIds.push(item.recipe_id);
    const recipe = recipes.get(item.recipe_id);
    if (recipe?.variant_group) groups.push(recipe.variant_group);
    if (recipe?.ingredient_signature) signatures.push(recipe.ingredient_signature);
  }
  return { day, key: dayMenuKey(day), ids, mainIds, snackIds, groups, signatures };
}

function planGlobalMonth(params: {
  ctx: OptimizerContext;
  mode: MealScheduleMode;
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  days: 14 | 28;
  seed: number;
  excluded: Set<string>;
  deadlineMs: number;
  recipeById: Map<string, Recipe>;
}): {
  ok: boolean;
  days: ConstructorDay[];
  checked: number;
  timedOut: boolean;
  message: string | null;
} | null {
  const pool: PoolDay[] = [];
  const seen = new Set<string>();
  let checked = 0;
  for (let pass = 0; pass < 2 && Date.now() < params.deadlineMs - 6_000 && pool.length < 120; pass += 1) {
    const found = buildExactWeek({
      ctx: params.ctx,
      mode: params.mode,
      targets: params.targets,
      tolerance: params.tolerance,
      days: 7,
      seed: params.seed + pass * 997,
      excluded: params.excluded,
      deadlineMs: Math.min(params.deadlineMs - 4_000, Date.now() + (pass === 0 ? 18_000 : 12_000)),
      harvest: true,
      harvestLimit: 90,
    });
    checked += found.checked;
    for (const day of found.days) {
      const packed = toPoolDay(day, params.recipeById);
      if (seen.has(packed.key)) continue;
      seen.add(packed.key);
      pool.push(packed);
    }
  }
  const poolMains = new Set(pool.flatMap((day) => day.mainIds));
  const poolSnacks = new Set(pool.flatMap((day) => day.snackIds));
  if (process.env.NUTRITION_PLAN_TRACE) {
    console.error(`global pool ${pool.length} mains ${poolMains.size} snacks ${poolSnacks.size}`);
  }
  if (pool.length < params.days) return null;
  const rarity = new Map<string, number>();
  for (const day of pool) {
    for (const id of day.ids) rarity.set(id, (rarity.get(id) ?? 0) + 1);
  }
  const chosen = beamMonth(pool, params.recipeById, params.days, rarity);
  if (process.env.NUTRITION_PLAN_TRACE) console.error(`global beam ${chosen ? "yes" : "no"}`);
  if (!chosen) return null;
  reportNutritionProgress({
    stage: "Проверка разнообразия",
    progress: 94,
    found: params.days,
    total: params.days,
  });
  return { ok: true, days: chosen, checked, timedOut: false, message: null };
}

function beamMonth(
  pool: PoolDay[],
  recipeById: Map<string, Recipe>,
  days: number,
  rarity: Map<string, number>,
): ConstructorDay[] | null {
  type Node = {
    days: ConstructorDay[];
    counts: Map<string, number>;
    last: Map<string, LastUse>;
    weekIds: Set<string>;
    weekGroups: Set<string>;
    weekSignatures: Set<string>;
    usedKeys: Set<string>;
    score: number;
  };
  const mainSlots = pool[0]?.mainIds.length ?? 1;
  const snackSlots = pool[0]?.snackIds.length ?? 0;
  const poolMains = new Set(pool.flatMap((day) => day.mainIds));
  const poolSnacks = new Set(pool.flatMap((day) => day.snackIds));
  const dead = new Set<string>();
  let beam: Node[] = [
    {
      days: [],
      counts: new Map(),
      last: new Map(),
      weekIds: new Set(),
      weekGroups: new Set(),
      weekSignatures: new Set(),
      usedKeys: new Set(),
      score: 0,
    },
  ];
  const usable = (node: Node, index: number) => {
    const left = days - index;
    let mains = 0;
    let snacks = 0;
    for (const id of poolMains) mains += 2 - (node.counts.get(id) ?? 0);
    for (const id of poolSnacks) snacks += 2 - (node.counts.get(id) ?? 0);
    return mains >= left * mainSlots && snacks >= left * snackSlots;
  };
  for (let index = 0; index < days; index += 1) {
    const weekday = index % 7;
    const next: Node[] = [];
    for (const node of beam) {
      const weekIds = weekday === 0 ? new Set<string>() : node.weekIds;
      const weekGroups = weekday === 0 ? new Set<string>() : node.weekGroups;
      const weekSignatures = weekday === 0 ? new Set<string>() : node.weekSignatures;
      const stateKey = `${index}|${[...node.counts.entries()].sort().join(",")}|${[...weekGroups].sort().join(",")}`;
      if (dead.has(stateKey)) continue;
      const options: Array<{ item: PoolDay; score: number }> = [];
      for (const item of pool) {
        if (node.usedKeys.has(item.key)) continue;
        if (item.ids.some((id) => weekIds.has(id) || (node.counts.get(id) ?? 0) >= 2)) continue;
        if (item.groups.some((group) => weekGroups.has(group))) continue;
        if (item.signatures.some((signature) => weekSignatures.has(signature))) continue;
        const repeat = item.day.items.some((meal) => {
          const prev = node.last.get(meal.recipe_id);
          if (!prev) return false;
          if (index - prev.dayIndex < 7) return true;
          return prev.weekday === weekday && prev.slot === meal.slot;
        });
        if (repeat) continue;
        const previousDay = weekday === 0 ? undefined : node.days[index - 1];
        if (previousDay && adjacentClash(previousDay, item.day, recipeById)) continue;
        const eggs =
          node.days.slice(index - weekday, index).filter((day) =>
            day.items.some((meal) => meal.slot === "main1" && recipeById.get(meal.recipe_id)?.primary_protein === "egg"),
          ).length +
          (item.day.items.some((meal) => meal.slot === "main1" && recipeById.get(meal.recipe_id)?.primary_protein === "egg") ? 1 : 0);
        if (eggs > 2) continue;
        if (weekday === 6 && index >= 7) {
          const previousWeek = node.days.slice(index - 13, index - 6);
          const trial = [...node.days.slice(index - 6, index), { ...item.day, day_index: index }];
          if (mealDifferenceRatio(previousWeek, trial) < MIN_WEEK_DIFFERENCE) continue;
        }
        let score = 0;
        for (const id of item.ids) {
          const count = node.counts.get(id) ?? 0;
          score += count === 0 ? 4 + 8 / (rarity.get(id) ?? 1) : index < 14 ? -12 : -2;
        }
        options.push({ item, score });
      }
      options.sort((a, b) => b.score - a.score);
      if (options.length === 0) {
        dead.add(stateKey);
        continue;
      }
      for (const option of options.slice(0, 5)) {
        const counts = new Map(node.counts);
        const last = new Map(node.last);
        const nextIds = new Set(weekIds);
        const nextGroups = new Set(weekGroups);
        const nextSignatures = new Set(weekSignatures);
        for (const id of option.item.ids) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
          nextIds.add(id);
          last.set(id, {
            dayIndex: index,
            weekday,
            slot: option.item.day.items.find((meal) => meal.recipe_id === id)?.slot ?? "",
          });
        }
        for (const group of option.item.groups) nextGroups.add(group);
        for (const signature of option.item.signatures) nextSignatures.add(signature);
        const draft: Node = {
          days: [...node.days, { ...option.item.day, day_index: index }],
          counts,
          last,
          weekIds: nextIds,
          weekGroups: nextGroups,
          weekSignatures: nextSignatures,
          usedKeys: new Set(node.usedKeys).add(option.item.key),
          score: node.score + option.score,
        };
        if (!usable(draft, index + 1)) continue;
        next.push(draft);
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, 8);
    if (beam.length === 0) return null;
  }
  for (const node of beam) {
    const invalid = node.days.some((_, week) => {
      if ((week + 1) % 7 !== 0) return false;
      const slice = node.days.slice(week - 6, week + 1);
      return Boolean(evaluateStrictWeekVariety(slice, recipeById, { allowRepeats: false }));
    });
    if (invalid || repeatSpacingIssues(node.days)) continue;
    return node.days;
  }
  return null;
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
  const lastUse = new Map<string, LastUse>();
  let checked = 0;
  let timedOut = false;
  reportNutritionProgress({
    stage: "Подготовка каталога",
    progress: 2,
    found: 0,
    total: params.days,
  });

  if (params.targets.kcal.toNumber() < 1700) {
    const global = planGlobalMonth({ ...params, recipeById });
    if (global?.ok) return global;
  }

  for (let week = 0; week < weeks; week += 1) {
    if (Date.now() >= params.deadlineMs) {
      timedOut = true;
      break;
    }
    const spent = new Set<string>();
    for (const [id, count] of useCount) {
      if (count >= 2) spent.add(id);
    }
    const previous = week > 0 ? all.slice((week - 1) * 7, week * 7) : null;
    const previousIds = new Set(previous?.flatMap((day) => day.items.map((item) => item.recipe_id)) ?? []);
    const attempts: Array<Set<string>> =
      previous === null
        ? [spent]
        : params.targets.kcal.toNumber() < 1700
          ? []
          : [new Set([...spent, ...previousIds])];
    const remainingWeeks = weeks - week;
    const reserveLater = (remainingWeeks - 1) * 8_000;
    const slice = Math.min(35_000, Math.max(12_000, params.deadlineMs - Date.now() - reserveLater));
    const weekDeadline = Math.min(params.deadlineMs, Date.now() + slice);
    let placed: ConstructorDay[] | null = null;
    let found = 0;
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      if (Date.now() >= params.deadlineMs) {
        timedOut = true;
        break;
      }
      const disjointLook = attempt === 0 && previous !== null;
      const budget = disjointLook
        ? params.targets.kcal.toNumber() < 1700
          ? 8_000
          : 18_000
        : Math.max(0, weekDeadline - Date.now());
      if (budget < 1_500) break;
      const built = buildExactWeek({
        ctx: params.ctx,
        mode: params.mode,
        targets: params.targets,
        tolerance: params.tolerance,
        days: 7,
        seed: params.seed + week * 97 + attempt * 1009,
        excluded: params.excluded,
        deadlineMs: Math.min(params.deadlineMs, Date.now() + budget),
        blockedRecipeIds: attempts[attempt],
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
      timedOut = timedOut || (built.timedOut && Date.now() >= params.deadlineMs);
      found = Math.max(found, orderExactDays(built.days, params.ctx.recipes as Recipe[], 7).length);
      const ordered = orderExactDays(built.days, params.ctx.recipes as Recipe[], 7);
      if (ordered.length < 7) continue;
      if (evaluateStrictWeekVariety(ordered, recipeById, { allowRepeats: false })) continue;
      placed = placeWeek(ordered, previous, week * 7, recipeById, lastUse);
      if (process.env.NUTRITION_PLAN_TRACE) {
        console.error(
          `week ${week + 1} attempt ${attempt} days ${ordered.length} placed ${placed ? "yes" : "no"}`,
        );
      }
      if (placed) break;
    }
    if (!placed && previous && Date.now() < params.deadlineMs - 4_000) {
      placed = assembleAnchoredWeek({
        ctx: params.ctx,
        mode: params.mode,
        targets: params.targets,
        tolerance: params.tolerance,
        seed: params.seed + week * 97 + 50,
        excluded: params.excluded,
        deadlineMs: Math.min(params.deadlineMs, Date.now() + 52_000),
        weekStart: week * 7,
        spent,
        forbidden,
        lastUse,
        previous,
        recipeById,
      });
      if (process.env.NUTRITION_PLAN_TRACE) {
        console.error(`week ${week + 1} anchored ${placed ? "yes" : "no"}`);
      }
    }
    if (!placed) {
      return {
        ok: false,
        days: [],
        checked,
        timedOut,
        message: `Точных дней с допустимым повтором: ${all.length + found} из ${params.days}`,
      };
    }
    for (const day of placed) {
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
        const weekday = day.day_index % 7;
        lastUse.set(item.recipe_id, { dayIndex: day.day_index, weekday, slot: item.slot });
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
    all.push(...placed);
  }

  if (all.length !== params.days) {
    return {
      ok: false,
      days: [],
      checked,
      timedOut,
      message: timedOut
        ? "Поиск точных дней остановлен по времени"
        : `Точных дней с допустимым повтором: ${all.length} из ${params.days}`,
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
