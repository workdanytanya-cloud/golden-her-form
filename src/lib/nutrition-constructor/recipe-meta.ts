import type { MealScheduleMode } from "@/lib/nutrition-constructor/config";

export const PROTEIN_SNACK_PRODUCT_SLUGS = new Set([
  "canned-tuna",
  "hard-cheese",
  "lactose-free-milk",
  "walnut",
  "almond",
  "pumpkin-seeds",
]);

export const FRUIT_VEG_PRODUCT_SLUGS = new Set([
  "cucumber",
  "tomato",
  "bell-pepper",
  "napa-cabbage",
  "white-cabbage",
  "zucchini",
  "eggplant",
  "carrot",
  "avocado",
  "apple",
  "banana",
  "cherry",
  "lemon",
  "canned-corn",
]);

export const NUT_SEED_PRODUCT_SLUGS = new Set(["walnut", "almond", "pumpkin-seeds"]);

export const TREAT_PRODUCT_SLUGS = new Set(["stevia-candy", "marshmallow", "dried-mango"]);

export const RAW_MEAT_FISH_SLUGS = new Set([
  "chicken-breast-raw",
  "beef-lean-raw",
  "pollock-raw",
  "egg-whole",
  "buckwheat-dry",
  "rice-white-dry",
  "oats-dry",
]);

export type RecipeMetaInput = {
  meal_type: "main" | "snack";
  requires_cooking: boolean;
  ingredients: Array<{ product_slug: string }>;
  is_treat?: boolean;
  is_nutrient_dense?: boolean;
  contains_protein_source?: boolean;
  contains_fruit_or_vegetable?: boolean;
  allowed_schedule_modes?: MealScheduleMode[];
};

export function inferRecipeMeta(input: RecipeMetaInput) {
  const slugs = input.ingredients.map((i) => i.product_slug);
  const hasProtein = slugs.some((s) => PROTEIN_SNACK_PRODUCT_SLUGS.has(s));
  const hasFruitVeg = slugs.some((s) => FRUIT_VEG_PRODUCT_SLUGS.has(s));
  const hasTreat = slugs.some((s) => TREAT_PRODUCT_SLUGS.has(s));
  const nutCount = slugs.filter((s) => NUT_SEED_PRODUCT_SLUGS.has(s)).length;
  const isNutHeavy = input.meal_type === "snack" && nutCount >= 2;

  const isTreat = input.is_treat ?? hasTreat;
  const containsProtein = input.contains_protein_source ?? hasProtein;
  const containsFruitVeg = input.contains_fruit_or_vegetable ?? hasFruitVeg;

  const isNutrientDense =
    input.is_nutrient_dense ??
    (input.meal_type === "main"
      ? true
      : !isTreat &&
        slugs.length >= 2 &&
        slugs.length <= 4 &&
        (containsProtein || containsFruitVeg) &&
        !isNutHeavy);

  const allowedModes =
    input.allowed_schedule_modes ??
    (isTreat
      ? (["two_main_two_snacks"] as MealScheduleMode[])
      : (["two_main_two_snacks", "one_main_three_snacks"] as MealScheduleMode[]));

  return {
    is_treat: isTreat,
    is_nutrient_dense: isNutrientDense,
    contains_protein_source: containsProtein,
    contains_fruit_or_vegetable: containsFruitVeg,
    allowed_schedule_modes: allowedModes,
    is_nut_heavy: isNutHeavy,
  };
}

export function snackActionForRecipe(slugs: string[]): string {
  if (slugs.includes("lavash")) return "Завернуть в лаваш";
  if (slugs.includes("canned-tuna")) return "Собрать";
  if (slugs.includes("hard-cheese") || slugs.includes("crispbread"))
    return "Нарезать и съесть вместе";
  return "Нарезать и съесть вместе";
}
