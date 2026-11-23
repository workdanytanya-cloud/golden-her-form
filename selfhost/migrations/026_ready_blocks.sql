-- Готовые блоки разминки и заминки только для новых программ.
-- Не заменяет exercise_media_bindings и не меняет уже опубликованные версии.

CREATE TABLE IF NOT EXISTS public.generator_ready_blocks (
  id uuid PRIMARY KEY REFERENCES public.exercises(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('warmup', 'cooldown')),
  label text NOT NULL,
  covers_mobility boolean NOT NULL DEFAULT false,
  covers_activation boolean NOT NULL DEFAULT false,
  equipment text[] NOT NULL DEFAULT '{}'::text[],
  rutube_video_id text NOT NULL,
  source_url text NOT NULL,
  embed_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT generator_ready_blocks_video_id_unique UNIQUE (rutube_video_id)
);

COMMENT ON TABLE public.generator_ready_blocks IS
  'Варианты готовых блоков для новых тренировок. Мобильность и активация отмечаются по содержанию ролика, не по названию.';
