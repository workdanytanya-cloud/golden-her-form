import { supabase } from "@/integrations/supabase/client";
import {
  buildMealPlanItem,
  buildIngredientLine,
  comparisonRows,
  mealTotalsFromIngredients,
} from "@/lib/nutrition-constructor/calculator";
import {
  DEFAULT_TOLERANCE,
  type MealScheduleMode,
  type PlanDaysCount,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";
import {
  d as dec,
  roundTargetsForDb,
  snapshotMacro,
  withinTolerance,
  sumMacros,
} from "@/lib/nutrition-constructor/decimal-math";
import {
  generateConstructorPlan,
  type OptimizerContext,
} from "@/lib/nutrition-constructor/optimizer";
import { inferRecipeMeta, snackActionForRecipe } from "@/lib/nutrition-constructor/recipe-meta";
import {
  SEED_PRODUCTS,
  SEED_RECIPES,
  type SeedRecipe,
} from "@/lib/nutrition-constructor/seed-data";
import {
  calcMacroTargets,
  checkAutoGenerationSafety,
  checkMacroCompatibility,
  checkTargetSafety,
  type TargetProfileInput,
} from "@/lib/nutrition-constructor/targets";
import type {
  ConstructorDay,
  FoodProduct,
  MealPlanItem,
  Recipe,
  RecipeIngredient,
} from "@/lib/nutrition-constructor/types";

export type ConstructorPlanRow = {
  id: string;
  user_id: string;
  plan_mode: "legacy" | "constructor";
  plan_days_count: number;
  plan_status: "draft" | "validated" | "assigned";
  target_kcal: number;
  target_protein_g: number;
  target_fat_g: number;
  target_carbs_g: number;
  bmr: number | null;
  tdee: number | null;
  calorie_adjustment_pct: number | null;
  tolerance_kcal: number;
  tolerance_macro_g: number;
  requires_manual_review: boolean;
  review_reason: string | null;
  targets_manual: boolean;
  notes: string | null;
  excluded_products: string[];
  meal_schedule_mode: MealScheduleMode;
  primary_meal_slot: PrimaryMealSlot;
};

export type BuildCatalogOptions = {
  /** Только для unit-тестов: добавить упаковочные продукты с эталонным KBJU. */
  includeTestPackaging?: boolean;
};

const TEST_PACKAGING_KBJU: Record<
  string,
  Pick<
    FoodProduct,
    "kcal_per_100g" | "protein_per_100g" | "fat_per_100g" | "carbs_per_100g" | "category" | "name"
  >
> = {
  "canned-tuna": {
    name: "Тунец",
    category: "canned",
    kcal_per_100g: "116",
    protein_per_100g: "26",
    fat_per_100g: "0.8",
    carbs_per_100g: "0",
  },
  "hard-cheese": {
    name: "Сыр твёрдый",
    category: "dairy",
    kcal_per_100g: "350",
    protein_per_100g: "25",
    fat_per_100g: "27",
    carbs_per_100g: "2",
  },
  "lactose-free-milk": {
    name: "Молоко без лактозы",
    category: "dairy",
    kcal_per_100g: "47",
    protein_per_100g: "3.4",
    fat_per_100g: "1.5",
    carbs_per_100g: "4.7",
  },
  crispbread: {
    name: "Хлебцы",
    category: "bakery",
    kcal_per_100g: "280",
    protein_per_100g: "10",
    fat_per_100g: "2",
    carbs_per_100g: "52",
  },
  lavash: {
    name: "Лаваш",
    category: "bakery",
    kcal_per_100g: "275",
    protein_per_100g: "9",
    fat_per_100g: "1.2",
    carbs_per_100g: "56",
  },
  "canned-corn": {
    name: "Кукуруза консервированная",
    category: "canned",
    kcal_per_100g: "81",
    protein_per_100g: "2.5",
    fat_per_100g: "1",
    carbs_per_100g: "16",
  },
};

function seedToRecipe(r: SeedRecipe, productSlugs: Set<string>): Recipe | null {
  const ings = r.ingredients.filter((i) => productSlugs.has(i.product_slug));
  if (ings.length === 0) return null;
  const meta = inferRecipeMeta({
    meal_type: r.meal_type,
    requires_cooking: r.requires_cooking,
    ingredients: r.ingredients,
  });
  const slugs = r.ingredients.map((i) => i.product_slug);
  return {
    id: r.slug,
    slug: r.slug,
    name: r.name,
    meal_type: r.meal_type,
    steps: r.steps,
    prep_time_min: r.prep_time_min,
    requires_cooking: r.requires_cooking,
    is_active: true,
    weighing_note: r.weighing_note,
    is_nutrient_dense: meta.is_nutrient_dense,
    contains_protein_source: meta.contains_protein_source,
    contains_fruit_or_vegetable: meta.contains_fruit_or_vegetable,
    is_treat: meta.is_treat,
    allowed_schedule_modes: meta.allowed_schedule_modes,
    snack_action: r.meal_type === "snack" ? snackActionForRecipe(slugs) : null,
    is_everyday: true,
    is_nutritionally_complete: true,
    dietitian_approved: true,
    active_prep_minutes: r.prep_time_min,
    total_cook_minutes: r.prep_time_min,
    complexity: "easy" as const,
  };
}

/** In-memory fallback если таблицы ещё не мигрированы. */
export function buildInMemoryCatalog(options: BuildCatalogOptions = {}): OptimizerContext {
  const products = new Map<string, FoodProduct>();
  for (const p of SEED_PRODUCTS) {
    if (!p.is_verified && !options.includeTestPackaging) continue;
    if (!p.is_verified && options.includeTestPackaging && !TEST_PACKAGING_KBJU[p.slug]) continue;
    const id = p.slug;
    const testPack = options.includeTestPackaging ? TEST_PACKAGING_KBJU[p.slug] : undefined;
    products.set(id, {
      id,
      slug: p.slug,
      name: testPack?.name ?? p.name,
      category: (testPack?.category ?? p.category) as FoodProduct["category"],
      brand: p.brand ?? null,
      state: p.state as FoodProduct["state"],
      measurement_basis: p.measurement_basis,
      kcal_per_100g: testPack?.kcal_per_100g ?? String(p.kcal),
      protein_per_100g: testPack?.protein_per_100g ?? String(p.protein),
      fat_per_100g: testPack?.fat_per_100g ?? String(p.fat),
      carbs_per_100g: testPack?.carbs_per_100g ?? String(p.carbs),
      fiber_per_100g: p.fiber != null ? String(p.fiber) : null,
      density: p.density != null ? String(p.density) : null,
      source_name: p.source_name,
      source_url: p.source_url ?? null,
      verified_at: p.is_verified || options.includeTestPackaging ? new Date().toISOString() : null,
      is_verified: p.is_verified || Boolean(options.includeTestPackaging),
      is_active: true,
      allowed_for_snack: p.allowed_for_snack,
      requires_cooking: p.requires_cooking,
      weighing_note: p.weighing_note,
      is_active_for_autogeneration: p.is_active_for_autogeneration !== false,
    });
  }

  const productSlugs = new Set(products.keys());
  const recipes: Recipe[] = [];
  const recipeIngredients = new Map<string, RecipeIngredient[]>();

  for (const r of SEED_RECIPES) {
    const recipe = seedToRecipe(r, productSlugs);
    if (!recipe) continue;
    const ings = r.ingredients.filter((i) => productSlugs.has(i.product_slug));
    recipes.push(recipe);
    recipeIngredients.set(
      recipe.id,
      ings.map((ing, idx) => ({
        id: `${recipe.id}-${ing.product_slug}`,
        recipe_id: recipe.id,
        product_id: ing.product_slug,
        min_g: ing.min_g,
        max_g: ing.max_g,
        default_g: ing.default_g,
        is_scalable: true,
        sort_order: idx,
        optional: ing.product_slug === "olive-oil" || ing.min_g === 0,
      })),
    );
  }

  return {
    products,
    recipes,
    recipeIngredients,
    mainRecipes: recipes.filter((r) => r.meal_type === "main"),
    snackRecipes: recipes.filter((r) => r.meal_type === "snack"),
  };
}

export type ConstructorDayRow = {
  id: string;
  plan_id: string;
  day_index: number;
  day_note: string | null;
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
  is_valid: boolean;
  items: MealPlanItem[];
};

function enrichRecipeFromDb(
  recipe: Recipe,
  ings: RecipeIngredient[],
  products: Map<string, FoodProduct>,
): Recipe {
  const slugs = ings
    .map((ri) => products.get(ri.product_id)?.slug)
    .filter((slug): slug is string => Boolean(slug));
  if (slugs.length === 0) return recipe;

  const meta = inferRecipeMeta({
    meal_type: recipe.meal_type,
    requires_cooking: recipe.requires_cooking,
    ingredients: slugs.map((product_slug) => ({ product_slug })),
  });

  return {
    ...recipe,
    is_treat: meta.is_treat,
    is_nutrient_dense: meta.is_nutrient_dense,
    contains_protein_source: meta.contains_protein_source,
    contains_fruit_or_vegetable: meta.contains_fruit_or_vegetable,
    allowed_schedule_modes: meta.allowed_schedule_modes,
    snack_action: recipe.snack_action ?? snackActionForRecipe(slugs),
  };
}

function mapRecipeRow(row: Record<string, unknown>): Recipe {
  const modes = (row.allowed_schedule_modes as string[] | null) ?? [
    "two_main_two_snacks",
    "one_main_three_snacks",
  ];
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    meal_type: row.meal_type as Recipe["meal_type"],
    steps: (row.steps as string[]) ?? [],
    prep_time_min: (row.prep_time_min as number | null) ?? null,
    requires_cooking: Boolean(row.requires_cooking),
    is_active: Boolean(row.is_active ?? true),
    weighing_note: (row.weighing_note as string | null) ?? null,
    is_nutrient_dense: Boolean(row.is_nutrient_dense ?? true),
    contains_protein_source: Boolean(row.contains_protein_source ?? false),
    contains_fruit_or_vegetable: Boolean(row.contains_fruit_or_vegetable ?? false),
    is_treat: Boolean(row.is_treat ?? false),
    allowed_schedule_modes: modes as Recipe["allowed_schedule_modes"],
    snack_action: (row.snack_action as string | null) ?? null,
  };
}

