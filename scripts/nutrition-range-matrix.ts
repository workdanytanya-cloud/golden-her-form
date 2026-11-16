import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_TOLERANCE, slotsForMode, type MealScheduleMode } from "@/lib/nutrition-constructor/config";
import { d } from "@/lib/nutrition-constructor/decimal-math";
import { dayMenuKey, mealDifferenceRatio } from "@/lib/nutrition-constructor/month-plan";
import { generateConstructorPlan } from "@/lib/nutrition-constructor/optimizer";
import { evaluateStrictWeekVariety } from "@/lib/nutrition-constructor/recipe-variety";
import { validateRecipeInstruction } from "@/lib/nutrition-constructor/recipe-instructions";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { consistentTargetsForKcal } from "@/lib/nutrition-constructor/target-validation";
import type { ConstructorDay, FoodProduct } from "@/lib/nutrition-constructor/types";

type CaseSpec = {
  id: string;
  days: 7 | 28;
  mode: MealScheduleMode;
  kcal: number;
  profile: string;
  excluded: string[];
  targets?: { protein_g: number; fat_g: number; carbs_g: number };
};

type CaseResult = {
  id: string;
  status: "PASS" | "FAIL";
  ms: number;
  days: number;
  meals: number;
  maxDeviation: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  uniqueRecipes: number;
  intraWeekRepeats: number;
  maxMealWeight: number;
  reason: string | null;
};

const SCHEMES: MealScheduleMode[] = [
  "three_main_two_snacks",
  "three_mains_only",
  "one_main_three_snacks",
  "two_main_two_snacks",
];
const WEEK_KCAL = [
  1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700,
  2800, 2900, 3000, 1312, 1313, 1396, 1710, 1726,
];
const MONTH_KCAL = [1200, 1312, 1500, 1800, 2200, 2600, 3000];
const outDir = path.resolve(".artifacts");
const outFile = path.join(outDir, "nutrition-range-matrix.json");

function targetsFor(spec: CaseSpec) {
  if (spec.kcal === 1312 && spec.profile !== "high_protein" && spec.profile !== "standard_protein") {
    return { kcal: d(1312), protein_g: d(112), fat_g: d(56), carbs_g: d(90), fiber_g: d(0) };
  }
  if (spec.targets) {
    return {
      kcal: d(spec.kcal),
      protein_g: d(spec.targets.protein_g),
      fat_g: d(spec.targets.fat_g),
      carbs_g: d(spec.targets.carbs_g),
      fiber_g: d(0),
    };
  }
  return consistentTargetsForKcal(spec.kcal);
}

function highProtein(kcal: number) {
  const protein = Math.round((kcal * 0.35) / 4);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  return { protein_g: protein, fat_g: fat, carbs_g: carbs };
}

function casesFor(products: Map<string, FoodProduct>): CaseSpec[] {
  const specs: CaseSpec[] = [];
  for (const days of [7, 28] as const) {
    const kcals = days === 7 ? WEEK_KCAL : MONTH_KCAL;
    for (const mode of SCHEMES) {
      for (const kcal of kcals) {
        specs.push({ id: `${days}|${mode}|${kcal}|base`, days, mode, kcal, profile: "base", excluded: [] });
      }
    }
  }
  const dairy = [...products.values()]
    .filter((product) => product.category === "dairy" && product.lactose_free !== true)
    .map((product) => product.id);
  const fish = [...products.values()]
    .filter((product) => product.category === "fish")
    .map((product) => product.id);
  const dislikedSlugs = ["banana", "rice-white-dry", "cottage-cheese-5"];
  const disliked = dislikedSlugs
    .map((slug) => [...products.values()].find((product) => product.slug === slug)?.id)
    .filter((id): id is string => Boolean(id));
  for (const kcal of [1312, 1800, 2500]) {
    specs.push({
      id: `7|three_main_two_snacks|${kcal}|lactose_free`,
      days: 7,
      mode: "three_main_two_snacks",
      kcal,
      profile: "lactose_free",
      excluded: dairy,
    });
    specs.push({
      id: `7|three_main_two_snacks|${kcal}|fish_free`,
      days: 7,
      mode: "three_main_two_snacks",
      kcal,
      profile: "fish_free",
      excluded: fish,
    });
    specs.push({
      id: `7|three_main_two_snacks|${kcal}|disliked`,
      days: 7,
      mode: "three_main_two_snacks",
      kcal,
      profile: "disliked",
      excluded: disliked,
    });
    specs.push({
      id: `7|three_main_two_snacks|${kcal}|standard_protein`,
      days: 7,
      mode: "three_main_two_snacks",
      kcal,
      profile: "standard_protein",
      excluded: [],
    });
    specs.push({
      id: `7|three_main_two_snacks|${kcal}|high_protein`,
      days: 7,
      mode: "three_main_two_snacks",
      kcal,
      profile: "high_protein",
      excluded: [],
      targets: highProtein(kcal),
    });
  }
  return specs;
}

