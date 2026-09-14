-- Идемпотентно. Не меняет 009 и не трогает published snapshots.

CREATE TABLE IF NOT EXISTS public.unmatched_exercise_media (
  original_exercise_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('youtube', 'rutube', 'external', 'none')),
  source_url text,
  embed_url text,
  title text,
  status text NOT NULL DEFAULT 'unchecked'
    CHECK (status IN ('ok', 'unavailable', 'unchecked')),
  fallback_text text,
  resolved_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS unmatched_exercise_media_resolved_idx
  ON public.unmatched_exercise_media (resolved_exercise_id);

-- Перенос фиктивных строк 009 в очередь сопоставления. Данные binding сохраняются.
INSERT INTO public.unmatched_exercise_media (
  original_exercise_id, provider, source_url, embed_url, title, status, fallback_text, source
)
SELECT b.exercise_id, b.provider, b.source_url, b.embed_url, b.title, b.status, b.fallback_text, 'migration_009'
  FROM public.exercise_media_bindings b
  JOIN public.exercises e ON e.id = b.exercise_id
 WHERE e.description LIKE 'Создано миграцией 009%'
    OR e.slug LIKE 'imported-%'
    OR e.slug LIKE 'imported-log-%'
ON CONFLICT (original_exercise_id) DO NOTHING;

INSERT INTO public.unmatched_exercise_media (original_exercise_id, provider, status, source)
SELECT e.id, 'none', 'unchecked', 'migration_009'
  FROM public.exercises e
  LEFT JOIN public.exercise_media_bindings b ON b.exercise_id = e.id
  LEFT JOIN public.unmatched_exercise_media u ON u.original_exercise_id = e.id
 WHERE u.original_exercise_id IS NULL
   AND b.exercise_id IS NULL
   AND (
     e.description LIKE 'Создано миграцией 009%'
     OR e.slug LIKE 'imported-%'
     OR e.slug LIKE 'imported-log-%'
   )
ON CONFLICT (original_exercise_id) DO NOTHING;

DELETE FROM public.exercise_media_bindings b
 USING public.exercises e
 WHERE b.exercise_id = e.id
   AND (
     e.description LIKE 'Создано миграцией 009%'
     OR e.slug LIKE 'imported-%'
     OR e.slug LIKE 'imported-log-%'
   );

-- ON DELETE SET NULL на change_log обновляет строки; immutable-триггер 007 это блокирует.
ALTER TABLE public.exercise_media_change_log
  DISABLE TRIGGER exercise_media_change_log_immutable;

UPDATE public.exercise_media_change_log l
   SET exercise_id = NULL
  FROM public.exercises e
 WHERE l.exercise_id = e.id
   AND (
     e.description LIKE 'Создано миграцией 009%'
     OR e.slug LIKE 'imported-%'
     OR e.slug LIKE 'imported-log-%'
   );

DELETE FROM public.exercises e
 WHERE e.description LIKE 'Создано миграцией 009%'
    OR e.slug LIKE 'imported-%'
    OR e.slug LIKE 'imported-log-%';

ALTER TABLE public.exercise_media_change_log
  ENABLE TRIGGER exercise_media_change_log_immutable;

DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(client_id::text, ', ')
    INTO dupes
    FROM (
      SELECT client_id
        FROM public.client_courses
       WHERE status = 'active'
       GROUP BY client_id
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Несколько active-курсов на клиента (требуется явное решение): %', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS client_courses_one_active_idx
  ON public.client_courses (client_id)
  WHERE status = 'active';