function mapFoodProductRow(row: {
  id: string;
  slug: string;
  name: string;
  category: string;
  brand: string | null;
  state: string;
  measurement_basis: string;
  kcal_per_100g: number | string;
  protein_per_100g: number | string;
  fat_per_100g: number | string;
  carbs_per_100g: number | string;
  fiber_per_100g: number | string | null;
  density: number | string | null;
  source_name: string;
  source_url: string | null;
  verified_at: string | null;
  is_verified: boolean;
  is_active: boolean;
  allowed_for_snack: boolean;
  requires_cooking: boolean;
  weighing_note: string | null;
}): FoodProduct {
  const packaging = TEST_PACKAGING_KBJU[row.slug];
  const usePackaging = packaging && (!row.is_verified || Number(row.kcal_per_100g) === 0);
  return {
    id: row.id,
    slug: row.slug,
    name: packaging?.name ?? row.name,
    category: (packaging?.category ?? row.category) as FoodProduct["category"],
    brand: row.brand,
    state: row.state as FoodProduct["state"],
    measurement_basis: row.measurement_basis,
    kcal_per_100g: usePackaging ? packaging!.kcal_per_100g : String(row.kcal_per_100g),
    protein_per_100g: usePackaging ? packaging!.protein_per_100g : String(row.protein_per_100g),
    fat_per_100g: usePackaging ? packaging!.fat_per_100g : String(row.fat_per_100g),
    carbs_per_100g: usePackaging ? packaging!.carbs_per_100g : String(row.carbs_per_100g),
    fiber_per_100g: row.fiber_per_100g != null ? String(row.fiber_per_100g) : null,
    density: row.density != null ? String(row.density) : null,
    source_name: row.source_name,
    source_url: row.source_url,
    verified_at: row.verified_at ?? (usePackaging ? new Date().toISOString() : null),
    is_verified: row.is_verified || Boolean(usePackaging),
    is_active: row.is_active,
    allowed_for_snack: row.allowed_for_snack,
    requires_cooking: row.requires_cooking,
    weighing_note: row.weighing_note,
  };
}

