import {
  slotsForMode,
  type MealScheduleMode,
  type PlanSlot,
} from "@/lib/nutrition-constructor/config";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import {
  snapshotMacro,
  withinTolerance,
  type MacroBreakdown,
} from "@/lib/nutrition-constructor/decimal-math";
import { fitDayItems } from "@/lib/nutrition-constructor/macro-solver";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { isAutoGenerationEligible } from "@/lib/nutrition-constructor/recipe-selection";
import { slotMealRole } from "@/lib/nutrition-constructor/recipe-variety";
import { seededShuffle } from "@/lib/nutrition-constructor/target-validation";
import type { ConstructorDay, Recipe } from "@/lib/nutrition-constructor/types";

export type ExactWeekResult = {
  days: ConstructorDay[];
  checked: number;
  exactDays: number;
  timedOut: boolean;
};

function fitsSlot(recipe: Recipe, slot: PlanSlot): boolean {
  return (recipe.meal_types ?? []).includes(slotMealRole(slot));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.filter((_, index) => index !== i);
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}

function assignSlots(recipes: Recipe[], slots: PlanSlot[]): Recipe[] | null {
  for (const order of permutations(recipes)) {
    if (order.every((recipe, index) => fitsSlot(recipe, slots[index]!))) return order;
  }
  return null;
}

function conflicts(recipes: Recipe[]): boolean {
  const ids = new Set<string>();
  const groups = new Set<string>();
  const signatures = new Set<string>();
  const proteins: string[] = [];
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) return true;
    ids.add(recipe.id);
    if (recipe.variant_group) {
      if (groups.has(recipe.variant_group)) return true;
      groups.add(recipe.variant_group);
    }
    if (recipe.ingredient_signature) {
      if (signatures.has(recipe.ingredient_signature)) return true;
      signatures.add(recipe.ingredient_signature);
    }
    if (
      recipe.meal_type !== "snack" &&
      recipe.primary_protein &&
      recipe.primary_protein !== "none"
    ) {
      if (proteins.includes(recipe.primary_protein)) return true;
      proteins.push(recipe.primary_protein);
    }
  }
  return false;
}

function* combinations<T>(items: T[], count: number): Generator<T[]> {
  const index = Array.from({ length: count }, (_, i) => i);
  if (count === 0 || count > items.length) return;
  while (true) {
    yield index.map((i) => items[i]!);
    let pos = count - 1;
    while (pos >= 0 && index[pos] === items.length - count + pos) pos -= 1;
    if (pos < 0) return;
    index[pos]! += 1;
    for (let i = pos + 1; i < count; i++) index[i] = index[i - 1]! + 1;
  }
}

