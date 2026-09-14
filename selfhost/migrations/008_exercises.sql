CREATE TABLE IF NOT EXISTS public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  difficulty text NOT NULL,
  muscle_groups text[] NOT NULL DEFAULT '{}'::text[],
  equipment text[] NOT NULL DEFAULT '{}'::text[],
  tags text[] NOT NULL DEFAULT '{}'::text[],
  cues jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_sets integer NOT NULL DEFAULT 3,
  default_reps text NOT NULL DEFAULT '10-12',
  rest_seconds integer NOT NULL DEFAULT 60,
  tempo text,
  description text,
  gif_url text,
  video_url text,
  video_provider text,
  video_embed_url text,
  video_title text,
  video_status text,
  video_fallback_text text,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT exercises_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS exercises_category_name_idx ON public.exercises (category, name);
CREATE INDEX IF NOT EXISTS exercises_name_idx ON public.exercises (name);

COMMENT ON TABLE public.exercises IS 'Каталог упражнений. Актуальные YouTube/Rutube-ссылки — в exercise_media_bindings.';
