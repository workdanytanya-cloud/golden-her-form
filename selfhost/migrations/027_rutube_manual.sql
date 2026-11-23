-- Ручная подборка подтверждённых роликов. Автоподбор и общие привязки не использует.

CREATE TABLE IF NOT EXISTS public.generator_rutube_manual (
  exercise_id uuid PRIMARY KEY REFERENCES public.exercises(id) ON DELETE RESTRICT,
  collection text NOT NULL CHECK (collection IN ('workout', 'piece')),
  label text NOT NULL,
  note text,
  rutube_video_id text NOT NULL,
  source_url text NOT NULL,
  embed_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT generator_rutube_manual_video_id_unique UNIQUE (rutube_video_id)
);

COMMENT ON TABLE public.generator_rutube_manual IS
  'Дополнительная подборка для ручной замены в черновике. Не заменяет каталог и не меняет выданные версии.';
