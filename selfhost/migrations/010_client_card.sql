-- Поля карточки клиента и курсов. Идемпотентно, UUID сохраняются.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_reheat_food boolean,
  ADD COLUMN IF NOT EXISTS can_take_food_to_work boolean,
  ADD COLUMN IF NOT EXISTS disliked_products text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_food_products text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS food_allergies text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS food_intolerances text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS max_prep_minutes integer,
  ADD COLUMN IF NOT EXISTS preferred_main_meal_time text,
  ADD COLUMN IF NOT EXISTS preferred_meal_schedule text;

CREATE TABLE IF NOT EXISTS public.onboarding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  activity_level text,
  alcohol_frequency text,
  allergies text,
  completed_at timestamptz,
  diet_type text,
  disliked_foods text,
  energy_level integer,
  equipment text[],
  expectations text,
  experience text,
  extra jsonb,
  favorite_foods text,
  focus_areas text[],
  goal_details text,
  goal_primary text,
  has_injuries boolean,
  health_conditions text,
  injuries_details text,
  job_type text,
  meals_per_day integer,
  medications text,
  motivation text,
  pregnancy_status text,
  previous_experience text,
  session_duration_min integer,
  sleep_hours numeric,
  smoking boolean,
  stress_level integer,
  timeframe text,
  training_days_per_week integer,
  training_location text,
  water_liters numeric,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS onboarding_responses_user_id_idx ON public.onboarding_responses (user_id);

CREATE TABLE IF NOT EXISTS public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  measured_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  weight_kg numeric,
  waist_cm numeric,
  hips_cm numeric,
  chest_cm numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS measurements_user_measured_idx
  ON public.measurements (user_id, measured_on DESC);

CREATE INDEX IF NOT EXISTS client_courses_status_idx ON public.client_courses (client_id, status);
