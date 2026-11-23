-- Архивация только подтверждённых дублей: категория + инвентарь + одно и то же видео.
-- Совпадение названий само по себе не архивирует и не удерживает в архиве.
-- Published snapshots и назначения клиентов не меняются.

CREATE OR REPLACE FUNCTION public.exercise_video_dedupe_key(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value text := lower(trim(coalesce(raw, '')));
  yt text;
  rt text;
BEGIN
  IF value = '' THEN
    RETURN '';
  END IF;
  yt := substring(value from 'youtu\.be/([a-zA-Z0-9_-]{6,})');
  IF yt IS NULL THEN
    yt := substring(value from '[?&]v=([a-zA-Z0-9_-]{6,})');
  END IF;
  IF yt IS NULL THEN
    yt := substring(value from '/(?:embed|shorts)/([a-zA-Z0-9_-]{6,})');
  END IF;
  IF yt IS NOT NULL THEN
    RETURN 'yt:' || lower(yt);
  END IF;
  rt := substring(value from 'rutube\.ru/video/([a-f0-9]{32})');
  IF rt IS NOT NULL THEN
    RETURN 'rt:' || lower(rt);
  END IF;
  RETURN value;
END;
$$;

CREATE OR REPLACE FUNCTION public.exercise_equipment_dedupe_key(equipment text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(string_agg(x, '|' ORDER BY x), '')
    FROM (
      SELECT DISTINCT trim(both FROM unnest(coalesce(equipment, ARRAY[]::text[]))) AS x
    ) s
   WHERE x <> '';
$$;

-- Восстановить архив только если это «тезка» с другим видео/вариантом рядом с активной
-- карточкой того же названия: совпадение названий само по себе не основание для архива.
UPDATE public.exercises e
   SET archived_at = NULL,
       is_active = true,
       updated_at = (now() AT TIME ZONE 'utc')
 WHERE (e.archived_at IS NOT NULL OR e.is_active = false)
   AND EXISTS (
     SELECT 1
       FROM public.exercises sibling
       LEFT JOIN public.exercise_media_bindings sb ON sb.exercise_id = sibling.id
       LEFT JOIN public.exercise_media_bindings eb ON eb.exercise_id = e.id
      WHERE sibling.id <> e.id
        AND sibling.archived_at IS NULL
        AND sibling.is_active IS DISTINCT FROM false
        AND lower(trim(sibling.name)) = lower(trim(e.name))
        AND (
          sibling.category IS DISTINCT FROM e.category
          OR public.exercise_equipment_dedupe_key(sibling.equipment)
             IS DISTINCT FROM public.exercise_equipment_dedupe_key(e.equipment)
          OR public.exercise_video_dedupe_key(coalesce(sb.source_url, sibling.video_url))
             IS DISTINCT FROM public.exercise_video_dedupe_key(coalesce(eb.source_url, e.video_url))
          OR public.exercise_video_dedupe_key(coalesce(eb.source_url, e.video_url)) = ''
          OR public.exercise_video_dedupe_key(coalesce(sb.source_url, sibling.video_url)) = ''
        )
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.exercises twin
       LEFT JOIN public.exercise_media_bindings tb ON tb.exercise_id = twin.id
       LEFT JOIN public.exercise_media_bindings eb ON eb.exercise_id = e.id
      WHERE twin.id <> e.id
        AND twin.category = e.category
        AND public.exercise_equipment_dedupe_key(twin.equipment)
            = public.exercise_equipment_dedupe_key(e.equipment)
        AND public.exercise_video_dedupe_key(coalesce(tb.source_url, twin.video_url))
            = public.exercise_video_dedupe_key(coalesce(eb.source_url, e.video_url))
        AND public.exercise_video_dedupe_key(coalesce(eb.source_url, e.video_url)) <> ''
   );

-- Для подтверждённых дублей оставить одну активную карточку, остальные — в архив.
WITH ranked AS (
  SELECT e.id,
         row_number() OVER (
           PARTITION BY e.category,
                        public.exercise_equipment_dedupe_key(e.equipment),
                        public.exercise_video_dedupe_key(coalesce(b.source_url, e.video_url))
           ORDER BY
             CASE WHEN e.archived_at IS NULL AND e.is_active IS DISTINCT FROM false THEN 0 ELSE 1 END,
             (
               SELECT count(*)::int
                 FROM public.training_program_versions v
                WHERE v.status = 'published'
                  AND v.snapshot::text LIKE '%' || e.id::text || '%'
             ) DESC,
             length(coalesce(e.description, '')) DESC,
             e.created_at ASC NULLS LAST,
             e.id ASC
         ) AS keep_rank
    FROM public.exercises e
    LEFT JOIN public.exercise_media_bindings b ON b.exercise_id = e.id
   WHERE public.exercise_video_dedupe_key(coalesce(b.source_url, e.video_url)) <> ''
)
UPDATE public.exercises e
   SET archived_at = COALESCE(e.archived_at, (now() AT TIME ZONE 'utc')),
       is_active = false,
       updated_at = (now() AT TIME ZONE 'utc')
  FROM ranked r
 WHERE e.id = r.id
   AND r.keep_rank > 1
   AND (e.archived_at IS NULL OR e.is_active IS DISTINCT FROM false);
