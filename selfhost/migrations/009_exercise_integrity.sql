-- Идемпотентная целостность каталога упражнений и media-журнала.
-- Не изменяет 006/008.

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.exercises
   SET is_active = (archived_at IS NULL)
 WHERE is_active IS DISTINCT FROM (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS exercises_archived_at_idx ON public.exercises (archived_at);
CREATE INDEX IF NOT EXISTS exercises_is_active_idx ON public.exercises (is_active);

-- Заглушки каталога для уже существующих binding/log без строки exercises (overlay по UUID).
INSERT INTO public.exercises (id, slug, name, category, difficulty, description)
SELECT DISTINCT b.exercise_id,
       'imported-' || b.exercise_id::text,
       'Импортированное упражнение',
       'strength_full',
       'beginner',
       'Создано миграцией 009 для FK media binding'
  FROM public.exercise_media_bindings b
  LEFT JOIN public.exercises e ON e.id = b.exercise_id
 WHERE e.id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exercises (id, slug, name, category, difficulty, description)
SELECT DISTINCT l.exercise_id,
       'imported-log-' || l.exercise_id::text,
       'Импортированное упражнение',
       'strength_full',
       'beginner',
       'Создано миграцией 009 для FK media change log'
  FROM public.exercise_media_change_log l
  LEFT JOIN public.exercises e ON e.id = l.exercise_id
 WHERE l.exercise_id IS NOT NULL AND e.id IS NULL
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercise_media_bindings_exercise_id_fkey'
  ) THEN
    ALTER TABLE public.exercise_media_bindings
      ADD CONSTRAINT exercise_media_bindings_exercise_id_fkey
      FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Журнал сохраняется: при гипотетическом физическом удалении упражнения id обнуляется, строки лога остаются.
ALTER TABLE public.exercise_media_change_log
  ALTER COLUMN exercise_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercise_media_change_log_exercise_id_fkey'
  ) THEN
    ALTER TABLE public.exercise_media_change_log
      ADD CONSTRAINT exercise_media_change_log_exercise_id_fkey
      FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS exercise_media_bindings_exercise_id_idx
  ON public.exercise_media_bindings (exercise_id);
CREATE INDEX IF NOT EXISTS exercise_media_bindings_status_idx
  ON public.exercise_media_bindings (status);
CREATE INDEX IF NOT EXISTS exercise_media_change_log_exercise_id_idx
  ON public.exercise_media_change_log (exercise_id);