export async function loadFoodProductsFromDb(): Promise<FoodProduct[]> {
  const { data, error } = await supabase.from("food_products").select("*").eq("is_active", true);
  if (error) {
    if (/schema cache|could not find|PGRST204/i.test(error.message)) {
      return SEED_PRODUCTS.filter((p) => p.is_verified).map((p) => ({
        id: p.slug,
        slug: p.slug,
        name: p.name,
        category: p.category as FoodProduct["category"],
        brand: p.brand ?? null,
        state: p.state as FoodProduct["state"],
        measurement_basis: p.measurement_basis,
        kcal_per_100g: String(p.kcal),
        protein_per_100g: String(p.protein),
        fat_per_100g: String(p.fat),
        carbs_per_100g: String(p.carbs),
        fiber_per_100g: p.fiber != null ? String(p.fiber) : null,
        density: p.density != null ? String(p.density) : null,
        source_name: p.source_name,
        source_url: p.source_url ?? null,
        verified_at: null,
        is_verified: p.is_verified,
        is_active: true,
        allowed_for_snack: p.allowed_for_snack,
        requires_cooking: p.requires_cooking,
        weighing_note: p.weighing_note,
      }));
    }
    throw error;
  }
  return (data ?? []).map(mapFoodProductRow);
}

export async function loadOptimizerContext(): Promise<OptimizerContext> {
  try {
    const [productsRows, recipesRows, ingsRows] = await Promise.all([
      supabase.from("food_products").select("*").eq("is_active", true),
      supabase.from("recipes").select("*").eq("is_active", true),
      supabase.from("recipe_ingredients").select("*"),
    ]);
    if (productsRows.error || recipesRows.error || ingsRows.error) {
      return buildInMemoryCatalog();
    }
    if ((productsRows.data ?? []).length === 0) return buildInMemoryCatalog();

    const products = new Map<string, FoodProduct>(
      (productsRows.data ?? []).map((p) => {
        const mapped = mapFoodProductRow(p);
        return [mapped.id, mapped];
      }),
    );
    const recipes = (recipesRows.data ?? []).map((r) => mapRecipeRow(r as Record<string, unknown>));
    const recipeIngredients = new Map<string, RecipeIngredient[]>();
    for (const ri of (ingsRows.data ?? []) as RecipeIngredient[]) {
      const list = recipeIngredients.get(ri.recipe_id) ?? [];
      list.push(ri);
      recipeIngredients.set(ri.recipe_id, list);
    }
    const enrichedRecipes = recipes.map((recipe) =>
      enrichRecipeFromDb(recipe, recipeIngredients.get(recipe.id) ?? [], products),
    );
    return {
      products,
      recipes: enrichedRecipes,
      recipeIngredients,
      mainRecipes: enrichedRecipes.filter((r) => r.meal_type === "main"),
      snackRecipes: enrichedRecipes.filter((r) => r.meal_type === "snack"),
    };
  } catch {
    return buildInMemoryCatalog();
  }
}

