/**
 * Неизменяемые опубликованные версии меню и тренировок.
 * Черновик живёт в nutrition_plans / training_programs.
 * Клиент видит только snapshot из *_plan_versions.
 */

export const PROGRAM_VERSION_STATUSES = ["draft", "published", "superseded", "archived"] as const;
export type ProgramVersionStatus = (typeof PROGRAM_VERSION_STATUSES)[number];

export const RECOMMENDATION_STATUSES = [
  "pending_trainer_review",
  "accepted",
  "rejected",
  "replaced",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export type MacroTargetsSnapshot = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type FrozenIngredient = {
  product_id: string;
  product_name: string;
  grams: string;
  weighing_note: string | null;
  measurement_state: string | null;
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

export type FrozenMealItem = {
  slot: string;
  recipe_id: string;
  recipe_name: string;
  requires_cooking: boolean;
  prep_time_min: number | null;
  steps: string[];
  weighing_note: string | null;
  snack_action: string | null;
  replacements: string[];
  ingredients: FrozenIngredient[];
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
};

export type FrozenNutritionDay = {
  day_index: number;
  day_note: string | null;
  items: FrozenMealItem[];
  kcal: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  fiber_g: string;
};

export type FrozenLegacyMeal = {
  slot: string;
  portion_g: number;
  note: string | null;
  dish: {
    id: string;
    slug: string;
    name: string;
    meal_type: string;
    calories_per_100g: number;
    protein_per_100g: number;
    fat_per_100g: number;
    carbs_per_100g: number;
    ingredients: unknown;
    steps: string[];
    replacements: string[];
    description: string | null;
  };
};

export type NutritionSnapshot = {
  kind: "constructor" | "legacy";
  meal_schedule_mode: string;
  primary_meal_slot: string;
  meals_per_day: number;
  targets: MacroTargetsSnapshot;
  bmr: number | null;
  tdee: number | null;
  calorie_adjustment_pct: number | null;
  constructor_days: FrozenNutritionDay[];
  legacy_days: Array<{
    day_index: number;
    day_note: string | null;
    meals: FrozenLegacyMeal[];
  }>;
  notes: string | null;
  reason: string | null;
};

export type FrozenExercise = {
  id: string;
  slug: string;
  name: string;
  category: string;
  muscle_groups: string[];
  equipment: string[];
  difficulty: string;
  tags: string[];
  description: string | null;
  cues: string[];
  common_mistakes: string[];
  gif_url: string | null;
  video_url: string | null;
  default_sets: number;
  default_reps: string;
  tempo: string | null;
  rest_seconds: number;
};

export type FrozenExerciseSet = {
  exercise_id: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  tempo: string | null;
  note: string | null;
  exercise: FrozenExercise | null;
};

export type FrozenTrainingDay = {
  week_index: number;
  day_index: number;
  is_rest: boolean;
  title: string;
  focus: string | null;
  description: string | null;
  warmup: FrozenExerciseSet[];
  exercises: FrozenExerciseSet[];
  cooldown: FrozenExerciseSet[];
  day_note: string | null;
};

export type TrainingSnapshot = {
  name: string;
  sessions_per_week: number;
  goal: string | null;
  level: string;
  has_injuries: boolean;
  injuries_details: string | null;
  equipment: string[];
  location: string | null;
  notes: string | null;
  faq: unknown;
  program_weeks: number;
  days: FrozenTrainingDay[];
};

export type VersionMeta = {
  id: string;
  client_id: string;
  version: number;
  status: ProgramVersionStatus;
  content_hash: string;
  parent_version_id: string | null;
  created_at: string;
  created_by: string | null;
  published_at: string | null;
  published_by: string | null;
};

export type NutritionRecommendation = {
  id?: string;
  client_id: string;
  measurement_id: string | null;
  based_on_version_id: string | null;
  status: RecommendationStatus;
  assigned_kcal: number;
  assigned_protein_g: number;
  assigned_fat_g: number;
  assigned_carbs_g: number;
  recommended_kcal: number;
  recommended_protein_g: number;
  recommended_fat_g: number;
  recommended_carbs_g: number;
  assigned_weight_kg: number | null;
  new_weight_kg: number | null;
  bmr: number;
  tdee: number;
  reason: string | null;
};
