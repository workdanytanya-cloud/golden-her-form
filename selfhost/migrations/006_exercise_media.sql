CREATE TABLE IF NOT EXISTS public.exercise_media_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('youtube', 'rutube', 'external', 'none')),
  source_url text,
  embed_url text,
  title text,
  status text NOT NULL DEFAULT 'unchecked'
    CHECK (status IN ('ok', 'unavailable', 'unchecked')),
  fallback_text text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS exercise_media_bindings_status_idx
  ON public.exercise_media_bindings (status);

CREATE TABLE IF NOT EXISTS public.snapshot_exercise_media_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  snapshot_exercise_key text NOT NULL,
  exercise_id uuid,
  confirmed_by_trainer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (version_id, snapshot_exercise_key)
);

CREATE INDEX IF NOT EXISTS snapshot_exercise_media_bindings_version_idx
  ON public.snapshot_exercise_media_bindings (version_id);

CREATE TABLE IF NOT EXISTS public.exercise_media_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL,
  old_url text,
  new_url text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS exercise_media_change_log_exercise_idx
  ON public.exercise_media_change_log (exercise_id, changed_at DESC);
