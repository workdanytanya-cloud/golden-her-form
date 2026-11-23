-- Отдельная папка «Мужские тренировки» в ручной подборке.
-- Не меняет опубликованные snapshots и назначения клиентов.

ALTER TABLE public.generator_rutube_manual
  DROP CONSTRAINT IF EXISTS generator_rutube_manual_collection_check;

ALTER TABLE public.generator_rutube_manual
  ADD CONSTRAINT generator_rutube_manual_collection_check
  CHECK (collection IN ('workout', 'workout_male', 'piece'));

COMMENT ON TABLE public.generator_rutube_manual IS
  'Ручная подборка: workout — общие тренировки, workout_male — только для пола male, piece — блоки/упражнения.';
