-- Конструктор индивидуальных рационов PanovaPRO
-- food_products, recipes, recipe_ingredients + расширение nutrition_plans
-- Безопасность: только CREATE/ALTER IF NOT EXISTS, INSERT ON CONFLICT DO NOTHING в seed.
-- Нет DROP TABLE / TRUNCATE существующих данных.

-- ========== food_products ==========
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
  allowed_for_snack boolean NOT NULL DEFAULT false,
  requires_cooking boolean NOT NULL DEFAULT false,
  weighing_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS food_products_active_idx ON public.food_products (is_active, is_verified);

-- ========== recipes ==========
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ========== recipe_ingredients ==========
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

-- ========== meal_plan_items (constructor snapshot) ==========
CREATE TABLE IF NOT EXISTS public.meal_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id uuid NOT NULL REFERENCES public.nutrition_plan_days(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('main1', 'main2', 'snack1', 'snack2', 'snack3')),
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
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_day_id, slot)
);

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

CREATE INDEX IF NOT EXISTS meal_plan_items_day_idx ON public.meal_plan_items (plan_day_id);

-- ========== extend nutrition_plans ==========
ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS plan_mode text NOT NULL DEFAULT 'legacy'
  CHECK (plan_mode IN ('legacy', 'constructor'));

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS plan_days_count int NOT NULL DEFAULT 7
  CHECK (plan_days_count IN (1, 7, 14, 28));

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'draft'
  CHECK (plan_status IN ('draft', 'validated', 'assigned'));

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS bmr numeric(10,4),
  ADD COLUMN IF NOT EXISTS tdee numeric(10,4),
  ADD COLUMN IF NOT EXISTS calorie_adjustment_pct numeric(6,2),
  ADD COLUMN IF NOT EXISTS tolerance_kcal int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tolerance_macro_g numeric(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text;

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS meal_schedule_mode text NOT NULL DEFAULT 'two_main_two_snacks'
  CHECK (meal_schedule_mode IN ('two_main_two_snacks', 'one_main_three_snacks'));

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS primary_meal_slot text NOT NULL DEFAULT 'lunch'
  CHECK (primary_meal_slot IN ('breakfast', 'lunch', 'dinner'));

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_nutrient_dense boolean NOT NULL DEFAULT true;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS contains_protein_source boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS contains_fruit_or_vegetable boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_treat boolean NOT NULL DEFAULT false;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS allowed_schedule_modes text[] NOT NULL DEFAULT ARRAY['two_main_two_snacks', 'one_main_three_snacks']::text[];
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS snack_action text;

ALTER TABLE public.meal_plan_items
  ADD COLUMN IF NOT EXISTS snack_action text;

-- ========== RLS ==========
ALTER TABLE public.food_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_item_ingredients ENABLE ROW LEVEL SECURITY;

-- food_products: read all authenticated; write admin
DROP POLICY IF EXISTS food_products_select ON public.food_products;
CREATE POLICY food_products_select ON public.food_products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS food_products_admin ON public.food_products;
CREATE POLICY food_products_admin ON public.food_products FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS recipes_select ON public.recipes;
CREATE POLICY recipes_select ON public.recipes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS recipes_admin ON public.recipes;
CREATE POLICY recipes_admin ON public.recipes FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS recipe_ingredients_select ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_select ON public.recipe_ingredients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS recipe_ingredients_admin ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_admin ON public.recipe_ingredients FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- meal_plan_items: admin write; client read only assigned constructor plans
DROP POLICY IF EXISTS meal_plan_items_select ON public.meal_plan_items;
CREATE POLICY meal_plan_items_select ON public.meal_plan_items FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.nutrition_plan_days d
      JOIN public.nutrition_plans p ON p.id = d.plan_id
      WHERE d.id = meal_plan_items.plan_day_id
        AND p.user_id = auth.uid()
        AND COALESCE(p.plan_mode, 'legacy') = 'constructor'
        AND p.plan_status = 'assigned'
    )
  );

