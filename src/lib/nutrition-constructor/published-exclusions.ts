import type { Recipe } from "@/lib/nutrition-constructor/types";
import type { NutritionSnapshot } from "@/lib/published-programs/types";

export type PublishedRecipeExclusions = {
  excluded_recipe_ids: string[];
  excluded_variant_groups: string[];
  warning: string | null;
};

/** Extract exclusions from active published nutrition snapshot (no legacy name guessing). */
export function exclusionsFromPublishedNutrition(
  snapshot: NutritionSnapshot | null | undefined,
  recipes: Recipe[],
): PublishedRecipeExclusions {
  if (!snapshot || snapshot.kind !== "constructor") {
    return { excluded_recipe_ids: [], excluded_variant_groups: [], warning: null };
  }
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const bySlug = new Map(recipes.map((recipe) => [recipe.slug, recipe]));
  const recipeIds = new Set<string>();
  const groups = new Set<string>();
  for (const day of snapshot.constructor_days) {
    for (const item of day.items) {
      recipeIds.add(item.recipe_id);
      const recipe = byId.get(item.recipe_id) ?? bySlug.get(item.recipe_id);
      if (recipe?.variant_group) groups.add(recipe.variant_group);
    }
  }
  return {
    excluded_recipe_ids: [...recipeIds],
    excluded_variant_groups: [...groups],
    warning:
      recipeIds.size > 0
        ? `Из нового меню по возможности исключены ${recipeIds.size} блюд активной опубликованной программы.`
        : null,
  };
}
