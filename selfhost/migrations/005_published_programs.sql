CREATE TABLE IF NOT EXISTS public.nutrition_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.client_courses(id) ON DELETE SET NULL,
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid REFERENCES public.nutrition_plan_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, version)
);

CREATE INDEX IF NOT EXISTS nutrition_plan_versions_client_status_idx
  ON public.nutrition_plan_versions (client_id, status);
CREATE INDEX IF NOT EXISTS nutrition_plan_versions_course_idx
  ON public.nutrition_plan_versions (course_id);

CREATE TABLE IF NOT EXISTS public.training_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.client_courses(id) ON DELETE SET NULL,
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid REFERENCES public.training_program_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, version)
);

CREATE INDEX IF NOT EXISTS training_program_versions_client_status_idx
  ON public.training_program_versions (client_id, status);
CREATE INDEX IF NOT EXISTS training_program_versions_course_idx
  ON public.training_program_versions (course_id);

CREATE TABLE IF NOT EXISTS public.client_program_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nutrition', 'training')),
  course_id uuid REFERENCES public.client_courses(id) ON DELETE SET NULL,
  active_version_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, kind, course_id)
);

CREATE INDEX IF NOT EXISTS client_program_assignments_client_idx
  ON public.client_program_assignments (client_id, kind);

CREATE TABLE IF NOT EXISTS public.program_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nutrition', 'training')),
  action text NOT NULL,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  from_version_id uuid,
  to_version_id uuid,
  measurement_id uuid,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS program_change_log_client_idx
  ON public.program_change_log (client_id, created_at DESC);
