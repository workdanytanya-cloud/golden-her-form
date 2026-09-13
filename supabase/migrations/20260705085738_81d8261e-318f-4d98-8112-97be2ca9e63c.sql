
-- === Dishes catalog ===
CREATE TABLE public.dishes (
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dishes TO authenticated;
GRANT ALL ON public.dishes TO service_role;

ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated user can read dishes"
  ON public.dishes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage dishes"
  ON public.dishes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER dishes_set_updated_at
  BEFORE UPDATE ON public.dishes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === Nutrition plans (one per client) ===
CREATE TABLE public.nutrition_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  meals_per_day integer NOT NULL DEFAULT 5 CHECK (meals_per_day IN (3,5)),
  preferred_products text[] NOT NULL DEFAULT '{}',
  excluded_products text[] NOT NULL DEFAULT '{}',
  target_kcal integer NOT NULL,
  target_protein_g integer NOT NULL,
  target_fat_g integer NOT NULL,
  target_carbs_g integer NOT NULL,
  targets_manual boolean NOT NULL DEFAULT false,
  notes text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_plans TO authenticated;
GRANT ALL ON public.nutrition_plans TO service_role;

ALTER TABLE public.nutrition_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own plan"
  ON public.nutrition_plans FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner writes own plan"
  ON public.nutrition_plans FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner updates own plan"
  ON public.nutrition_plans FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner deletes own plan"
  ON public.nutrition_plans FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER nutrition_plans_set_updated_at
  BEFORE UPDATE ON public.nutrition_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === Days of the plan (7 rows per plan) ===
CREATE TABLE public.nutrition_plan_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.nutrition_plans(id) ON DELETE CASCADE,
  day_index integer NOT NULL CHECK (day_index BETWEEN 0 AND 6),
  day_note text,
  meals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id, day_index)
);

CREATE INDEX nutrition_plan_days_plan_id_idx ON public.nutrition_plan_days(plan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_plan_days TO authenticated;
GRANT ALL ON public.nutrition_plan_days TO service_role;

ALTER TABLE public.nutrition_plan_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Days follow parent plan (read)"
  ON public.nutrition_plan_days FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Days follow parent plan (insert)"
  ON public.nutrition_plan_days FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Days follow parent plan (update)"
  ON public.nutrition_plan_days FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Days follow parent plan (delete)"
  ON public.nutrition_plan_days FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE TRIGGER nutrition_plan_days_set_updated_at
  BEFORE UPDATE ON public.nutrition_plan_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === Gender field on profile (for BMR) ===
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('female','male'));
