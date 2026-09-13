-- Weekly check-ins and post-workout feedback for adaptation engine

CREATE TABLE public.weekly_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  avg_weight_kg numeric(5,2),
  waist_cm numeric(5,2),
  hips_cm numeric(5,2),
  workouts_completed integer,
  workouts_planned integer,
  avg_steps integer,
  hunger_1_10 smallint CHECK (hunger_1_10 IS NULL OR hunger_1_10 BETWEEN 1 AND 10),
  energy_1_10 smallint CHECK (energy_1_10 IS NULL OR energy_1_10 BETWEEN 1 AND 10),
  sleep_hours numeric(3,1),
  training_difficulty_1_10 smallint CHECK (
    training_difficulty_1_10 IS NULL OR training_difficulty_1_10 BETWEEN 1 AND 10
  ),
  nutrition_adherence_pct smallint CHECK (
    nutrition_adherence_pct IS NULL OR nutrition_adherence_pct BETWEEN 0 AND 100
  ),
  pain_reported boolean NOT NULL DEFAULT false,
  what_was_hard text,
  what_liked text,
  wants_change text,
  adaptation_decision text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

CREATE TABLE public.workout_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.training_programs(id) ON DELETE SET NULL,
  week_index integer NOT NULL DEFAULT 0,
  day_index integer NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  day_title text,
  completed_fully boolean NOT NULL DEFAULT true,
  difficulty_1_10 smallint NOT NULL CHECK (difficulty_1_10 BETWEEN 1 AND 10),
  pain_reported boolean NOT NULL DEFAULT false,
  pain_details text,
  too_easy_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  too_hard_exercise_ids uuid[] NOT NULL DEFAULT '{}',
  energy_before_1_10 smallint CHECK (energy_before_1_10 IS NULL OR energy_before_1_10 BETWEEN 1 AND 10),
  wellbeing_after_1_10 smallint CHECK (
    wellbeing_after_1_10 IS NULL OR wellbeing_after_1_10 BETWEEN 1 AND 10
  ),
  notes text,
  adaptation_decision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_check_ins TO authenticated;
GRANT ALL ON public.weekly_check_ins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_feedback TO authenticated;
GRANT ALL ON public.workout_feedback TO service_role;

ALTER TABLE public.weekly_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own weekly check-ins"
  ON public.weekly_check_ins FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own weekly check-ins"
  ON public.weekly_check_ins FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own weekly check-ins"
  ON public.weekly_check_ins FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all weekly check-ins"
  ON public.weekly_check_ins FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage weekly check-ins"
  ON public.weekly_check_ins FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view own workout feedback"
  ON public.workout_feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own workout feedback"
  ON public.workout_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all workout feedback"
  ON public.workout_feedback FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage workout feedback"
  ON public.workout_feedback FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TRIGGER weekly_check_ins_set_updated_at
  BEFORE UPDATE ON public.weekly_check_ins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX weekly_check_ins_user_week_idx ON public.weekly_check_ins (user_id, week_start DESC);
CREATE INDEX workout_feedback_user_created_idx ON public.workout_feedback (user_id, created_at DESC);
