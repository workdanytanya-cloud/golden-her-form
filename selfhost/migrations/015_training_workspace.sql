-- Editable training drafts (workspace), separate from immutable training_program_versions.
-- Mirrors nutrition_plans / nutrition_publish_idempotency from 012.

CREATE TABLE IF NOT EXISTS public.training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE,
  sessions_per_week int NOT NULL DEFAULT 3 CHECK (sessions_per_week IN (3, 4)),
  goal text,
  level text NOT NULL DEFAULT 'beginner',
  has_injuries boolean NOT NULL DEFAULT false,
  injuries_details text,
  equipment text[] NOT NULL DEFAULT '{}'::text[],
  location text,
  notes text,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  targets_manual boolean NOT NULL DEFAULT false,
  program_weeks int NOT NULL DEFAULT 1 CHECK (program_weeks >= 1 AND program_weeks <= 12),
  generated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE UNIQUE INDEX IF NOT EXISTS training_programs_course_id_key
  ON public.training_programs (course_id)
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_programs_user_id_idx
  ON public.training_programs (user_id);

CREATE TABLE IF NOT EXISTS public.training_program_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.training_programs(id) ON DELETE CASCADE,
  week_index int NOT NULL DEFAULT 0 CHECK (week_index >= 0 AND week_index <= 11),
  day_index int NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  is_rest boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '',
  focus text,
  description text,
  warmup jsonb NOT NULL DEFAULT '[]'::jsonb,
  exercises jsonb NOT NULL DEFAULT '[]'::jsonb,
  cooldown jsonb NOT NULL DEFAULT '[]'::jsonb,
  day_note text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE (program_id, week_index, day_index)
);

CREATE INDEX IF NOT EXISTS training_program_days_program_id_idx
  ON public.training_program_days (program_id);

CREATE TABLE IF NOT EXISTS public.training_publish_idempotency (
  idempotency_key text PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.client_courses(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.training_program_versions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