function menuKeys(days: ConstructorDay[]): string[] {
  return days.map((day) => dayMenuKey(day));
}

function inspect(spec: CaseSpec, days: ConstructorDay[], target: ReturnType<typeof targetsFor>, recipes: Map<string, { id: string; name: string; steps: string[]; requires_cooking: boolean; variant_group?: string | null; ingredient_signature?: string | null }>, products: Map<string, FoodProduct>, ingredients: Map<string, Array<{ product_id: string; optional?: boolean }>>) {
  const slots = slotsForMode(spec.mode);
  let maxMealWeight = 0;
  let intraWeekRepeats = 0;
  const maxDeviation = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  const reasons: string[] = [];
  const unique = new Set<string>();
  const uses = new Map<string, number>();
  if (days.length !== spec.days) reasons.push(`дней ${days.length} из ${spec.days}`);
  for (let week = 0; week < days.length / 7; week += 1) {
    const slice = days.slice(week * 7, week * 7 + 7);
    if (evaluateStrictWeekVariety(slice, recipes as never, { allowRepeats: false })) intraWeekRepeats += 1;
    if (week > 0 && mealDifferenceRatio(days.slice((week - 1) * 7, week * 7), slice) < 0.75) {
      reasons.push(`неделя ${week + 1} слишком похожа`);
    }
  }
  const seen = new Set<string>();
  for (const day of days) {
    const key = dayMenuKey(day);
    if (seen.has(key)) reasons.push("повтор суточного набора");
    seen.add(key);
    const dk = Math.abs(Number(day.kcal) - target.kcal.toNumber());
    const dp = Math.abs(Number(day.protein_g) - target.protein_g.toNumber());
    const df = Math.abs(Number(day.fat_g) - target.fat_g.toNumber());
    const dc = Math.abs(Number(day.carbs_g) - target.carbs_g.toNumber());
    maxDeviation.kcal = Math.max(maxDeviation.kcal, dk);
    maxDeviation.protein_g = Math.max(maxDeviation.protein_g, dp);
    maxDeviation.fat_g = Math.max(maxDeviation.fat_g, df);
    maxDeviation.carbs_g = Math.max(maxDeviation.carbs_g, dc);
    if (dk > 5 || dp > 1 || df > 1 || dc > 1) reasons.push(`КБЖУ дня ${day.day_index}`);
    if (day.items.length !== slots.length) reasons.push(`слоты дня ${day.day_index}`);
    for (const item of day.items) {
      unique.add(item.recipe_id);
      uses.set(item.recipe_id, (uses.get(item.recipe_id) ?? 0) + 1);
      if (!item.recipe_name.trim()) reasons.push("пустое название");
      let weight = 0;
      for (const line of item.ingredients) {
        const grams = Number(line.grams);
        if (!(grams > 0)) reasons.push("нулевые граммы");
        weight += grams;
        const name = line.product_name.toLowerCase();
        if (grams > 500) reasons.push(`порция ${line.product_name}`);
        if (name.includes("масло") && grams > 30) reasons.push("масло");
        const lineKcal = (Number(line.kcal_per_100g) * grams) / 100;
        if (lineKcal > target.kcal.toNumber() * 0.55) reasons.push(`калории из ${line.product_name}`);
      }
      maxMealWeight = Math.max(maxMealWeight, weight);
      if (weight > 1200) reasons.push(`вес приёма ${Math.round(weight)}`);
      if (spec.mode === "one_main_three_snacks" && item.slot.startsWith("snack") && item.requires_cooking) {
        reasons.push("перекус требует готовки");
      }
      const recipe = recipes.get(item.recipe_id);
      const lines = (ingredients.get(item.recipe_id) ?? []).map((row) => {
        const product = products.get(row.product_id);
        return {
          slug: product?.slug ?? "",
          name: product?.name ?? "",
          state: product?.state ?? "ready",
          category: product?.category ?? "vegetable",
          required: row.optional !== true,
        };
      });
      if (recipe) {
        const issues = validateRecipeInstruction({
          name: recipe.name,
          mealType: item.slot.startsWith("snack") ? "snack" : "main",
          requiresCooking: recipe.requires_cooking,
          ingredients: lines,
          steps: recipe.steps,
        });
        if (issues.length > 0) reasons.push(`${recipe.name}: ${issues[0]}`);
      }
    }
  }
  if (spec.days === 28 && [...uses.values()].some((count) => count > 2)) reasons.push("рецепт чаще двух раз");
  return {
    meals: days.reduce((sum, day) => sum + day.items.length, 0),
    maxDeviation,
    uniqueRecipes: unique.size,
    intraWeekRepeats,
    maxMealWeight: Math.round(maxMealWeight),
    reason: reasons.length ? [...new Set(reasons)].slice(0, 4).join("; ") : null,
  };
}

