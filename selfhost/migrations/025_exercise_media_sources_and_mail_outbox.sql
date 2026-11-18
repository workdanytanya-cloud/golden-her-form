-- Несколько подтверждённых источников одного упражнения и очередь писем.
-- Не изменяет published snapshots, content_hash, assignments и password_hash.

CREATE TABLE IF NOT EXISTS public.exercise_media_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('youtube', 'rutube', 'external', 'local')),
  source_url text NOT NULL,
  embed_url text,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'unavailable', 'unchecked', 'needs_confirmation')),
  priority integer NOT NULL DEFAULT 100,
  title text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT exercise_media_sources_unique UNIQUE (exercise_id, provider, source_url),
  CONSTRAINT exercise_media_sources_https CHECK (
    source_url ~ '^https://'
    OR (provider = 'local' AND source_url ~ '^/api/selfhost/media')
  )
);

CREATE INDEX IF NOT EXISTS exercise_media_sources_exercise_idx
  ON public.exercise_media_sources (exercise_id, priority, created_at);

CREATE TABLE IF NOT EXISTS public.mail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS mail_outbox_queued_idx
  ON public.mail_outbox (next_attempt_at)
  WHERE status = 'queued';

-- Точная привязка каталога: уже сохранённый binding по exercise_id.
INSERT INTO public.exercise_media_sources (
  exercise_id, provider, source_url, embed_url, status, priority, title, verified_at
)
SELECT
  b.exercise_id,
  CASE
    WHEN b.source_url ILIKE '%rutube.ru%' OR b.source_url ILIKE '%rutube.com%' THEN 'rutube'
    WHEN b.source_url ILIKE '%youtube.%' OR b.source_url ILIKE '%youtu.be%' OR b.source_url ILIKE '%youtube-nocookie.com%' THEN 'youtube'
    WHEN b.source_url ~ '^/api/selfhost/media' THEN 'local'
    WHEN b.provider IN ('youtube', 'rutube', 'external') THEN b.provider
    ELSE 'external'
  END,
  b.source_url,
  NULL,
  CASE WHEN b.status = 'ok' THEN 'ok' ELSE 'needs_confirmation' END,
  CASE
    WHEN b.source_url ILIKE '%rutube.%' THEN 10
    WHEN b.source_url ~ '^/api/selfhost/media' THEN 20
    WHEN b.provider = 'external' THEN 30
    ELSE 40
  END,
  b.title,
  CASE WHEN b.status = 'ok' THEN (now() AT TIME ZONE 'utc') ELSE NULL END
FROM public.exercise_media_bindings b
WHERE b.source_url IS NOT NULL
  AND b.source_url <> ''
  AND b.source_url NOT ILIKE '%supabase%'
  AND b.source_url NOT ILIKE '%/storage/v1/object/%'
  AND (
    b.source_url ~ '^https://'
    OR b.source_url ~ '^/api/selfhost/media'
  )
ON CONFLICT (exercise_id, provider, source_url) DO NOTHING;

-- Поле каталога exercises.video_url, если такого провайдера ещё нет.
INSERT INTO public.exercise_media_sources (
  exercise_id, provider, source_url, embed_url, status, priority, title, verified_at
)
SELECT
  e.id,
  CASE
    WHEN e.video_url ILIKE '%rutube.%' THEN 'rutube'
    WHEN e.video_url ILIKE '%youtube.%' OR e.video_url ILIKE '%youtu.be%' THEN 'youtube'
    WHEN e.video_url ~ '^/api/selfhost/media' THEN 'local'
    ELSE 'external'
  END,
  e.video_url,
  NULL,
  'ok',
  CASE
    WHEN e.video_url ILIKE '%rutube.%' THEN 10
    WHEN e.video_url ~ '^/api/selfhost/media' THEN 20
    WHEN e.video_url ILIKE '%youtube.%' OR e.video_url ILIKE '%youtu.be%' THEN 40
    ELSE 30
  END,
  e.video_title,
  (now() AT TIME ZONE 'utc')
FROM public.exercises e
WHERE e.video_url IS NOT NULL
  AND e.video_url <> ''
  AND e.video_url NOT ILIKE '%supabase%'
  AND e.video_url NOT ILIKE '%/storage/v1/object/%'
  AND (e.video_url ~ '^https://' OR e.video_url ~ '^/api/selfhost/media')
  AND NOT EXISTS (
    SELECT 1 FROM public.exercise_media_sources s
    WHERE s.exercise_id = e.id
      AND s.provider = CASE
        WHEN e.video_url ILIKE '%rutube.%' THEN 'rutube'
        WHEN e.video_url ILIKE '%youtube.%' OR e.video_url ILIKE '%youtu.be%' THEN 'youtube'
        WHEN e.video_url ~ '^/api/selfhost/media' THEN 'local'
        ELSE 'external'
      END
  )