DROP POLICY IF EXISTS meal_plan_items_admin ON public.meal_plan_items;
CREATE POLICY meal_plan_items_admin ON public.meal_plan_items FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS meal_plan_item_ingredients_select ON public.meal_plan_item_ingredients;
CREATE POLICY meal_plan_item_ingredients_select ON public.meal_plan_item_ingredients FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.meal_plan_items mi
      JOIN public.nutrition_plan_days d ON d.id = mi.plan_day_id
      JOIN public.nutrition_plans p ON p.id = d.plan_id
      WHERE mi.id = meal_plan_item_ingredients.meal_item_id
        AND p.user_id = auth.uid()
        AND COALESCE(p.plan_mode, 'legacy') = 'constructor'
        AND p.plan_status = 'assigned'
    )
  );

DROP POLICY IF EXISTS meal_plan_item_ingredients_admin ON public.meal_plan_item_ingredients;
CREATE POLICY meal_plan_item_ingredients_admin ON public.meal_plan_item_ingredients FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- ========== Ограничение прав клиента на constructor-планы ==========
-- Клиент не может создавать/менять constructor-рационы и их snapshot.
-- Legacy-меню (plan_mode = legacy) сохраняет прежние права на swap/reshuffle.

DROP POLICY IF EXISTS "Owner updates own plan" ON public.nutrition_plans;
CREATE POLICY "Owner updates own plan"
  ON public.nutrition_plans FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (auth.uid() = user_id AND COALESCE(plan_mode, 'legacy') <> 'constructor')
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (auth.uid() = user_id AND COALESCE(plan_mode, 'legacy') <> 'constructor')
  );

DROP POLICY IF EXISTS "Owner writes own plan" ON public.nutrition_plans;
CREATE POLICY "Owner writes own plan"
  ON public.nutrition_plans FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (auth.uid() = user_id AND COALESCE(plan_mode, 'legacy') <> 'constructor')
  );

DROP POLICY IF EXISTS "Owner deletes own plan" ON public.nutrition_plans;
CREATE POLICY "Owner deletes own plan"
  ON public.nutrition_plans FOR DELETE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (auth.uid() = user_id AND COALESCE(plan_mode, 'legacy') <> 'constructor')
  );

DROP POLICY IF EXISTS "Owner reads own plan" ON public.nutrition_plans;
CREATE POLICY "Owner reads own plan"
  ON public.nutrition_plans FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
      AND (
        COALESCE(plan_mode, 'legacy') <> 'constructor'
        OR plan_status = 'assigned'
      )
    )
  );

DROP POLICY IF EXISTS "Days follow parent plan (insert)" ON public.nutrition_plan_days;
CREATE POLICY "Days follow parent plan (insert)"
  ON public.nutrition_plan_days FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (p.user_id = auth.uid() AND COALESCE(p.plan_mode, 'legacy') <> 'constructor')
        )
    )
  );

DROP POLICY IF EXISTS "Days follow parent plan (update)" ON public.nutrition_plan_days;
CREATE POLICY "Days follow parent plan (update)"
  ON public.nutrition_plan_days FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (p.user_id = auth.uid() AND COALESCE(p.plan_mode, 'legacy') <> 'constructor')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (p.user_id = auth.uid() AND COALESCE(p.plan_mode, 'legacy') <> 'constructor')
        )
    )
  );

DROP POLICY IF EXISTS "Days follow parent plan (delete)" ON public.nutrition_plan_days;
CREATE POLICY "Days follow parent plan (delete)"
  ON public.nutrition_plan_days FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (p.user_id = auth.uid() AND COALESCE(p.plan_mode, 'legacy') <> 'constructor')
        )
    )
  );

GRANT SELECT ON public.food_products TO authenticated;
GRANT SELECT ON public.recipes TO authenticated;
GRANT SELECT ON public.recipe_ingredients TO authenticated;
GRANT SELECT ON public.meal_plan_items TO authenticated;
GRANT SELECT ON public.meal_plan_item_ingredients TO authenticated;

NOTIFY pgrst, 'reload schema';
