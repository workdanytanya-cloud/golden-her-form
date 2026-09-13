import {
  buildForbiddenProductIds,
  type ClientNutritionRestrictions,
} from "@/lib/nutrition-constructor/allergens";
import type { MealScheduleMode } from "@/lib/nutrition-constructor/config";
import type { OptimizerContext } from "@/lib/nutrition-constructor/optimizer";
import { OIL_PRODUCT_SLUGS } from "@/lib/nutrition-constructor/recipe-meta";
import {
  isAutoGenerationEligible,
  verifiedIngredients,
} from "@/lib/nutrition-constructor/recipe-selection";
import type { Recipe } from "@/lib/nutrition-constructor/types";

export type RecipeExclusion = {
  slug: string;
  name: string;
  meal_type: "main" | "snack";
  reasons: string[];
};

export type CatalogOilReport = {
  slug: string;
  id: string | null;
  available: boolean;
  verified: boolean;
  autogen: boolean;
};

export type CatalogGenerationReport = {
  catalogKind: "production_seed" | "fixture_test_packaging";
  productCount: number;
  recipeCount: number;
  verifiedProductCount: number;
  autogenProductCount: number;
  productIds: Array<{ slug: string; id: string; verified: boolean; autogen: boolean }>;
  oil: CatalogOilReport[];
  eligibleMains: number;
  eligibleSnacks: number;
  excludedRecipes: RecipeExclusion[];
  allergenTags: string[];
  forbiddenProductCount: number;
  forbiddenReasons: Array<{ slug: string; reason: string }>;
  matchesFixtureAcceptanceCatalog: boolean;
  notes: string[];
};

function recipeExclusionReasons(
  ctx: OptimizerContext,
  recipe: Recipe,
  mode: MealScheduleMode,
  excluded: Set<string>,
): string[] {
  const reasons: string[] = [];
  if (!recipe.is_active) reasons.push("рецепт неактивен");
  if (!recipe.allowed_schedule_modes.includes(mode)) {
    reasons.push(`режим ${mode} не входит в allowed_schedule_modes`);
  }
  if (!isAutoGenerationEligible(recipe)) {
    if (recipe.dietitian_approved === false) reasons.push("dietitian_approved=false");
    if (recipe.is_nutritionally_complete === false) reasons.push("is_nutritionally_complete=false");
    if (recipe.meal_type === "main") {
      const activePrep = recipe.active_prep_minutes ?? recipe.prep_time_min ?? 999;
      const totalCook = recipe.total_cook_minutes ?? recipe.prep_time_min ?? 999;
      if (activePrep > 20) reasons.push(`active_prep_minutes ${activePrep} > 20`);
      if (totalCook > 40) reasons.push(`total_cook_minutes ${totalCook} > 40`);
    }
    if (!recipe.is_active) reasons.push("не eligible для автогенерации");
  }
  if (mode === "one_main_three_snacks" && recipe.meal_type === "snack") {
    if (recipe.is_treat) reasons.push("treat-перекус недопустим в 1+3");
    if (!recipe.is_nutrient_dense) reasons.push("is_nutrient_dense=false");
    if (recipe.requires_cooking) reasons.push("перекус требует приготовления");
  }
  const ings = ctx.recipeIngredients.get(recipe.id) ?? [];
  if (ings.length === 0) reasons.push("нет ингредиентов");
  for (const ing of ings) {
    const product = ctx.products.get(ing.product_id);
    if (!product) {
      reasons.push(`продукт ${ing.product_id} отсутствует в каталоге`);
      continue;
    }
    if (!product.is_verified) reasons.push(`${product.slug}: verified=false`);
    if (!product.is_active) reasons.push(`${product.slug}: is_active=false`);
    if (product.is_active_for_autogeneration === false) {
      reasons.push(`${product.slug}: is_active_for_autogeneration=false`);
    }
    if (excluded.has(product.id)) reasons.push(`${product.slug}: исключён анкетой/аллергеном`);
    if (!(ing.min_g >= 0 && ing.max_g >= ing.min_g)) {
      reasons.push(`${product.slug}: недопустимый диапазон ${ing.min_g}–${ing.max_g} г`);
    }
  }
  if (verifiedIngredients(ctx, recipe, excluded).length === 0 && ings.length > 0) {
    reasons.push("нет допустимых verified-ингредиентов");
  }
  return [...new Set(reasons)];
}

