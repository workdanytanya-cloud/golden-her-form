-- Атомарная замена дней программы (DELETE + INSERT в одной транзакции)

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
    program_id,
    week_index,
    day_index,
    is_rest,
    title,
    focus,
    description,
    warmup,
    exercises,
    cooldown,
    day_note
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