export function buildExactWeek(params: {
  ctx: OptimizerContext;
  mode: MealScheduleMode;
  targets: MacroBreakdown;
  tolerance: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  days: number;
  seed: number;
  excluded: Set<string>;
  deadlineMs: number;
}): ExactWeekResult {
  const slots = slotsForMode(params.mode);
  const mainSlots = slots.filter((slot) => slot.startsWith("main"));
  const snackSlots = slots.filter((slot) => slot.startsWith("snack"));
  const allowed = (recipe: Recipe) => {
    if (!recipe.is_active || !isAutoGenerationEligible(recipe)) return false;
    if (!recipe.allowed_schedule_modes.includes(params.mode)) return false;
    return (params.ctx.recipeIngredients.get(recipe.id) ?? []).every(
      (ingredient) => !params.excluded.has(ingredient.product_id),
    );
  };
  const mains = seededShuffle(params.ctx.mainRecipes.filter(allowed), params.seed);
  const snacks = seededShuffle(
    params.ctx.snackRecipes.filter(
      (recipe) => allowed(recipe) && (snackSlots.length === 0 || !recipe.requires_cooking),
    ),
    params.seed + 17,
  );
  const pool: ConstructorDay[] = [];
  const usedIds = new Set<string>();
  const usedGroups = new Set<string>();
  const usedSignatures = new Set<string>();
  let checked = 0;
  const dayCtx = {
    products: params.ctx.products,
    recipeIngredients: params.ctx.recipeIngredients,
    recipes: params.ctx.recipes,
  };

  const rateOf = (productId: string) => {
    const product = params.ctx.products.get(productId);
    if (!product) return null;
    return {
      kcal: Number(product.kcal_per_100g) / 100,
      protein: Number(product.protein_per_100g) / 100,
      fat: Number(product.fat_per_100g) / 100,
      carbs: Number(product.carbs_per_100g) / 100,
    };
  };
  const targetOk = (chosen: Recipe[]) => {
    const range = { minK: 0, maxK: 0, minP: 0, maxP: 0, minF: 0, maxF: 0, minC: 0, maxC: 0 };
    chosen.forEach((recipe, index) => {
      for (const ingredient of params.ctx.recipeIngredients.get(recipe.id) ?? []) {
        const rate = rateOf(ingredient.product_id);
        if (!rate) return;
        const lo = ingredient.min_g;
        const hi = ingredient.max_g;
        const a = { k: rate.kcal * lo, p: rate.protein * lo, f: rate.fat * lo, c: rate.carbs * lo };
        const b = { k: rate.kcal * hi, p: rate.protein * hi, f: rate.fat * hi, c: rate.carbs * hi };
        range.minK += Math.min(a.k, b.k);
        range.maxK += Math.max(a.k, b.k);
        range.minP += Math.min(a.p, b.p);
        range.maxP += Math.max(a.p, b.p);
        range.minF += Math.min(a.f, b.f);
        range.maxF += Math.max(a.f, b.f);
        range.minC += Math.min(a.c, b.c);
        range.maxC += Math.max(a.c, b.c);
      }
      if (index < mainSlots.length) {
        range.maxK += 8.84 * 15;
        range.maxF += 15;
      }
    });
    const k = params.targets.kcal.toNumber();
    const p = params.targets.protein_g.toNumber();
    const f = params.targets.fat_g.toNumber();
    const c = params.targets.carbs_g.toNumber();
    return (
      range.minK - 8 <= k &&
      k <= range.maxK + 8 &&
      range.minP - 2 <= p &&
      p <= range.maxP + 2 &&
      range.minF - 2 <= f &&
      f <= range.maxF + 2 &&
      range.minC - 2 <= c &&
      c <= range.maxC + 2
    );
  };
  const tryRecipes = (chosen: Recipe[]) => {
    if (conflicts(chosen)) return;
    if (!targetOk(chosen)) return;
    if (
      !overlapMode &&
      chosen.some(
        (recipe) =>
          usedIds.has(recipe.id) ||
          (recipe.variant_group ? usedGroups.has(recipe.variant_group) : false) ||
          (recipe.ingredient_signature ? usedSignatures.has(recipe.ingredient_signature) : false),
      )
    ) {
      return;
    }
    const plans: Array<Map<PlanSlot, Recipe>> = [];
    const mainOrders = permutations(chosen.slice(0, mainSlots.length)).filter((order) =>
      order.every((recipe, index) => fitsSlot(recipe, mainSlots[index]!)),
    );
    const snackOrders =
      snackSlots.length === 0
        ? [[]]
        : permutations(chosen.slice(mainSlots.length)).filter((order) =>
            order.every((recipe, index) => fitsSlot(recipe, snackSlots[index]!)),
          );
    for (const mainOrder of mainOrders) {
      for (const snackOrder of snackOrders) {
        const bySlot = new Map<PlanSlot, Recipe>();
        mainSlots.forEach((slot, index) => bySlot.set(slot, mainOrder[index]!));
        snackSlots.forEach((slot, index) => bySlot.set(slot, snackOrder[index]!));
        plans.push(bySlot);
      }
    }
    const neighborOk = (bySlot: Map<PlanSlot, Recipe>) => {
      const previous = pool[pool.length - 1];
      if (!previous) return true;
      return !mainSlots.some((slot) => {
        const prevItem = previous.items.find((item) => item.slot === slot);
        const prevRecipe = params.ctx.recipes.find((recipe) => recipe.id === prevItem?.recipe_id);
        const nextRecipe = bySlot.get(slot);
        if (!prevRecipe || !nextRecipe) return false;
        if (
          prevRecipe.primary_protein &&
          nextRecipe.primary_protein &&
          prevRecipe.primary_protein === nextRecipe.primary_protein &&
          nextRecipe.primary_protein !== "none"
        ) {
          return true;
        }
        return Boolean(
          prevRecipe.primary_carb &&
          nextRecipe.primary_carb &&
          prevRecipe.primary_carb === nextRecipe.primary_carb &&
          !["veg", "none"].includes(nextRecipe.primary_carb),
        );
      });
    };
    const bySlot = plans.find((plan) => pool.length >= params.days - 1 || neighborOk(plan));
    if (!bySlot) return;
    checked += 1;
    const items = slots.map((slot) => {
      const recipe = bySlot.get(slot)!;
      const lines = (params.ctx.recipeIngredients.get(recipe.id) ?? []).map((ingredient, index) =>
        buildIngredientLine(
          params.ctx.products.get(ingredient.product_id)!,
          ingredient.default_g ?? ingredient.min_g,
          index,
        ),
      );
      if (
        slot.startsWith("main") &&
        !lines.some((line) => line.product_name.toLowerCase().includes("масло"))
      ) {
        const oil = [...params.ctx.products.values()].find(
          (product) => product.slug === "olive-oil" && !params.excluded.has(product.id),
        );
        if (oil) lines.push(buildIngredientLine(oil, 5, lines.length));
      }
      return buildMealPlanItem({ slot, recipe, ingredients: lines });
    });
    const fitted = fitDayItems({
      ctx: dayCtx,
      items,
      targets: params.targets,
      tolerance: params.tolerance,
      passes: mainSlots.length >= 3 ? 3 : 2,
    });
    if (!fitted.valid) return;
    const positiveItems = fitted.items.map((item) => ({
      ...item,
      ingredients: item.ingredients.filter((line) => Number(line.grams) > 0),
    }));
    if (positiveItems.some((item) => item.ingredients.length === 0)) return;
    const snap = snapshotMacro(fitted.totals);
    if (
      !withinTolerance(
        {
          kcal: fitted.totals.kcal,
          protein_g: fitted.totals.protein_g,
          fat_g: fitted.totals.fat_g,
          carbs_g: fitted.totals.carbs_g,
          fiber_g: fitted.totals.fiber_g,
        },
        params.targets,
        params.tolerance,
      )
    ) {
      return;
    }
    const eggBreakfasts =
      pool.filter((day) =>
        day.items.some((item) => {
          const recipe = params.ctx.recipes.find((entry) => entry.id === item.recipe_id);
          return item.slot === "main1" && recipe?.primary_protein === "egg";
        }),
      ).length + (bySlot.get("main1")?.primary_protein === "egg" ? 1 : 0);
    if (eggBreakfasts > 3) return;
    const slotOverused = [...bySlot.entries()].some(([slot, recipe]) => {
      if (!slot.startsWith("main") || !recipe) return false;
      const same = (kind: "protein" | "carb", value: string | null | undefined) => {
        if (!value || value === "none" || value === "veg") return 0;
        return pool.filter((day) =>
          day.items.some((item) => {
            if (item.slot !== slot) return false;
            const previous = params.ctx.recipes.find((entry) => entry.id === item.recipe_id);
            return kind === "protein"
              ? previous?.primary_protein === value
              : previous?.primary_carb === value;
          }),
        ).length;
      };
      const carbCap = snackSlots.length === 0 ? 2 : 3;
      return (
        same("protein", recipe.primary_protein) >= 3 || same("carb", recipe.primary_carb) >= carbCap
      );
    });
    if (mainSlots.length >= 2 && goal.k >= 2600 && slotOverused) return;
    if (!overlapMode) {
      for (const recipe of chosen) {
        usedIds.add(recipe.id);
        if (recipe.variant_group) usedGroups.add(recipe.variant_group);
        if (recipe.ingredient_signature) usedSignatures.add(recipe.ingredient_signature);
      }
    }
    pool.push({
      day_index: pool.length,
      day_note: null,
      items: positiveItems,
      kcal: String(snap.kcal),
      protein_g: String(snap.protein_g),
      fat_g: String(snap.fat_g),
      carbs_g: String(snap.carbs_g),
      fiber_g: String(snap.fiber_g),
      is_valid: true,
    });
  };

  type Macro4 = { k: number; p: number; f: number; c: number };
  const macroCache = new Map<string, Macro4>();
  const midpoint = (recipe: Recipe): Macro4 => {
    const cached = macroCache.get(recipe.id);
    if (cached) return cached;
    const total = { k: 0, p: 0, f: 0, c: 0 };
    for (const ingredient of params.ctx.recipeIngredients.get(recipe.id) ?? []) {
      const rate = rateOf(ingredient.product_id);
      if (!rate) continue;
      const grams = ingredient.default_g ?? (ingredient.min_g + ingredient.max_g) / 2;
      total.k += rate.kcal * grams;
      total.p += rate.protein * grams;
      total.f += rate.fat * grams;
      total.c += rate.carbs * grams;
    }
    macroCache.set(recipe.id, total);
    return total;
  };
  const combine = (recipes: Recipe[], oilMains: number): Macro4 => {
    const total = { k: oilMains * 8.84 * 8, p: 0, f: oilMains * 8, c: 0 };
    for (const recipe of recipes) {
      const macro = midpoint(recipe);
      total.k += macro.k;
      total.p += macro.p;
      total.f += macro.f;
      total.c += macro.c;
    }
    return total;
  };
  const rangeCache = new Map<string, { min: Macro4; max: Macro4 }>();
  const rangeOf = (recipe: Recipe) => {
    const cached = rangeCache.get(recipe.id);
    if (cached) return cached;
    const min = { k: 0, p: 0, f: 0, c: 0 };
    const max = { k: 0, p: 0, f: 0, c: 0 };
    for (const ingredient of params.ctx.recipeIngredients.get(recipe.id) ?? []) {
      const rate = rateOf(ingredient.product_id);
      if (!rate) continue;
      const add = (target: Macro4, grams: number) => {
        target.k += rate.kcal * grams;
        target.p += rate.protein * grams;
        target.f += rate.fat * grams;
        target.c += rate.carbs * grams;
      };
      add(min, ingredient.min_g);
      add(max, ingredient.max_g);
    }
    const value = { min, max };
    rangeCache.set(recipe.id, value);
    return value;
  };
  const span = (recipes: Recipe[], oilMains: number) => {
    const min = { k: 0, p: 0, f: 0, c: 0 };
    const max = { k: oilMains * 8.84 * 15, p: 0, f: oilMains * 15, c: 0 };
    for (const recipe of recipes) {
      const range = rangeOf(recipe);
      min.k += range.min.k;
      min.p += range.min.p;
      min.f += range.min.f;
      min.c += range.min.c;
      max.k += range.max.k;
      max.p += range.max.p;
      max.f += range.max.f;
      max.c += range.max.c;
    }
    return { min, max };
  };
  const bandScore = (recipes: Recipe[], oilMains: number) => {
    const mid = distance(combine(recipes, oilMains));
    const { min, max } = span(recipes, oilMains);
    let penalty = mid;
    if (goal.k >= 2600) {
      if (max.p < goal.p - 4) penalty += (goal.p - max.p) * 12;
      if (max.c < goal.c - 8) penalty += (goal.c - max.c) * 6;
      if (max.k < goal.k - 40) penalty += (goal.k - max.k) / 18;
      if (min.f > goal.f + 12) penalty += (min.f - goal.f) * 4;
    } else if ((goal.k <= 1700 || (goal.p <= 100 && goal.k <= 1900)) && min.k > goal.k + 40) {
      penalty += (min.k - goal.k) / 15;
    }
    if (goal.c < 140 && min.c > goal.c + 2) penalty += (min.c - goal.c) * 12;
    if (goal.c < 140 && max.p + 2 < goal.p) penalty += (goal.p - max.p) * 8;
    return penalty;
  };
  const goal = {
    k: params.targets.kcal.toNumber(),
    p: params.targets.protein_g.toNumber(),
    f: params.targets.fat_g.toNumber(),
    c: params.targets.carbs_g.toNumber(),
  };
  const distance = (total: Macro4) =>
    Math.abs(total.k - goal.k) / 35 +
    Math.abs(total.p - goal.p) * 3 +
    Math.abs(total.f - goal.f) * 3 +
    Math.abs(total.c - goal.c) * 1.5;
  const blocked = (recipe: Recipe) =>
    usedIds.has(recipe.id) ||
    (recipe.variant_group ? usedGroups.has(recipe.variant_group) : false) ||
    (recipe.ingredient_signature ? usedSignatures.has(recipe.ingredient_signature) : false);
  const mainCombos: Recipe[][] = [];
  for (const combo of combinations(mains, mainSlots.length)) {
    if (conflicts(combo) || !assignSlots(combo, mainSlots)) continue;
    mainCombos.push(combo);
  }
  const preferredMains = [
    "breakfast-beef-oats-pepper",
    "breakfast-thigh-pasta-pepper",
    "breakfast-beef-potato-pepper",
    "breakfast-thigh-rice-pepper",
    "breakfast-beef-couscous-pepper",
    "breakfast-thigh-couscous-pepper",
    "beef-rice-vegetables",
    "breakfast-turkey-pasta-pepper",
  ];
  mainCombos.sort((a, b) => {
    const rank = (combo: Recipe[]) => {
      const index = preferredMains.indexOf(combo[0]?.slug ?? "");
      return index === -1 ? 100 : index;
    };
    const byPreference = rank(a) - rank(b);
    const preferKnownPlates = mainSlots.length === 1 && goal.k >= 1650 && goal.k <= 1950;
    if (preferKnownPlates && byPreference !== 0) return byPreference;
    return bandScore(a, mainSlots.length) - bandScore(b, mainSlots.length);
  });
  const snackPlans = (mainCombo: Recipe[]): Recipe[][] => {
    if (snackSlots.length === 0) return [[]];
    const eligible = snacks.filter(
      (recipe) => (overlapMode || !blocked(recipe)) && !conflicts([...mainCombo, recipe]),
    );
    const pick = (key: "p" | "f" | "c", count: number) =>
      [...eligible].sort((a, b) => midpoint(b)[key] - midpoint(a)[key]).slice(0, count);
    const perMacro = snackSlots.length >= 3 ? 6 : 4;
    const shortlist = new Map<string, Recipe>();
    for (const recipe of [...pick("p", perMacro), ...pick("f", perMacro), ...pick("c", perMacro)]) {
      shortlist.set(recipe.id, recipe);
    }
    const plans: Recipe[][] = [];
    if (snackSlots.length >= 3 && goal.k >= 2400) {
      const hearty = [...eligible]
        .sort((a, b) => {
          const score = (recipe: Recipe) => {
            const macro = midpoint(recipe);
            return macro.c * 5 + macro.p * 2 + macro.k / 40;
          };
          return score(b) - score(a);
        })
        .slice(0, goal.k >= 3200 ? 22 : 15);
      for (const combo of combinations(hearty, snackSlots.length)) {
        if (conflicts([...mainCombo, ...combo])) continue;
        plans.push(combo);
      }
    } else if (snackSlots.length >= 3 && goal.c < 140) {
      const lean = [...eligible]
        .filter((recipe) => midpoint(recipe).c <= 16 && midpoint(recipe).p >= 6)
        .sort((a, b) => midpoint(b).p - midpoint(a).p)
        .slice(0, 8);
      plans.push(
        ...[...combinations(lean, 3)].filter((combo) => !conflicts([...mainCombo, ...combo])),
      );
    } else if (snackSlots.length >= 3) {
      const light = goal.k <= 1700;
      const sample = (key: "p" | "f" | "c", indexes: number[], ascending = false) => {
        const sorted = [...eligible].sort((a, b) =>
          ascending ? midpoint(a)[key] - midpoint(b)[key] : midpoint(b)[key] - midpoint(a)[key],
        );
        return indexes
          .map((index) => sorted[index])
          .filter((recipe): recipe is Recipe => Boolean(recipe));
      };
      const proteins = sample("p", light ? [1, 2, 4, 6, 8] : [0, 1, 2, 4, 7], light);
      const fats = sample(
        "f",
        light ? [1, 3, 5, 8, 11] : goal.k >= 2600 ? [0, 1, 2, 4, 6] : [1, 3, 5, 8, 12],
        light,
      );
      const carbs = sample(
        "c",
        light ? [1, 2, 4, 7] : goal.k >= 2600 ? [0, 1, 2, 4] : [0, 1, 3, 6],
        light,
      );
      for (const proteinSnack of proteins) {
        for (const fatSnack of fats) {
          for (const carbSnack of carbs) {
            const unique = new Map(
              [proteinSnack, fatSnack, carbSnack].map((recipe) => [recipe.id, recipe]),
            );
            if (unique.size < snackSlots.length) continue;
            const combo = [...unique.values()];
            if (conflicts([...mainCombo, ...combo])) continue;
            plans.push(combo);
          }
        }
      }
    } else if (snackSlots.length === 2 && (goal.k <= 1700 || (goal.p <= 100 && goal.k <= 1900))) {
      const light = [...eligible]
        .filter((recipe) => {
          const macro = midpoint(recipe);
          return (
            macro.k <= 280 && macro.p >= 4 && macro.p <= 30 && (goal.c >= 140 || macro.c <= 35)
          );
        })
        .sort((a, b) => midpoint(a).k - midpoint(b).k);
      const varied = [
        ...light.slice(0, 6),
        ...[...light].sort((a, b) => midpoint(b).p - midpoint(a).p).slice(0, 6),
      ];
      const uniqueLight = [...new Map(varied.map((recipe) => [recipe.id, recipe])).values()];
      plans.push(
        ...[...combinations(uniqueLight, 2)].filter(
          (combo) => !conflicts([...mainCombo, ...combo]),
        ),
      );
    } else {
      plans.push(
        ...[...combinations([...shortlist.values()], snackSlots.length)].filter(
          (combo) => !conflicts([...mainCombo, ...combo]),
        ),
      );
    }
    plans.sort(
      (a, b) =>
        bandScore([...mainCombo, ...a], mainSlots.length) -
        bandScore([...mainCombo, ...b], mainSlots.length),
    );
    const almost = pool.length >= params.days - 1;
    return plans.slice(
      0,
      snackSlots.length >= 3
        ? almost
          ? 80
          : goal.c < 140
            ? 24
            : 60
        : almost
          ? 16
          : goal.c < 140
            ? 12
            : goal.k <= 1700
              ? 6
              : 14,
    );
  };

  let overlapMode = false;
  const overlap: ConstructorDay[] = [];
  const seenKeys = new Set<string>();
  const targetPool = params.days + 3;
  const phase1Until = Math.min(params.deadlineMs, Date.now() + (goal.k >= 2800 ? 20_000 : 24_000));
  const acceptKey = (chosen: Recipe[]) =>
    chosen
      .map((recipe) => recipe.id)
      .sort()
      .join("|");
  const originalTry = tryRecipes;
  const remember = (chosen: Recipe[]) => {
    const key = acceptKey(chosen);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  };
  for (let round = 0; round < 2 && pool.length < targetPool && Date.now() < phase1Until; round++) {
    for (const mainCombo of mainCombos) {
      if (Date.now() > phase1Until || pool.length >= targetPool) break;
      if (mainCombo.some(blocked)) continue;
      const before = pool.length;
      if (snackSlots.length === 0) {
        if (remember(mainCombo)) originalTry(mainCombo);
        continue;
      }
      for (const snackCombo of snackPlans(mainCombo)) {
        if (Date.now() > phase1Until || pool.length >= targetPool) break;
        const chosen = [...mainCombo, ...snackCombo];
        if (!remember(chosen)) continue;
        originalTry(chosen);
        if (pool.length > before) break;
      }
    }
  }
  const needsAlternatives =
    pool.length < params.days ||
    (pool.length >= params.days &&
      orderExactDays(pool, params.ctx.recipes, params.days).length < params.days);
  if (needsAlternatives && Date.now() < params.deadlineMs) {
    overlapMode = true;
    const savedPool = pool;
    const poolRecipeIds = new Set(pool.flatMap((day) => day.items.map((item) => item.recipe_id)));
    const capture = (chosen: Recipe[]) => {
      if (overlap.length >= 24 || !remember(chosen)) return;
      if (!chosen.some((recipe) => !poolRecipeIds.has(recipe.id))) return;
      const before = savedPool.length;
      originalTry(chosen);
      if (savedPool.length > before) {
        overlap.push(savedPool.pop()!);
      }
    };
    for (const mainCombo of mainCombos) {
      if (Date.now() > params.deadlineMs || overlap.length >= 16) break;
      if (snackSlots.length === 0) {
        capture(mainCombo);
        continue;
      }
      let added = 0;
      for (const snackCombo of snackPlans(mainCombo)) {
        if (Date.now() > params.deadlineMs || overlap.length >= 24 || added >= 3) break;
        const before = overlap.length;
        capture([...mainCombo, ...snackCombo]);
        if (overlap.length > before) added += 1;
      }
    }
  }
  const ordered = orderExactDays(pool, params.ctx.recipes, params.days);
  const packed =
    ordered.length === params.days
      ? pool
      : packDisjointDays([...pool, ...overlap], params.ctx.recipes, params.days);

  return {
    days: packed.length > 0 ? packed : pool,
    checked,
    exactDays: Math.max(pool.length, packed.length),
    timedOut:
      Date.now() > params.deadlineMs && packed.length < params.days && pool.length < params.days,
  };
}