export function eligibleMainsForMode(ctx: OptimizerContext, mode: MealScheduleMode): Recipe[] {
  return ctx.mainRecipes.filter(
    (recipe) =>
      recipe.is_active &&
      recipe.allowed_schedule_modes.includes(mode) &&
      isAutoGenerationEligible(recipe) &&
      verifiedIngredients(ctx, recipe, new Set()).length > 0,
  );
}

export function eligibleSnacksForMode(ctx: OptimizerContext, mode: MealScheduleMode): Recipe[] {
  return ctx.snackRecipes.filter(
    (recipe) =>
      recipe.is_active &&
      recipe.allowed_schedule_modes.includes(mode) &&
      isAutoGenerationEligible(recipe) &&
      (mode === "two_main_two_snacks" || (!recipe.is_treat && recipe.is_nutrient_dense)) &&
      (mode !== "one_main_three_snacks" || !recipe.requires_cooking) &&
      verifiedIngredients(ctx, recipe, new Set()).length > 0,
  );
}

export function analyzeCatalogForGeneration(params: {
  ctx: OptimizerContext;
  mode: MealScheduleMode;
  restrictions?: ClientNutritionRestrictions;
  catalogKind: CatalogGenerationReport["catalogKind"];
  fixtureProductSlugs?: string[];
}): CatalogGenerationReport {
  const products = [...params.ctx.products.values()];
  const { forbiddenIds, reasons } = buildForbiddenProductIds(
    products,
    params.restrictions ?? {},
  );
  const excludedRecipes: RecipeExclusion[] = [];
  for (const recipe of params.ctx.recipes) {
    const recipeReasons = recipeExclusionReasons(params.ctx, recipe, params.mode, forbiddenIds);
    if (recipeReasons.length > 0) {
      excludedRecipes.push({
        slug: recipe.slug,
        name: recipe.name,
        meal_type: recipe.meal_type,
        reasons: recipeReasons,
      });
    }
  }

  const notes: string[] = [];
  const fixtureSlugs = params.fixtureProductSlugs ?? [];
  const productionSlugs = new Set(products.map((p) => p.slug));
  const matchesFixtureAcceptanceCatalog =
    fixtureSlugs.length === 0
      ? false
      : fixtureSlugs.every((slug) => productionSlugs.has(slug)) &&
        products.length === fixtureSlugs.length;

  if (!matchesFixtureAcceptanceCatalog && fixtureSlugs.length > 0) {
    const missing = fixtureSlugs.filter((slug) => !productionSlugs.has(slug));
    const extra = [...productionSlugs].filter((slug) => !fixtureSlugs.includes(slug));
    if (missing.length) notes.push(`Нет в production относительно fixture: ${missing.join(", ")}`);
    if (extra.length) notes.push(`Лишнее в production относительно fixture: ${extra.join(", ")}`);
  }

  return {
    catalogKind: params.catalogKind,
    productCount: products.length,
    recipeCount: params.ctx.recipes.length,
    verifiedProductCount: products.filter((p) => p.is_verified).length,
    autogenProductCount: products.filter((p) => p.is_active_for_autogeneration !== false).length,
    productIds: products.map((p) => ({
      slug: p.slug,
      id: p.id,
      verified: p.is_verified,
      autogen: p.is_active_for_autogeneration !== false,
    })),
    oil: [...OIL_PRODUCT_SLUGS].map((slug) => {
      const product = products.find((p) => p.slug === slug);
      return {
        slug,
        id: product?.id ?? null,
        available: Boolean(product),
        verified: product?.is_verified === true,
        autogen: product?.is_active_for_autogeneration !== false,
      };
    }),
    eligibleMains: eligibleMainsForMode(params.ctx, params.mode).length,
    eligibleSnacks: eligibleSnacksForMode(params.ctx, params.mode).length,
    excludedRecipes,
    allergenTags: [
      ...new Set(
        products.flatMap((p) => p.allergen_tags ?? []),
      ),
    ],
    forbiddenProductCount: forbiddenIds.size,
    forbiddenReasons: [...reasons.entries()].map(([id, reason]) => ({
      slug: params.ctx.products.get(id)?.slug ?? id,
      reason,
    })),
    matchesFixtureAcceptanceCatalog,
    notes,
  };
}
