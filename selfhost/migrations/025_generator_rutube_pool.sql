-- Пул роликов только для новых программ. Общие media bindings и выданные версии не меняет.

CREATE TABLE IF NOT EXISTS public.generator_rutube_pool (
  exercise_id uuid PRIMARY KEY REFERENCES public.exercises(id) ON DELETE RESTRICT,
  rutube_video_id text NOT NULL,
  source_url text NOT NULL,
  embed_url text NOT NULL,
  studio_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT generator_rutube_pool_video_id_unique UNIQUE (rutube_video_id)
);

ALTER TABLE public.snapshot_exercise_media_bindings
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS embed_url text;

COMMENT ON TABLE public.generator_rutube_pool IS
  'Подтверждённые ролики канала для генератора новых тренировок. Не заменяет exercise_media_bindings.';
