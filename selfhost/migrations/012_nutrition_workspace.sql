-- Полная схема workspace-питания. RLS не используется: доступ на уровне приложения.
-- Не изменяет nutrition_plan_versions / assignments / snapshots.

CREATE TABLE IF NOT EXISTS public.dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  tags text[] NOT NULL DEFAULT '{}',
  calories_per_100g numeric(6,2) NOT NULL,
  protein_per_100g numeric(6,2) NOT NULL,
  fat_per_100g numeric(6,2) NOT NULL,
  carbs_per_100g numeric(6,2) NOT NULL,
  portion_weight_g integer NOT NULL,
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  replacements text[] NOT NULL DEFAULT '{}',
  description text,
  image_url text,
  video_url text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS public.food_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  brand text,
  state text NOT NULL,
  measurement_basis text NOT NULL,
  kcal_per_100g numeric(10,4) NOT NULL,
  protein_per_100g numeric(10,4) NOT NULL,
  fat_per_100g numeric(10,4) NOT NULL,
  carbs_per_100g numeric(10,4) NOT NULL,
  fiber_per_100g numeric(10,4),
  density numeric(10,4),
  source_name text NOT NULL,
  source_url text,
  verified_at timestamptz,
  is_verified boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_active_for_autogeneration boolean NOT NULL DEFAULT true,
  allowed_for_snack boolean NOT NULL DEFAULT false,
  requires_cooking boolean NOT NULL DEFAULT false,
  weighing_note text,
  allergen_tags text[] NOT NULL DEFAULT '{}'::text[],
  may_contain_traces text[] NOT NULL DEFAULT '{}'::text[],
  product_group text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS food_products_active_idx ON public.food_products (is_active, is_verified);

CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('main', 'snack')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  prep_time_min int,
  requires_cooking boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  weighing_note text,
  is_nutrient_dense boolean NOT NULL DEFAULT true,
  contains_protein_source boolean NOT NULL DEFAULT false,
  contains_fruit_or_vegetable boolean NOT NULL DEFAULT false,
  is_treat boolean NOT NULL DEFAULT false,
  allowed_schedule_modes text[] NOT NULL DEFAULT ARRAY['two_main_two_snacks', 'one_main_three_snacks']::text[],
  snack_action text,
  is_everyday boolean NOT NULL DEFAULT true,
  is_work_friendly boolean NOT NULL DEFAULT false,
  is_portable boolean NOT NULL DEFAULT false,
  is_batch_cookable boolean NOT NULL DEFAULT false,
  active_prep_minutes int,
  total_cook_minutes int,
  complexity text CHECK (complexity IS NULL OR complexity IN ('easy', 'medium')),
  required_equipment text[] NOT NULL DEFAULT '{}'::text[],
  requires_reheating boolean NOT NULL DEFAULT false,
  is_nutritionally_complete boolean NOT NULL DEFAULT true,
  dietitian_approved boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.food_products(id) ON DELETE RESTRICT,
  min_g int NOT NULL CHECK (min_g >= 0),
  max_g int NOT NULL CHECK (max_g >= min_g),
  default_g int,
  is_scalable boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  optional boolean NOT NULL DEFAULT false,
  UNIQUE (recipe_id, product_id)
);

CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_idx ON public.recipe_ingredients (recipe_id);

CREATE TABLE IF NOT EXISTS public.nutrition_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.client_courses(id) ON DELETE SET NULL,
  meals_per_day integer NOT NULL DEFAULT 5 CHECK (meals_per_day IN (3,5)),
  preferred_products text[] NOT NULL DEFAULT '{}',
  excluded_products text[] NOT NULL DEFAULT '{}',
  target_kcal integer NOT NULL,
  target_protein_g integer NOT NULL,
  target_fat_g integer NOT NULL,
  target_carbs_g integer NOT NULL,
  targets_manual boolean NOT NULL DEFAULT false,
  notes text,
  plan_mode text NOT NULL DEFAULT 'legacy' CHECK (plan_mode IN ('legacy', 'constructor')),
  plan_days_count int NOT NULL DEFAULT 7 CHECK (plan_days_count IN (1, 7, 14, 28)),
  plan_status text NOT NULL DEFAULT 'draft' CHECK (plan_status IN ('draft', 'validated', 'assigned')),
  meal_schedule_mode text NOT NULL DEFAULT 'two_main_two_snacks'
    CHECK (meal_schedule_mode IN (
      'three_main_two_snacks',
      'three_mains_only',
      'one_main_three_snacks',
      'two_main_two_snacks'
    )),
  primary_meal_slot text NOT NULL DEFAULT 'lunch'
    CHECK (primary_meal_slot IN ('breakfast', 'lunch', 'dinner')),
  bmr numeric(10,4),
  tdee numeric(10,4),
  calorie_adjustment_pct numeric(6,2),
  tolerance_kcal int NOT NULL DEFAULT 5,
  tolerance_macro_g numeric(6,2) NOT NULL DEFAULT 1,
  requires_manual_review boolean NOT NULL DEFAULT false,
  review_reason text,
  generated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plans_course_id_key
  ON public.nutrition_plans (course_id)
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS nutrition_plans_user_id_idx ON public.nutrition_plans (user_id);

