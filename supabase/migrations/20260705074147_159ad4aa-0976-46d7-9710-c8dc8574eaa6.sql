
-- 1) Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS height_cm integer;

-- 2) Admin read access on profiles + user_roles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Measurements table
CREATE TABLE public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  measured_on date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg numeric(5,2),
  waist_cm numeric(5,2),
  hips_cm numeric(5,2),
  chest_cm numeric(5,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurements TO authenticated;
GRANT ALL ON public.measurements TO service_role;

ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own measurements"
  ON public.measurements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own measurements"
  ON public.measurements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own measurements"
  ON public.measurements FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own measurements"
  ON public.measurements FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all measurements"
  ON public.measurements FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert measurements"
  ON public.measurements FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update measurements"
  ON public.measurements FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete measurements"
  ON public.measurements FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER measurements_set_updated_at
  BEFORE UPDATE ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX measurements_user_date_idx
  ON public.measurements(user_id, measured_on DESC);