export function recalculateMealItem(
  item: MealPlanItem,
  products: Map<string, FoodProduct>,
): MealPlanItem {
  const lines = item.ingredients.map((ing) => {
    const p = products.get(ing.product_id);
    if (!p) return ing;
    return buildIngredientLine(p, ing.grams, ing.sort_order);
  });
  return {
    ...item,
    ingredients: lines,
    ...(() => {
      const totals = mealTotalsFromIngredients(lines);
      const snap = snapshotMacro(totals);
      return {
        kcal: snap.kcal,
        protein_g: snap.protein_g,
        fat_g: snap.fat_g,
        carbs_g: snap.carbs_g,
        fiber_g: snap.fiber_g,
      };
    })(),
  };
}

export async function generateAndValidateConstructorPlan(params: {
  profile: TargetProfileInput & {
    pregnancy_status?: string | null;
    health_conditions?: string | null;
    profile_complete?: boolean;
  };
  days_count: PlanDaysCount;
  excluded_product_ids: string[];
  tolerance?: typeof DEFAULT_TOLERANCE;
  meal_schedule_mode?: MealScheduleMode;
  primary_meal_slot?: PrimaryMealSlot;
}) {
  const safety = checkAutoGenerationSafety({
    birth_date: params.profile.birth_date,
    pregnancy_status: params.profile.pregnancy_status,
    health_conditions: params.profile.health_conditions,
    profile_complete: params.profile.profile_complete ?? true,
  });
  const calc = calcMacroTargets(params.profile);
  const macroCheck = checkMacroCompatibility(calc.targets);
  if (!macroCheck.compatible) {
    return {
      is_valid: false,
      kbju_acceptable: false,
      message: macroCheck.message,
      comparison: [],
      days: [],
      bmr: calc.bmr,
      tdee: calc.tdee,
      adjustment_pct: calc.adjustment_pct,
      targets: calc.targets,
      requires_manual_review: true,
      review_reason: macroCheck.message,
    };
  }
  const targetSafety = checkTargetSafety(calc.targets);
  const ctx = await loadOptimizerContext();
  const result = generateConstructorPlan(ctx, {
    targets: calc.targets,
    days_count: params.days_count,
    excluded_product_ids: params.excluded_product_ids,
    tolerance: params.tolerance ?? DEFAULT_TOLERANCE,
    meal_schedule_mode: params.meal_schedule_mode ?? "two_main_two_snacks",
    primary_meal_slot: params.primary_meal_slot ?? "lunch",
  });
  return {
    ...result,
    bmr: calc.bmr,
    tdee: calc.tdee,
    adjustment_pct: calc.adjustment_pct,
    targets: calc.targets,
    requires_manual_review: safety.blocked || targetSafety.length > 0 || !result.is_valid,
    review_reason: [...safety.reasons, ...targetSafety].join("\n") || null,
    comparison: result.comparison.length
      ? result.comparison
      : comparisonRows(
          calc.targets,
          result.best_approximation?.days[0]
            ? {
                kcal: dec(result.best_approximation.days[0].kcal),
                protein_g: dec(result.best_approximation.days[0].protein_g),
                fat_g: dec(result.best_approximation.days[0].fat_g),
                carbs_g: dec(result.best_approximation.days[0].carbs_g),
                fiber_g: dec(0),
              }
            : calc.targets,
        ),
  };
}

