import type {
  MealScheduleMode,
  PlanDaysCount,
  PlanSlot,
  PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";

export type ProductCategory =
  | "grain"
  | "vegetable"
  | "fruit"
  | "meat"
  | "fish"
  | "sweet"
  | "dairy"
  | "canned"
  | "bakery"
  | "nut_seed"
  | "fat";

export type ProductState = "raw_dry" | "raw" | "canned_drained" | "ready" | "liquid";

export type FoodProduct = {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  brand: string | null;
  state: ProductState;
  measurement_basis: string;
  kcal_per_100g: string;
  protein_per_100g: string;
  fat_per_100g: string;
  carbs_per_100g: string;
  fiber_per_100g: string | null;
  density: string | null;
  source_name: string;
  source_url: string | null;
  verified_at: string | null;
  is_verified: boolean;
  is_active: boolean;
  allowed_for_snack: boolean;
  requires_cooking: boolean;
  weighing_note: string | null;
  allergen_tags?: string[];
  product_group?: string | null;
  /** false — только ручной подбор тренером (например, сливочное масло). */
  is_active_for_autogeneration?: boolean;
};

export type RecipeMealType = "main" | "snack";

export type RecipeComplexity = "easy" | "medium";

export type Recipe = {
  id: string;
  slug: string;
  name: string;
  meal_type: RecipeMealType;
  steps: string[];
  prep_time_min: number | null;
  requires_cooking: boolean;
  is_active: boolean;
  weighing_note: string | null;
  is_nutrient_dense: boolean;
  contains_protein_source: boolean;
  contains_fruit_or_vegetable: boolean;
  is_treat: boolean;
  allowed_schedule_modes: MealScheduleMode[];
  snack_action: string | null;
  is_everyday?: boolean;
  is_work_friendly?: boolean;
  is_portable?: boolean;
  is_batch_cookable?: boolean;
  active_prep_minutes?: number | null;
  total_cook_minutes?: number | null;
  complexity?: RecipeComplexity | null;
  required_equipment?: string[];
  requires_reheating?: boolean;
  is_nutritionally_complete?: boolean;
  dietitian_approved?: boolean;
};

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  product_id: string;
  min_g: number;
  max_g: number;
  default_g: number | null;
  is_scalable: boolean;
  sort_order: number;
  optional: boolean;
};

export type IngredientLine = {
  product_id: string;
  product_name: string;
  grams: string;
  weighing_note: string | null;
  kcal_per_100g: string;
  protein_per_100g: string;
  fat_per_100g: string;
  carbs_per_100g: string;
  fiber_per_100g: string | null;
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
  sort_order: number;
};

export type MealPlanItem = {
  id?: string;
  slot: PlanSlot;
  recipe_id: string;
  recipe_name: string;
  requires_cooking: boolean;
  prep_time_min: number | null;
  steps: string[];
  weighing_note: string | null;
  snack_action?: string | null;
  ingredients: IngredientLine[];
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
  is_valid: boolean;
};

export type ConstructorDay = {
  day_index: number;
  day_note: string | null;
  items: MealPlanItem[];
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
  is_valid: boolean;
};

export type MacroComparisonRow = {
  label: string;
  target: number;
  actual: number;
  diff: number;
};

export type OptimizerDiagnostics = {
  combinations_checked: number;
  elapsed_ms: number;
  timed_out: boolean;
  infeasible: boolean;
  last_failure_reason: string | null;
  days_with_issues: number;
};

export type PlanValidationResult = {
  is_valid: boolean;
  kbju_acceptable?: boolean;
  message: string | null;
  comparison: MacroComparisonRow[];
  days: ConstructorDay[];
  best_approximation?: {
    days: ConstructorDay[];
    comparison: MacroComparisonRow[];
  };
  diagnostics?: OptimizerDiagnostics;
};

export type GenerateConstructorPlanInput = {
  targets: import("@/lib/nutrition-constructor/decimal-math").MacroBreakdown;
  days_count: PlanDaysCount;
  excluded_product_ids: string[];
  tolerance: {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
  meal_schedule_mode: MealScheduleMode;
  primary_meal_slot: PrimaryMealSlot;
};

export type DayStructureCheck = {
  mains: { actual: number; expected: number };
  snacks: { actual: number; expected: number };
  noCookSnacks: { actual: number; expected: number };
  nutrientDenseSnacks: { actual: number; expected: number };
};

export function checkDayStructure(day: ConstructorDay, mode: MealScheduleMode): DayStructureCheck {
  const mains = day.items.filter((i) => i.slot.startsWith("main"));
  const snacks = day.items.filter((i) => i.slot.startsWith("snack"));
  const expectedMains =
    mode === "three_main_two_snacks" || mode === "three_mains_only"
      ? 3
      : mode === "one_main_three_snacks"
        ? 1
        : 2;
  const expectedSnacks =
    mode === "three_main_two_snacks"
      ? 2
      : mode === "three_mains_only"
        ? 0
        : mode === "one_main_three_snacks"
          ? 3
          : 2;
  const noCookSnacks = snacks.filter((s) => !s.requires_cooking).length;
  const nutrientDense = snacks.filter(
    (s) => s.snack_action !== undefined || !s.requires_cooking,
  ).length;

  return {
    mains: { actual: mains.length, expected: expectedMains },
    snacks: { actual: snacks.length, expected: expectedSnacks },
    noCookSnacks: { actual: noCookSnacks, expected: expectedSnacks },
    nutrientDenseSnacks: { actual: nutrientDense, expected: expectedSnacks },
  };
}
