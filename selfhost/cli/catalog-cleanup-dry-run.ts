import { buildInMemoryCatalog } from "../../src/lib/nutrition-constructor/repo";
import { SEED_PRODUCTS, SEED_RECIPES } from "../../src/lib/nutrition-constructor/seed-data";
import { ARCHIVED_DUPLICATE_SLUGS } from "../../src/lib/nutrition-constructor/catalog-policy";
import { isAutoGenerationEligible } from "../../src/lib/nutrition-constructor/recipe-selection";
import {
  MEAL_SCHEDULE_MODES,
  expectedMainCount,
  expectedSnackCount,
} from "../../src/lib/nutrition-constructor/config";

const ctx = buildInMemoryCatalog();
const active = ctx.recipes.filter((recipe) => recipe.is_active);
const eligible = active.filter((recipe) => isAutoGenerationEligible(recipe));
const byMode = Object.fromEntries(
  MEAL_SCHEDULE_MODES.map((mode) => {
    const mains = eligible.filter(
      (recipe) => recipe.meal_type === "main" && recipe.allowed_schedule_modes.includes(mode),
    );
    const snacks = eligible.filter(
      (recipe) => recipe.meal_type === "snack" && recipe.allowed_schedule_modes.includes(mode),
    );
    const groups = (rows: typeof mains) => new Set(rows.map((recipe) => recipe.variant_group)).size;
    return [
      mode,
      {
        needMains: expectedMainCount(mode) * 7,
        needSnacks: expectedSnackCount(mode) * 7,
        mains: mains.length,
        snacks: snacks.length,
        noCookSnacks: snacks.filter((recipe) => !recipe.requires_cooking).length,
        noCookSnackGroups: groups(snacks.filter((recipe) => !recipe.requires_cooking)),
        mainGroups: groups(mains),
        snackGroups: groups(snacks),
      },
    ];
  }),
);

console.log(
  JSON.stringify(
    {
      dry_run: true,
      writes: false,
      seed_products: SEED_PRODUCTS.length,
      seed_recipes: SEED_RECIPES.length,
      verified_products: ctx.products.size,
      unverified_excluded: SEED_PRODUCTS.filter((product) => !product.is_verified).map(
        (product) => product.slug,
      ),
      recipes_in_memory: ctx.recipes.length,
      active_recipes: active.length,
      archived_duplicates: [...ARCHIVED_DUPLICATE_SLUGS],
      eligible_count: eligible.length,
      byMode,
    },
    null,
    2,
  ),
);
