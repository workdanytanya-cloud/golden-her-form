-- PanovaPRO nutrition constructor v2: oils, recipe metadata, new schedule modes, client prefs
-- Idempotent: safe to re-run. Does not touch published program snapshots.

-- ========== food_products: oils ==========
INSERT INTO public.food_products (
  slug, name, category, state, measurement_basis,
  kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g,
  source_name, is_verified, is_active, allowed_for_snack, requires_cooking, weighing_note
) VALUES
  ('olive-oil', 'Оливковое масло', 'fat', 'ready', 'per_100g', 884, 0, 100, 0, 0, 'USDA FDC 171413', true, true, false, false, 'Точное количество в граммах.'),
  ('sunflower-oil', 'Подсолнечное масло', 'fat', 'ready', 'per_100g', 884, 0, 100, 0, 0, 'USDA FDC 171028', true, true, false, false, 'Точное количество в граммах.'),
  ('butter', 'Сливочное масло', 'fat', 'ready', 'per_100g', 717, 0.85, 81.11, 0.06, 0, 'USDA FDC 173410', true, true, false, false, 'Точное количество в граммах.')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.food_products ADD COLUMN IF NOT EXISTS is_active_for_autogeneration boolean NOT NULL DEFAULT true;

UPDATE public.food_products
SET is_active_for_autogeneration = false,
    allergen_tags = ARRAY['dairy', 'lactose', 'milk']::text[]
WHERE slug = 'butter';

UPDATE public.food_products
SET is_active_for_autogeneration = true
WHERE slug IN ('olive-oil', 'sunflower-oil');

-- ========== recipes: metadata columns ==========
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_everyday boolean NOT NULL DEFAULT true;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_work_friendly boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_portable boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_batch_cookable boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS active_prep_minutes int;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS total_cook_minutes int;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS complexity text CHECK (complexity IS NULL OR complexity IN ('easy', 'medium'));
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS required_equipment text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS requires_reheating boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_nutritionally_complete boolean NOT NULL DEFAULT true;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS dietitian_approved boolean NOT NULL DEFAULT true;

-- ========== meal_plan_items: slot main3 ==========
ALTER TABLE public.meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_slot_check;
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_slot_check
  CHECK (slot IN ('main1', 'main2', 'main3', 'snack1', 'snack2', 'snack3'));

-- ========== nutrition_plans: schedule modes ==========
ALTER TABLE public.nutrition_plans DROP CONSTRAINT IF EXISTS nutrition_plans_meal_schedule_mode_check;
ALTER TABLE public.nutrition_plans ADD CONSTRAINT nutrition_plans_meal_schedule_mode_check
  CHECK (meal_schedule_mode IN (
    'three_main_two_snacks',
    'three_mains_only',
    'one_main_three_snacks',
    'two_main_two_snacks'
  ));

-- Client preference fields (onboarding / profile)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_meal_schedule text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_main_meal_time text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS can_take_food_to_work boolean;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS can_reheat_food boolean;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS max_prep_minutes int;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS disliked_products text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS food_allergies text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS food_intolerances text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS excluded_food_products text[] NOT NULL DEFAULT '{}'::text[];

-- Product allergen tags
ALTER TABLE public.food_products ADD COLUMN IF NOT EXISTS allergen_tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.food_products ADD COLUMN IF NOT EXISTS product_group text;
ALTER TABLE public.food_products ADD COLUMN IF NOT EXISTS may_contain_traces text[] NOT NULL DEFAULT '{}'::text[];