export function validateDayAgainstTargets(
  day: ConstructorDay,
  targets: import("@/lib/nutrition-constructor/decimal-math").MacroBreakdown,
  tolerance = DEFAULT_TOLERANCE,
): boolean {
  return withinTolerance(
    {
      kcal: dec(day.kcal),
      protein_g: dec(day.protein_g),
      fat_g: dec(day.fat_g),
      carbs_g: dec(day.carbs_g),
      fiber_g: dec(day.fiber_g),
    },
    targets,
    tolerance,
  );
}

export { buildMealPlanItem, comparisonRows, withinTolerance };

function isMissingColumn(error: { message?: string }, col: string): boolean {
  const msg = error.message ?? "";
  return new RegExp(col, "i").test(msg) && /schema cache|could not find|PGRST204|column/i.test(msg);
}

function mapMealItemRow(
  item: Record<string, unknown>,
  ingredients: Record<string, unknown>[],
): MealPlanItem {
  return {
    id: item.id as string,
    slot: item.slot as MealPlanItem["slot"],
    recipe_id: (item.recipe_id as string) ?? "",
    recipe_name: item.recipe_name as string,
    requires_cooking: item.requires_cooking as boolean,
    prep_time_min: (item.prep_time_min as number | null) ?? null,
    steps: (item.steps as string[]) ?? [],
    weighing_note: (item.weighing_note as string | null) ?? null,
    snack_action: (item.snack_action as string | null) ?? null,
    kcal: String(item.kcal),
    protein_g: String(item.protein_g),
    fat_g: String(item.fat_g),
    carbs_g: String(item.carbs_g),
    fiber_g: String(item.fiber_g ?? 0),
    is_valid: Boolean(item.is_valid),
    ingredients: ingredients.map((ing, idx) => ({
      product_id: (ing.product_id as string) ?? "",
      product_name: ing.product_name as string,
      grams: String(ing.grams),
      weighing_note: (ing.weighing_note as string | null) ?? null,
      kcal_per_100g: String(ing.kcal_per_100g),
      protein_per_100g: String(ing.protein_per_100g),
      fat_per_100g: String(ing.fat_per_100g),
      carbs_per_100g: String(ing.carbs_per_100g),
      fiber_per_100g: ing.fiber_per_100g != null ? String(ing.fiber_per_100g) : null,
      kcal: String(ing.kcal),
      protein_g: String(ing.protein_g),
      fat_g: String(ing.fat_g),
      carbs_g: String(ing.carbs_g),
      fiber_g: String(ing.fiber_g ?? 0),
      sort_order: (ing.sort_order as number) ?? idx,
    })),
  };
}

