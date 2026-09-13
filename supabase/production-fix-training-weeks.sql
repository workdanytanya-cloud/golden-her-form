-- Скопируйте целиком в Supabase → SQL Editor (production) и выполните один раз.
-- После этого: git pull на сервере, снова «Таблица тренера · 4 нед.» в админке.

-- 1) Колонки week_index и program_weeks
ALTER TABLE public.training_program_days
  ADD COLUMN IF NOT EXISTS week_index int NOT NULL DEFAULT 0
  CHECK (week_index >= 0 AND week_index <= 11);

ALTER TABLE public.training_program_days
  DROP CONSTRAINT IF EXISTS training_program_days_program_id_day_index_key;

ALTER TABLE public.training_program_days
  DROP CONSTRAINT IF EXISTS training_program_days_program_week_day_key;

ALTER TABLE public.training_program_days
  ADD CONSTRAINT training_program_days_program_week_day_key
  UNIQUE (program_id, week_index, day_index);

CREATE INDEX IF NOT EXISTS training_program_days_program_week_day_idx
  ON public.training_program_days (program_id, week_index, day_index);

ALTER TABLE public.training_programs
  ADD COLUMN IF NOT EXISTS program_weeks int NOT NULL DEFAULT 1
  CHECK (program_weeks >= 1 AND program_weeks <= 12);

-- 2) Атомарная замена дней (без «пустой программы» при ошибке вставки)
CREATE OR REPLACE FUNCTION public.replace_training_program_days(
  p_program_id uuid,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = p_program_id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Нет доступа к программе';
  END IF;

  DELETE FROM public.training_program_days WHERE program_id = p_program_id;

  INSERT INTO public.training_program_days (
    program_id, week_index, day_index, is_rest, title, focus, description,
    warmup, exercises, cooldown, day_note
  )
  SELECT
    p_program_id,
    COALESCE((r->>'week_index')::int, 0),
    (r->>'day_index')::int,
    COALESCE((r->>'is_rest')::boolean, false),
    COALESCE(r->>'title', ''),
    r->>'focus',
    r->>'description',
    COALESCE(r->'warmup', '[]'::jsonb),
    COALESCE(r->'exercises', '[]'::jsonb),
    COALESCE(r->'cooldown', '[]'::jsonb),
    r->>'day_note'
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_training_program_days(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_training_program_days(uuid, jsonb) TO service_role;

-- Обновить кэш схемы PostgREST (иногда нужно после ADD COLUMN)
NOTIFY pgrst, 'reload schema';