function packDisjointDays(
  days: ConstructorDay[],
  recipes: Recipe[],
  count: number,
): ConstructorDay[] {
  if (days.length < count) return [];
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const chosen: ConstructorDay[] = [];
  const usedDay = new Set<number>();
  const ids = new Set<string>();
  const groups = new Set<string>();
  const signatures = new Set<string>();
  let eggs = 0;
  let nodes = 0;
  const touches = (day: ConstructorDay, add: boolean) => {
    for (const item of day.items) {
      const recipe = byId.get(item.recipe_id);
      if (add) ids.add(item.recipe_id);
      else ids.delete(item.recipe_id);
      if (recipe?.variant_group) {
        if (add) groups.add(recipe.variant_group);
        else groups.delete(recipe.variant_group);
      }
      if (recipe?.ingredient_signature) {
        if (add) signatures.add(recipe.ingredient_signature);
        else signatures.delete(recipe.ingredient_signature);
      }
      if (item.slot === "main1" && recipe?.primary_protein === "egg") eggs += add ? 1 : -1;
    }
  };
  const fits = (day: ConstructorDay) => {
    for (const item of day.items) {
      const recipe = byId.get(item.recipe_id);
      if (ids.has(item.recipe_id)) return false;
      if (recipe?.variant_group && groups.has(recipe.variant_group)) return false;
      if (recipe?.ingredient_signature && signatures.has(recipe.ingredient_signature)) return false;
    }
    const nextEggs =
      eggs +
      day.items.filter(
        (item) => item.slot === "main1" && byId.get(item.recipe_id)?.primary_protein === "egg",
      ).length;
    if (nextEggs > 2) return false;
    const prev = chosen[chosen.length - 1];
    if (!prev) return true;
    return !day.items.some((item) => {
      if (!item.slot.startsWith("main")) return false;
      const prevItem = prev.items.find((entry) => entry.slot === item.slot);
      const prevRecipe = prevItem ? byId.get(prevItem.recipe_id) : undefined;
      const recipe = byId.get(item.recipe_id);
      if (!prevRecipe || !recipe) return false;
      if (
        prevRecipe.primary_protein &&
        recipe.primary_protein &&
        prevRecipe.primary_protein === recipe.primary_protein &&
        recipe.primary_protein !== "none"
      ) {
        return true;
      }
      return Boolean(
        recipe.primary_carb &&
        prevRecipe.primary_carb &&
        recipe.primary_carb === prevRecipe.primary_carb &&
        !["veg", "none"].includes(recipe.primary_carb),
      );
    });
  };
  const visit = (): boolean => {
    if (chosen.length === count) return true;
    if (nodes++ > 40_000) return false;
    for (let index = 0; index < days.length; index++) {
      if (usedDay.has(index) || !fits(days[index]!)) continue;
      usedDay.add(index);
      chosen.push(days[index]!);
      touches(days[index]!, true);
      if (visit()) return true;
      touches(days[index]!, false);
      chosen.pop();
      usedDay.delete(index);
    }
    return false;
  };
  if (!visit()) return [];
  return chosen.map((day, index) => ({ ...day, day_index: index }));
}