function runOnce(spec: CaseSpec, seed: number, ctx: ReturnType<typeof buildInMemoryCatalog>) {
  const targets = spec.profile === "standard_protein" ? consistentTargetsForKcal(spec.kcal) : targetsFor(spec);
  return generateConstructorPlan(ctx, {
    targets,
    days_count: spec.days,
    excluded_product_ids: spec.excluded,
    tolerance: DEFAULT_TOLERANCE,
    meal_schedule_mode: spec.mode,
    primary_meal_slot: "lunch",
    seed,
    search_timeout_ms: spec.days === 28 ? 80_000 : 30_000,
  });
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(outFile, "utf8")) as { results?: CaseResult[] };
    } catch {
      return { results: [] as CaseResult[] };
    }
  })();
  const done = new Map((previous.results ?? []).filter((row) => row.status === "PASS").map((row) => [row.id, row]));
  const ctx = buildInMemoryCatalog();
  const specs = casesFor(ctx.products);
  const results: CaseResult[] = [];
  const roles = {
    main: ctx.mainRecipes.filter((recipe) => recipe.is_active).length,
    snack: ctx.snackRecipes.filter((recipe) => recipe.is_active).length,
    noCookSnack: ctx.snackRecipes.filter((recipe) => recipe.is_active && !recipe.requires_cooking).length,
    products: ctx.products.size,
    recipes: ctx.recipes.filter((recipe) => recipe.is_active).length,
  };
  const only = process.env.NUTRITION_MATRIX_FILTER ?? "";
  for (const spec of specs) {
    if (only && !spec.id.includes(only)) {
      const kept = (previous.results ?? []).find((row) => row.id === spec.id);
      if (kept) results.push(kept);
      continue;
    }
    const cached = done.get(spec.id);
    if (cached) {
      results.push(cached);
      writeFileSync(outFile, JSON.stringify({ roles, results }, null, 2));
      continue;
    }
    const started = Date.now();
    const first = runOnce(spec, 1312, ctx);
    const elapsed = Date.now() - started;
    const targets = spec.profile === "standard_protein" ? consistentTargetsForKcal(spec.kcal) : targetsFor(spec);
    const checked = first.is_valid
      ? inspect(spec, first.days, targets, new Map(ctx.recipes.map((recipe) => [recipe.id, recipe])), ctx.products, ctx.recipeIngredients as never)
      : null;
    let reason: string | null = checked?.reason ?? null;
    if (!first.is_valid) reason = first.message ?? first.reason_code ?? "не собран";
    if (first.is_valid && !checked?.reason) {
      const repeat = runOnce(spec, 1312, ctx);
      if (menuKeys(repeat.days).join("||") !== menuKeys(first.days).join("||")) reason = "тот же seed дал другой рацион";
      const other = runOnce(spec, 4242, ctx);
      if (!other.is_valid) reason = other.message ?? "другой seed не собрал рацион";
      else if (menuKeys(other.days).join("||") === menuKeys(first.days).join("||")) reason = "другой seed дал тот же рацион";
    }
    const limit = spec.days === 28 ? 90_000 : 30_000;
    if (!reason && elapsed > limit) reason = `дольше лимита: ${elapsed} мс`;
    const row: CaseResult = {
      id: spec.id,
      status: first.is_valid && !reason ? "PASS" : "FAIL",
      ms: elapsed,
      days: first.days.length,
      meals: checked?.meals ?? 0,
      maxDeviation: checked?.maxDeviation ?? { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
      uniqueRecipes: checked?.uniqueRecipes ?? 0,
      intraWeekRepeats: checked?.intraWeekRepeats ?? 0,
      maxMealWeight: checked?.maxMealWeight ?? 0,
      reason: first.is_valid && !reason ? null : reason,
    };
    results.push(row);
    writeFileSync(outFile, JSON.stringify({ roles, results }, null, 2));
    console.log(`${row.status} ${row.id} ${row.ms}ms ${row.reason ?? ""}`);
  }
  const failed = results.filter((row) => row.status === "FAIL").length;
  console.log(`done ${results.length - failed}/${results.length}`);
  if (failed > 0) process.exitCode = 1;
}

main();