/** Загрузить constructor-план клиента из БД. */
export async function loadConstructorPlanFor(
  userId: string,
  courseId?: string | null,
): Promise<{
  plan: ConstructorPlanRow | null;
  days: ConstructorDayRow[];
}> {
  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));

  let planQuery = supabase.from("nutrition_plans").select("*").eq("user_id", userId);
  if (resolvedCourseId) planQuery = planQuery.eq("course_id", resolvedCourseId);
  const { data: planRaw, error: planErr } = await planQuery.maybeSingle();

  if (planErr) {
    if (isMissingColumn(planErr, "plan_mode")) return { plan: null, days: [] };
    throw planErr;
  }
  if (!planRaw) return { plan: null, days: [] };

  const planMode = (planRaw as { plan_mode?: string }).plan_mode ?? "legacy";
  if (planMode !== "constructor") return { plan: null, days: [] };

  const plan = {
    ...(planRaw as unknown as ConstructorPlanRow),
    meal_schedule_mode:
      ((planRaw as { meal_schedule_mode?: MealScheduleMode })
        .meal_schedule_mode as MealScheduleMode) ?? "two_main_two_snacks",
    primary_meal_slot:
      ((planRaw as { primary_meal_slot?: PrimaryMealSlot }).primary_meal_slot as PrimaryMealSlot) ??
      "lunch",
  };

  const { data: dayRows, error: dayErr } = await supabase
    .from("nutrition_plan_days")
    .select("id, plan_id, day_index, day_note")
    .eq("plan_id", plan.id)
    .order("day_index");

  if (dayErr) throw dayErr;
  if (!dayRows?.length) return { plan, days: [] };

  const dayIds = dayRows.map((d) => d.id);
  const { data: itemRows, error: itemErr } = await supabase
    .from("meal_plan_items")
    .select("*")
    .in("plan_day_id", dayIds)
    .order("sort_order");

  if (itemErr) {
    if (isMissingColumn(itemErr, "meal_plan_items")) return { plan, days: [] };
    throw itemErr;
  }

  const itemIds = (itemRows ?? []).map((i) => i.id);
  let ingRows: Record<string, unknown>[] = [];
  if (itemIds.length > 0) {
    const { data: ings, error: ingErr } = await supabase
      .from("meal_plan_item_ingredients")
      .select("*")
      .in("meal_item_id", itemIds)
      .order("sort_order");
    if (ingErr && !isMissingColumn(ingErr, "meal_plan_item_ingredients")) throw ingErr;
    ingRows = (ings ?? []) as Record<string, unknown>[];
  }

  const itemsByDay = new Map<string, MealPlanItem[]>();
  for (const item of itemRows ?? []) {
    const ings = ingRows.filter((ing) => ing.meal_item_id === item.id);
    const mapped = mapMealItemRow(item as Record<string, unknown>, ings);
    const list = itemsByDay.get(item.plan_day_id as string) ?? [];
    list.push(mapped);
    itemsByDay.set(item.plan_day_id as string, list);
  }

  const days: ConstructorDayRow[] = dayRows.map((dayRow) => {
    const items = (itemsByDay.get(dayRow.id) ?? []).sort((a, b) => a.slot.localeCompare(b.slot));
    const totals = sumMacros(
      items.map((i) => ({
        kcal: dec(i.kcal),
        protein_g: dec(i.protein_g),
        fat_g: dec(i.fat_g),
        carbs_g: dec(i.carbs_g),
        fiber_g: dec(i.fiber_g),
      })),
    );
    const snap = snapshotMacro(totals);
    return {
      id: dayRow.id,
      plan_id: dayRow.plan_id,
      day_index: dayRow.day_index,
      day_note: dayRow.day_note,
      kcal: snap.kcal,
      protein_g: snap.protein_g,
      fat_g: snap.fat_g,
      carbs_g: snap.carbs_g,
      fiber_g: snap.fiber_g,
      is_valid: items.every((i) => i.is_valid),
      items,
    };
  });

  return { plan, days };
}