export function orderExactDays(
  days: ConstructorDay[],
  recipes: Recipe[],
  count: number,
): ConstructorDay[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const chosen: ConstructorDay[] = [];
  const used = new Set<number>();
  const neighborOk = () => {
    if (chosen.length < 2) return true;
    const prev = chosen[chosen.length - 2]!;
    const curr = chosen[chosen.length - 1]!;
    return !curr.items.some((item) => {
      if (!item.slot.startsWith("main")) return false;
      const prevItem = prev.items.find((entry) => entry.slot === item.slot);
      const prevRecipe = prevItem ? byId.get(prevItem.recipe_id) : undefined;
      const recipe = byId.get(item.recipe_id);
      if (!prevRecipe || !recipe) return false;
      if (
        prevRecipe.primary_protein &&
        recipe.primary_protein &&
        prevRecipe.primary_protein === recipe.primary_protein &&
        recipe.primary_protein !== "none"
      ) {
        return true;
      }
      return Boolean(
        prevRecipe.primary_carb &&
        recipe.primary_carb &&
        prevRecipe.primary_carb === recipe.primary_carb &&
        !["veg", "none"].includes(recipe.primary_carb),
      );
    });
  };
  const visit = (): boolean => {
    if (chosen.length === count) return true;
    for (let index = 0; index < days.length; index++) {
      if (used.has(index)) continue;
      used.add(index);
      chosen.push({ ...days[index]!, day_index: chosen.length });
      const eggBreakfasts = chosen.filter((day) =>
        day.items.some(
          (item) => item.slot === "main1" && byId.get(item.recipe_id)?.primary_protein === "egg",
        ),
      ).length;
      const ok = neighborOk() && eggBreakfasts <= 2;
      if (ok && visit()) return true;
      chosen.pop();
      used.delete(index);
    }
    return false;
  };
  if (!visit()) return [];
  return chosen;
}