ON CONFLICT (exercise_id, provider, source_url) DO NOTHING;

-- Подтверждённый alias: resolved_exercise_id уже сопоставлен тренером.
INSERT INTO public.exercise_media_sources (
  exercise_id, provider, source_url, embed_url, status, priority, title, verified_at
)
SELECT
  u.resolved_exercise_id,
  CASE
    WHEN u.source_url ILIKE '%rutube.%' THEN 'rutube'
    WHEN u.source_url ILIKE '%youtube.%' OR u.source_url ILIKE '%youtu.be%' THEN 'youtube'
    ELSE 'external'
  END,
  u.source_url,
  NULL,
  'ok',
  CASE WHEN u.source_url ILIKE '%rutube.%' THEN 10 ELSE 40 END,
  u.title,
  (now() AT TIME ZONE 'utc')
FROM public.unmatched_exercise_media u
WHERE u.resolved_exercise_id IS NOT NULL
  AND u.source_url IS NOT NULL
  AND u.source_url ~ '^https://'
  AND u.source_url NOT ILIKE '%supabase%'
  AND u.status = 'ok'
  AND NOT EXISTS (
    SELECT 1 FROM public.exercise_media_sources s
    WHERE s.exercise_id = u.resolved_exercise_id
      AND s.provider = CASE
        WHEN u.source_url ILIKE '%rutube.%' THEN 'rutube'
        WHEN u.source_url ILIKE '%youtube.%' OR u.source_url ILIKE '%youtu.be%' THEN 'youtube'
        ELSE 'external'
      END
  )
ON CONFLICT (exercise_id, provider, source_url) DO NOTHING;

-- Ссылки внутри опубликованных snapshots только по точному exercise_id.
-- Один вариант провайдера подтверждается. Несколько разных ссылок ждут тренера.
WITH sets AS (
  SELECT
    COALESCE(set_item->'exercise'->>'id', set_item->>'exercise_id') AS exercise_id,
    COALESCE(
      set_item->'exercise'->'video'->>'url',
      set_item->'exercise'->>'video_url',
      ''
    ) AS raw_url
  FROM public.training_program_versions v
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.snapshot->'days', '[]'::jsonb)) AS day
  CROSS JOIN LATERAL (
    SELECT jsonb_array_elements(COALESCE(day->'warmup', '[]'::jsonb)) AS set_item
    UNION ALL
    SELECT jsonb_array_elements(COALESCE(day->'exercises', '[]'::jsonb))
    UNION ALL
    SELECT jsonb_array_elements(COALESCE(day->'cooldown', '[]'::jsonb))
  ) s
  WHERE v.status IN ('published', 'superseded')
),
clean AS (
  SELECT DISTINCT
    exercise_id::uuid AS exercise_id,
    CASE
      WHEN raw_url ILIKE '%rutube.%' THEN 'rutube'
      WHEN raw_url ILIKE '%youtube.%' OR raw_url ILIKE '%youtu.be%' OR raw_url ILIKE '%youtube-nocookie.com%' THEN 'youtube'
      ELSE NULL
    END AS provider,
    left(raw_url, 2000) AS source_url
  FROM sets
  WHERE exercise_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND raw_url ~ '^https://'
    AND raw_url NOT ILIKE '%supabase%'
),
counted AS (
  SELECT
    c.exercise_id,
    c.provider,
    c.source_url,
    count(*) OVER (PARTITION BY c.exercise_id, c.provider) AS variants
  FROM clean c
  JOIN public.exercises e ON e.id = c.exercise_id
  WHERE c.provider IS NOT NULL
)
INSERT INTO public.exercise_media_sources (
  exercise_id, provider, source_url, embed_url, status, priority, title, verified_at
)
SELECT
  exercise_id,
  provider,
  source_url,
  NULL,
  CASE WHEN variants = 1 THEN 'ok' ELSE 'needs_confirmation' END,
  CASE WHEN provider = 'rutube' THEN 10 ELSE 40 END,
  NULL,
  CASE WHEN variants = 1 THEN (now() AT TIME ZONE 'utc') ELSE NULL END
FROM counted
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercise_media_sources s
  WHERE s.exercise_id = counted.exercise_id
    AND s.provider = counted.provider
)
ON CONFLICT (exercise_id, provider, source_url) DO NOTHING;