export type SaveConstructorPlanParams = {
  userId: string;
  courseId?: string | null;
  days: ConstructorDay[];
  targets: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
  plan_days_count: PlanDaysCount;
  plan_status: "draft" | "validated" | "assigned";
  bmr?: number;
  tdee?: number;
  calorie_adjustment_pct?: number;
  requires_manual_review?: boolean;
  review_reason?: string | null;
  notes?: string | null;
  excluded_products?: string[];
  targets_manual?: boolean;
  meal_schedule_mode?: MealScheduleMode;
  primary_meal_slot?: PrimaryMealSlot;
};

/** Сохранить constructor-план в БД (snapshot KBJU). */
export async function saveConstructorPlan(
  params: SaveConstructorPlanParams,
): Promise<{ plan: ConstructorPlanRow; days: ConstructorDayRow[] }> {
  const {
    userId,
    courseId,
    days,
    targets,
    plan_days_count,
    plan_status,
    bmr,
    tdee,
    calorie_adjustment_pct,
    requires_manual_review,
    review_reason,
    notes,
    excluded_products,
    targets_manual,
    meal_schedule_mode,
    primary_meal_slot,
  } = params;

  const { resolveCourseId } = await import("@/lib/client-courses/repo");
  const resolvedCourseId = courseId ?? (await resolveCourseId(userId));

  let existingQuery = supabase.from("nutrition_plans").select("id").eq("user_id", userId);
  if (resolvedCourseId) existingQuery = existingQuery.eq("course_id", resolvedCourseId);
  const { data: existing } = await existingQuery.maybeSingle();

  const dbTargets = roundTargetsForDb(targets);

  const basePayload = {
    user_id: userId,
    ...(resolvedCourseId ? { course_id: resolvedCourseId } : {}),
    meals_per_day: 5 as const,
    preferred_products: [] as string[],
    excluded_products: excluded_products ?? [],
    target_kcal: dbTargets.kcal,
    target_protein_g: dbTargets.protein_g,
    target_fat_g: dbTargets.fat_g,
    target_carbs_g: dbTargets.carbs_g,
    targets_manual: targets_manual ?? true,
    notes: notes ?? null,
    generated_at: new Date().toISOString(),
  };

  const extendedPayload = {
    ...basePayload,
    plan_mode: "constructor",
    plan_days_count,
    plan_status,
    bmr: bmr ?? null,
    tdee: tdee ?? null,
    calorie_adjustment_pct: calorie_adjustment_pct ?? null,
    requires_manual_review: requires_manual_review ?? false,
    review_reason: review_reason ?? null,
    meal_schedule_mode: meal_schedule_mode ?? "two_main_two_snacks",
    primary_meal_slot: primary_meal_slot ?? "lunch",
  };

  let planId: string;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("nutrition_plans")
      .update(extendedPayload as never)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error && isMissingColumn(error, "plan_mode")) {
      const legacy = await supabase
        .from("nutrition_plans")
        .update(basePayload)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (legacy.error) throw legacy.error;
      planId = legacy.data.id;
    } else if (error) {
      throw error;
    } else {
      planId = data!.id;
    }
  } else {
    const { data, error } = await supabase
      .from("nutrition_plans")
      .insert(extendedPayload as never)
      .select("id")
      .single();
    if (error && isMissingColumn(error, "plan_mode")) {
      const legacy = await supabase
        .from("nutrition_plans")
        .insert(basePayload)
        .select("id")
        .single();
      if (legacy.error) throw legacy.error;
      planId = legacy.data.id;
    } else if (error) {
      throw error;
    } else {
      planId = data!.id;
    }
  }

  // Удалить старые дни (cascade на meal_plan_items если FK настроен)
  const { error: delErr } = await supabase
    .from("nutrition_plan_days")
    .delete()
    .eq("plan_id", planId);
  if (delErr) throw delErr;

  for (const day of days) {
    const { data: dayRow, error: dayInsErr } = await supabase
      .from("nutrition_plan_days")
      .insert({
        plan_id: planId,
        day_index: day.day_index,
        day_note: day.day_note,
        meals: [] as never,
      })
      .select("id")
      .single();
    if (dayInsErr) throw dayInsErr;

    for (let si = 0; si < day.items.length; si++) {
      const item = day.items[si];
      const { data: itemRow, error: itemInsErr } = await supabase
        .from("meal_plan_items")
        .insert({
          plan_day_id: dayRow.id,
          slot: item.slot,
          recipe_id: item.recipe_id || null,
          recipe_name: item.recipe_name,
          requires_cooking: item.requires_cooking,
          prep_time_min: item.prep_time_min,
          steps: item.steps as unknown as never,
          weighing_note: item.weighing_note,
          snack_action: item.snack_action ?? null,
          kcal: item.kcal,
          protein_g: item.protein_g,
          fat_g: item.fat_g,
          carbs_g: item.carbs_g,
          fiber_g: item.fiber_g,
          is_valid: item.is_valid,
          sort_order: si,
        } as never)
        .select("id")
        .single();
      if (itemInsErr) throw itemInsErr;

      if (item.ingredients.length > 0) {
        const ingPayload = item.ingredients.map((ing, idx) => ({
          meal_item_id: itemRow.id,
          product_id: ing.product_id || null,
          product_name: ing.product_name,
          grams: ing.grams,
          weighing_note: ing.weighing_note,
          kcal_per_100g: ing.kcal_per_100g,
          protein_per_100g: ing.protein_per_100g,
          fat_per_100g: ing.fat_per_100g,
          carbs_per_100g: ing.carbs_per_100g,
          fiber_per_100g: ing.fiber_per_100g,
          kcal: ing.kcal,
          protein_g: ing.protein_g,
          fat_g: ing.fat_g,
          carbs_g: ing.carbs_g,
          fiber_g: ing.fiber_g,
          sort_order: idx,
        }));
        const { error: ingInsErr } = await supabase
          .from("meal_plan_item_ingredients")
          .insert(ingPayload as never);
        if (ingInsErr) throw ingInsErr;
      }
    }
  }

  return loadConstructorPlanFor(userId).then((r) => ({
    plan: r.plan!,
    days: r.days,
  }));
}
