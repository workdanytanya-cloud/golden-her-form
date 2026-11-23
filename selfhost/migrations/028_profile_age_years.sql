ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_years integer;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_age_years_range;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_age_years_range
  CHECK (age_years IS NULL OR (age_years BETWEEN 14 AND 100));
