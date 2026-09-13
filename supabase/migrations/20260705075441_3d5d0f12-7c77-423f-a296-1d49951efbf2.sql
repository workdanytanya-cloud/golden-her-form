
CREATE TABLE public.onboarding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  goal_primary text,
  goal_details text,
  experience text,
  training_days_per_week int,
  session_duration_min int,
  training_location text,
  equipment text[] DEFAULT '{}',
  focus_areas text[] DEFAULT '{}',
  has_injuries boolean DEFAULT false,
  injuries_details text,
  health_conditions text,
  medications text,
  pregnancy_status text,
  sleep_hours numeric,
  stress_level int,
  energy_level int,
  water_liters numeric,
  diet_type text,
  allergies text,
  meals_per_day int,
  favorite_foods text,
  disliked_foods text,
  alcohol_frequency text,
  smoking boolean DEFAULT false,
  activity_level text,
  job_type text,
  motivation text,
  previous_experience text,
  timeframe text,
  expectations text,
  extra jsonb DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_responses TO authenticated;
GRANT ALL ON public.onboarding_responses TO service_role;

ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own onboarding"
  ON public.onboarding_responses FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own onboarding"
  ON public.onboarding_responses FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own onboarding"
  ON public.onboarding_responses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all onboarding"
  ON public.onboarding_responses FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update all onboarding"
  ON public.onboarding_responses FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_onboarding_updated_at
BEFORE UPDATE ON public.onboarding_responses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.notify_admin_on_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _msg text;
  _is_new_completion boolean;
BEGIN
  IF public.has_role(NEW.user_id, 'admin') THEN
    RETURN NEW;
  END IF;

  _is_new_completion := NEW.completed_at IS NOT NULL AND (
    TG_OP = 'INSERT' OR OLD.completed_at IS NULL
  );

  IF NOT _is_new_completion THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Клиент') INTO _name
  FROM public.profiles WHERE id = NEW.user_id;

  _msg := COALESCE(_name, 'Клиент') || ' заполнил(а) анкету онбординга';

  INSERT INTO public.admin_notifications (type, client_id, message)
  VALUES ('onboarding', NEW.user_id, _msg);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_admin_on_onboarding() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER onboarding_notify_admin
AFTER INSERT OR UPDATE ON public.onboarding_responses
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_on_onboarding();
