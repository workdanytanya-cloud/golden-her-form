ALTER TABLE public.client_courses
  ADD COLUMN IF NOT EXISTS nutrition_generation_status text,
  ADD COLUMN IF NOT EXISTS training_generation_status text,
  ADD COLUMN IF NOT EXISTS nutrition_generation_error text,
  ADD COLUMN IF NOT EXISTS training_generation_error text,
  ADD COLUMN IF NOT EXISTS nutrition_generation_token text,
  ADD COLUMN IF NOT EXISTS training_generation_token text,
  ADD COLUMN IF NOT EXISTS nutrition_generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS training_generation_started_at timestamptz;

ALTER TABLE public.client_courses
  DROP CONSTRAINT IF EXISTS client_courses_nutrition_generation_status_check;
ALTER TABLE public.client_courses
  ADD CONSTRAINT client_courses_nutrition_generation_status_check
  CHECK (
    nutrition_generation_status IS NULL
    OR nutrition_generation_status IN ('pending', 'generating', 'ready', 'failed')
  );

ALTER TABLE public.client_courses
  DROP CONSTRAINT IF EXISTS client_courses_training_generation_status_check;
ALTER TABLE public.client_courses
  ADD CONSTRAINT client_courses_training_generation_status_check
  CHECK (
    training_generation_status IS NULL
    OR training_generation_status IN ('pending', 'generating', 'ready', 'failed')
  );
