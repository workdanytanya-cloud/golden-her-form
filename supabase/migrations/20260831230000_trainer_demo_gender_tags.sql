-- Теги пола демонстратора на видео упражнений.
-- sheet/panova = женский показ; стоковые демо без sheet = мужской.

UPDATE public.exercises
SET tags = (
  SELECT ARRAY(
    SELECT DISTINCT t
    FROM unnest(COALESCE(tags, '{}'::text[]) || ARRAY['trainer_female']::text[]) AS t
  )
)
WHERE (
  'sheet' = ANY (COALESCE(tags, '{}'::text[]))
  OR 'panova' = ANY (COALESCE(tags, '{}'::text[]))
  OR 'anna-sheet' = ANY (COALESCE(tags, '{}'::text[]))
  OR slug LIKE 'sheet-%'
)
AND NOT ('trainer_male' = ANY (COALESCE(tags, '{}'::text[])))
AND NOT ('trainer_female' = ANY (COALESCE(tags, '{}'::text[])));

UPDATE public.exercises
SET tags = (
  SELECT ARRAY(
    SELECT DISTINCT t
    FROM unnest(COALESCE(tags, '{}'::text[]) || ARRAY['trainer_male']::text[]) AS t
  )
)
WHERE NOT (
  'sheet' = ANY (COALESCE(tags, '{}'::text[]))
  OR 'panova' = ANY (COALESCE(tags, '{}'::text[]))
  OR 'anna-sheet' = ANY (COALESCE(tags, '{}'::text[]))
  OR slug LIKE 'sheet-%'
)
AND slug NOT LIKE 'mfr-%'
AND (
  gif_url IS NOT NULL
  OR video_url IS NOT NULL
  OR slug LIKE 'oedb-%'
  OR slug LIKE 'edb-%'
)
AND NOT ('trainer_female' = ANY (COALESCE(tags, '{}'::text[])))
AND NOT ('trainer_male' = ANY (COALESCE(tags, '{}'::text[])));
