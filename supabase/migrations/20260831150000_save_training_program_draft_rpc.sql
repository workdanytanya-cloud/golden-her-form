-- Атомарное сохранение черновика программы тренировок (обход RLS recursion на INSERT).

CREATE OR REPLACE FUNCTION public.save_client_training_program_draft(
  p_user_id uuid,
  p_course_id uuid,
  p_program jsonb,
  p_days jsonb,
  p_program_weeks int DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_program_id uuid;
  v_multi_week boolean;
  v_days_count int;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id обязателен';
  END IF;

  IF NOT (
    private.has_role(auth.uid(), 'admin')
    OR auth.uid() = p_user_id
  ) THEN
    RAISE EXCEPTION 'Нет доступа к сохранению программы';
  END IF;

  SELECT tp.id
  INTO v_program_id
  FROM public.training_programs tp
  WHERE tp.user_id = p_user_id
    AND (
      (p_course_id IS NULL AND tp.course_id IS NULL)
      OR tp.course_id IS NOT DISTINCT FROM p_course_id
    )
  LIMIT 1;

  IF v_program_id IS NULL THEN
    SELECT tp.id
    INTO v_program_id
    FROM public.training_programs tp
    WHERE tp.user_id = p_user_id
    LIMIT 1;
  END IF;

  IF v_program_id IS NOT NULL THEN
    UPDATE public.training_programs
    SET
      sessions_per_week = COALESCE((p_program->>'sessions_per_week')::int, sessions_per_week),
      goal = p_program->>'goal',
      level = COALESCE(p_program->>'level', level),
      has_injuries = COALESCE((p_program->>'has_injuries')::boolean, has_injuries),
      injuries_details = p_program->>'injuries_details',
      equipment = COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_program->'equipment', '[]'::jsonb))),
        equipment
      ),
      location = p_program->>'location',
      notes = p_program->>'notes',
      faq = COALESCE(p_program->'faq', faq),
      targets_manual = COALESCE((p_program->>'targets_manual')::boolean, targets_manual),
      generated_at = COALESCE((p_program->>'generated_at')::timestamptz, now()),
      program_weeks = GREATEST(COALESCE(p_program_weeks, 1), 1),
      course_id = COALESCE(p_course_id, course_id)
    WHERE id = v_program_id;
  ELSE
    INSERT INTO public.training_programs (
      user_id,
      course_id,
      sessions_per_week,
      goal,
      level,
      has_injuries,
      injuries_details,
      equipment,
      location,
      notes,
      faq,
      targets_manual,
      generated_at,
      program_weeks
    )
    VALUES (
      p_user_id,
      p_course_id,
      COALESCE((p_program->>'sessions_per_week')::int, 3),
      p_program->>'goal',
      COALESCE(p_program->>'level', 'beginner'),
      COALESCE((p_program->>'has_injuries')::boolean, false),
      p_program->>'injuries_details',
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_program->'equipment', '[]'::jsonb))),
        '{}'::text[]
      ),
      p_program->>'location',
      p_program->>'notes',
      COALESCE(p_program->'faq', '[]'::jsonb),
      COALESCE((p_program->>'targets_manual')::boolean, false),
      COALESCE((p_program->>'generated_at')::timestamptz, now()),
      GREATEST(COALESCE(p_program_weeks, 1), 1)
    )
    RETURNING id INTO v_program_id;
  END IF;

  DELETE FROM public.training_program_days WHERE program_id = v_program_id;

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
    v_program_id,
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
  FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) AS r;

  GET DIAGNOSTICS v_days_count = ROW_COUNT;
  v_multi_week := EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) AS r
    WHERE COALESCE((r->>'week_index')::int, 0) > 0
  );

  RETURN jsonb_build_object(
    'program_id', v_program_id,
    'multi_week', v_multi_week,
    'days_count', v_days_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_client_training_program_draft(uuid, uuid, jsonb, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_training_program_draft(uuid, uuid, jsonb, jsonb, int) TO service_role;

NOTIFY pgrst, 'reload schema';
