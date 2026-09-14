-- Weekly check-ins / workout feedback + idempotency for measurement form resubmits.

CREATE TABLE IF NOT EXISTS public.weekly_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  avg_weight_kg numeric(5,2),
  waist_cm numeric(5,2),
  hips_cm numeric(5,2),
  workouts_completed integer,
  workouts_planned integer,
  avg_steps integer,
  hunger_1_10 smallint CHECK (hunger_1_10 IS NULL OR (hunger_1_10 BETWEEN 1 AND 10)),
  energy_1_10 smallint CHECK (energy_1_10 IS NULL OR (energy_1_10 BETWEEN 1 AND 10)),
  sleep_hours numeric(3,1),
  training_difficulty_1_10 smallint CHECK (
    training_difficulty_1_10 IS NULL OR (training_difficulty_1_10 BETWEEN 1 AND 10)
  ),
  nutrition_adherence_pct smallint CHECK (
    nutrition_adherence_pct IS NULL OR (nutrition_adherence_pct BETWEEN 0 AND 100)
  ),
  pain_reported boolean NOT NULL DEFAULT false,
  what_was_hard text,
  what_liked text,
  wants_change text,
  adaptation_decision text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS weekly_check_ins_user_week_idx
  ON public.weekly_check_ins (user_id, week_start DESC);

CREATE TABLE IF NOT EXISTS public.workout_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.training_programs(id) ON DELETE SET NULL,
  week_index integer NOT NULL DEFAULT 0,
  day_index integer NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  day_title text,
  completed_fully boolean NOT NULL DEFAULT true,
  difficulty_1_10 smallint NOT NULL CHECK (difficulty_1_10 BETWEEN 1 AND 10),
  pain_reported boolean NOT NULL DEFAULT false,
  pain_details text,
  too_easy_exercise_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  too_hard_exercise_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  energy_before_1_10 smallint CHECK (
    energy_before_1_10 IS NULL OR (energy_before_1_10 BETWEEN 1 AND 10)
  ),
  wellbeing_after_1_10 smallint CHECK (
    wellbeing_after_1_10 IS NULL OR (wellbeing_after_1_10 BETWEEN 1 AND 10)
  ),
  notes text,
  adaptation_decision text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS workout_feedback_user_created_idx
  ON public.workout_feedback (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.measurement_write_idempotency (
  idempotency_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS measurement_write_idempotency_user_idx
  ON public.measurement_write_idempotency (user_id);

ALTER TABLE public.admin_notifications
  ADD COLUMN IF NOT EXISTS measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL;