CREATE TABLE IF NOT EXISTS public.nutrition_plan_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
  day_index integer NOT NULL CHECK (day_index >= 0),
  day_note text,
  meals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (plan_id, day_index)
);

CREATE INDEX IF NOT EXISTS nutrition_plan_days_plan_id_idx ON public.nutrition_plan_days (plan_id);

CREATE TABLE IF NOT EXISTS public.meal_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id uuid NOT NULL REFERENCES public.nutrition_plan_days(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('main1', 'main2', 'main3', 'snack1', 'snack2', 'snack3')),
  recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  recipe_name text NOT NULL,
  requires_cooking boolean NOT NULL DEFAULT false,
  prep_time_min int,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  weighing_note text,
  snack_action text,
  kcal numeric(12,4) NOT NULL,
  protein_g numeric(12,4) NOT NULL,
  fat_g numeric(12,4) NOT NULL,
  carbs_g numeric(12,4) NOT NULL,
  fiber_g numeric(12,4) NOT NULL DEFAULT 0,
  is_valid boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (plan_day_id, slot)
);

CREATE INDEX IF NOT EXISTS meal_plan_items_day_idx ON public.meal_plan_items (plan_day_id);

CREATE TABLE IF NOT EXISTS public.meal_plan_item_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_item_id uuid NOT NULL REFERENCES public.meal_plan_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.food_products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  grams numeric(12,4) NOT NULL,
  weighing_note text,
  kcal_per_100g numeric(10,4) NOT NULL,
  protein_per_100g numeric(10,4) NOT NULL,
  fat_per_100g numeric(10,4) NOT NULL,
  carbs_per_100g numeric(10,4) NOT NULL,
  fiber_per_100g numeric(10,4),
  kcal numeric(12,4) NOT NULL,
  protein_g numeric(12,4) NOT NULL,
  fat_g numeric(12,4) NOT NULL,
  carbs_g numeric(12,4) NOT NULL,
  fiber_g numeric(12,4) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meal_plan_item_ingredients_grams_positive'
  ) THEN
    ALTER TABLE public.meal_plan_item_ingredients
      ADD CONSTRAINT meal_plan_item_ingredients_grams_positive
      CHECK (grams > 0) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.nutrition_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL,
  based_on_version_id uuid REFERENCES public.nutrition_plan_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_trainer_review'
    CHECK (status IN ('pending_trainer_review', 'accepted', 'rejected', 'replaced')),
  assigned_kcal numeric(10,2) NOT NULL DEFAULT 0,
  assigned_protein_g numeric(10,2) NOT NULL DEFAULT 0,
  assigned_fat_g numeric(10,2) NOT NULL DEFAULT 0,
  assigned_carbs_g numeric(10,2) NOT NULL DEFAULT 0,
  recommended_kcal numeric(10,2) NOT NULL,
  recommended_protein_g numeric(10,2) NOT NULL,
  recommended_fat_g numeric(10,2) NOT NULL,
  recommended_carbs_g numeric(10,2) NOT NULL,
  assigned_weight_kg numeric(6,2),
  new_weight_kg numeric(6,2),
  bmr numeric(10,2) NOT NULL,
  tdee numeric(10,2) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS nutrition_recommendations_client_status_idx
  ON public.nutrition_recommendations (client_id, status);

CREATE TABLE IF NOT EXISTS public.nutrition_publish_idempotency (
  idempotency_key text PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.client_courses(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.nutrition_plan_versions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS public.client_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  link text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  client_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  link text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
