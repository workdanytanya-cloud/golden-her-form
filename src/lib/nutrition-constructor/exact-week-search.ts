import { slotsForMode, type MealScheduleMode, type PlanSlot } from "@/lib/nutrition-constructor/config";
import { buildIngredientLine, buildMealPlanItem } from "@/lib/nutrition-constructor/calculator";
import { snapshotMacro, withinTolerance, type MacroBreakdown } from "@/lib/nutrition-constructor/decimal-math";
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
  return recipe.meal_types.includes(slotMealRole(slot));
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
    if (recipe.meal_type !== "snack" && recipe.primary_protein && recipe.primary_protein !== "none") {
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
      if (slot.startsWith("main") && !lines.some((line) => line.product_name.toLowerCase().includes("масло"))) {
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
    for (const recipe of chosen) {
      usedIds.add(recipe.id);
      if (recipe.variant_group) usedGroups.add(recipe.variant_group);
      if (recipe.ingredient_signature) usedSignatures.add(recipe.ingredient_signature);
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
    return distance(combine(a, mainSlots.length)) - distance(combine(b, mainSlots.length));
  });
  const snackPlans = (mainCombo: Recipe[]): Recipe[][] => {
    if (snackSlots.length === 0) return [[]];
    const eligible = snacks.filter((recipe) => !blocked(recipe) && !conflicts([...mainCombo, recipe]));
    const pick = (key: "p" | "f" | "c", count: number) =>
      [...eligible].sort((a, b) => midpoint(b)[key] - midpoint(a)[key]).slice(0, count);
    const perMacro = snackSlots.length >= 3 ? 6 : 4;
    const shortlist = new Map<string, Recipe>();
    for (const recipe of [...pick("p", perMacro), ...pick("f", perMacro), ...pick("c", perMacro)]) {
      shortlist.set(recipe.id, recipe);
    }
    const plans: Recipe[][] = [];
    if (snackSlots.length >= 3) {
      const sample = (key: "p" | "f" | "c", indexes: number[]) => {
        const sorted = [...eligible].sort((a, b) => midpoint(b)[key] - midpoint(a)[key]);
        return indexes.map((index) => sorted[index]).filter((recipe): recipe is Recipe => Boolean(recipe));
      };
      const proteins = sample("p", [0, 1, 2, 4, 7]);
      const fats = sample("f", [1, 3, 5, 8, 12]);
      const carbs = sample("c", [0, 1, 3, 6]);
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
    } else {
      plans.push(
        ...[...combinations([...shortlist.values()], snackSlots.length)].filter(
          (combo) => !conflicts([...mainCombo, ...combo]),
        ),
      );
    }
    plans.sort(
      (a, b) =>
        distance(combine([...mainCombo, ...a], mainSlots.length)) -
        distance(combine([...mainCombo, ...b], mainSlots.length)),
    );
    const almost = pool.length >= params.days - 1;
    return plans.slice(0, snackSlots.length >= 3 ? (almost ? 80 : 60) : almost ? 28 : 12);
  };

  const targetPool = params.days + 3;
  for (let round = 0; round < 2 && pool.length < targetPool && Date.now() < params.deadlineMs; round++) {
    for (const mainCombo of mainCombos) {
      if (Date.now() > params.deadlineMs || pool.length >= targetPool) break;
      if (mainCombo.some(blocked)) continue;
      const before = pool.length;
      if (snackSlots.length === 0) {
        tryRecipes(mainCombo);
        continue;
      }
      for (const snackCombo of snackPlans(mainCombo)) {
        if (Date.now() > params.deadlineMs || pool.length >= targetPool) break;
        tryRecipes([...mainCombo, ...snackCombo]);
        if (pool.length > before) break;
      }
    }
  }

  return {
    days: pool,
    checked,
    exactDays: pool.length,
    timedOut: Date.now() > params.deadlineMs && pool.length < params.days,
  };
}

export function orderExactDays(days: ConstructorDay[], recipes: Recipe[], count: number): ConstructorDay[] {
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
        day.items.some((item) => item.slot === "main1" && byId.get(item.recipe_id)?.primary_protein === "egg"),
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
