-- Мультикурсы: отдельные 4-недельные периоды «Курс (DD.MM.YYYY)-(DD.MM.YYYY)»
-- Безопасно: CREATE IF NOT EXISTS, backfill существующих клиентов.

-- ========== client_courses ==========
CREATE TABLE IF NOT EXISTS public.client_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  CONSTRAINT client_courses_dates_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS client_courses_client_start_idx
  ON public.client_courses (client_id, start_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.client_courses TO authenticated;
GRANT ALL ON public.client_courses TO service_role;
ALTER TABLE public.client_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_courses_select ON public.client_courses;
CREATE POLICY client_courses_select ON public.client_courses
  FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR private.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS client_courses_client_insert ON public.client_courses;
CREATE POLICY client_courses_client_insert ON public.client_courses
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id = auth.uid() AND status = 'draft'
  );

DROP POLICY IF EXISTS client_courses_admin ON public.client_courses;
CREATE POLICY client_courses_admin ON public.client_courses
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- ========== course_id на связанных таблицах ==========
ALTER TABLE public.training_programs
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE;

ALTER TABLE public.nutrition_plans
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE;

ALTER TABLE public.client_program_assignments
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE;

ALTER TABLE public.nutrition_plan_versions
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE;

ALTER TABLE public.training_program_versions
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.client_courses(id) ON DELETE CASCADE;

-- ========== backfill: один курс на клиента с контентом ==========
INSERT INTO public.client_courses (client_id, title, start_date, end_date, status, created_at, created_by)
SELECT DISTINCT
  u.client_id,
  'Курс (' || to_char(u.start_date, 'DD.MM.YYYY') || ')-(' || to_char(u.end_date, 'DD.MM.YYYY') || ')',
  u.start_date,
  u.end_date,
  CASE
    WHEN ca.status = 'active' THEN 'active'
    ELSE 'completed'
  END,
  COALESCE(ca.activated_at, now()),
  ca.activated_by
FROM (
  SELECT
    x.client_id,
    COALESCE(ca.activated_at::date, CURRENT_DATE) AS start_date,
    (COALESCE(ca.activated_at::date, CURRENT_DATE) + 27) AS end_date
  FROM (
    SELECT user_id AS client_id FROM public.training_programs
    UNION
    SELECT user_id FROM public.nutrition_plans
    UNION
    SELECT client_id FROM public.client_program_assignments
    UNION
    SELECT user_id FROM public.client_access WHERE status IN ('active', 'suspended')
  ) x
  LEFT JOIN public.client_access ca ON ca.user_id = x.client_id
) u
LEFT JOIN public.client_access ca ON ca.user_id = u.client_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.client_courses cc WHERE cc.client_id = u.client_id
);

UPDATE public.training_programs tp
SET course_id = cc.id
FROM public.client_courses cc
WHERE tp.course_id IS NULL
  AND cc.client_id = tp.user_id
  AND cc.id = (
    SELECT id FROM public.client_courses
    WHERE client_id = tp.user_id
    ORDER BY created_at ASC
    LIMIT 1
  );

UPDATE public.nutrition_plans np
SET course_id = cc.id
FROM public.client_courses cc
WHERE np.course_id IS NULL
  AND cc.client_id = np.user_id
  AND cc.id = (
    SELECT id FROM public.client_courses
    WHERE client_id = np.user_id
    ORDER BY created_at ASC
    LIMIT 1
  );

UPDATE public.client_program_assignments a
SET course_id = cc.id
FROM public.client_courses cc
WHERE a.course_id IS NULL
  AND cc.client_id = a.client_id
  AND cc.id = (
    SELECT id FROM public.client_courses
    WHERE client_id = a.client_id
    ORDER BY created_at ASC
    LIMIT 1
  );

UPDATE public.nutrition_plan_versions v
SET course_id = cc.id
FROM public.client_courses cc
WHERE v.course_id IS NULL
  AND cc.client_id = v.client_id
  AND cc.id = (
    SELECT id FROM public.client_courses
    WHERE client_id = v.client_id
    ORDER BY created_at ASC
    LIMIT 1
  );

UPDATE public.training_program_versions v
SET course_id = cc.id
FROM public.client_courses cc
WHERE v.course_id IS NULL
  AND cc.client_id = v.client_id
  AND cc.id = (
    SELECT id FROM public.client_courses
    WHERE client_id = v.client_id
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Уникальность: один черновик программы/плана на курс
ALTER TABLE public.training_programs
  DROP CONSTRAINT IF EXISTS training_programs_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS training_programs_course_id_key
  ON public.training_programs (course_id)
  WHERE course_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plans_course_id_key
  ON public.nutrition_plans (course_id)
  WHERE course_id IS NOT NULL;

ALTER TABLE public.client_program_assignments
  DROP CONSTRAINT IF EXISTS client_program_assignments_client_id_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS client_program_assignments_course_kind_key
  ON public.client_program_assignments (course_id, kind)
  WHERE course_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plan_versions_course_version_key
  ON public.nutrition_plan_versions (course_id, version)
  WHERE course_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS training_program_versions_course_version_key
  ON public.training_program_versions (course_id, version)
  WHERE course_id IS NOT NULL;

-- ========== resolve active course ==========
CREATE OR REPLACE FUNCTION public.resolve_client_course_id(
  p_client_id uuid,
  p_course_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    p_course_id,
    (
      SELECT id FROM public.client_courses
      WHERE client_id = p_client_id AND status = 'active'
      ORDER BY start_date DESC
      LIMIT 1
    ),
    (
      SELECT id FROM public.client_courses
      WHERE client_id = p_client_id
      ORDER BY start_date DESC
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.resolve_client_course_id(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_client_course_id(uuid, uuid) TO service_role;

-- ========== publish RPC: scope по course_id ==========
CREATE OR REPLACE FUNCTION public.publish_nutrition_version(
  p_client_id uuid,
  p_snapshot jsonb,
  p_content_hash text,
  p_reason text DEFAULT NULL,
  p_measurement_id uuid DEFAULT NULL,
  p_recommendation_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_course uuid;
  v_prev_id uuid;
  v_prev_ver int;
  v_new_id uuid;
  v_new_ver int;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Только тренер может публиковать меню';
  END IF;
  IF p_snapshot IS NULL OR p_content_hash IS NULL OR length(p_content_hash) = 0 THEN
    RAISE EXCEPTION 'Snapshot и content_hash обязательны';
  END IF;

  v_course := public.resolve_client_course_id(p_client_id, p_course_id);
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'Курс не найден — создайте курс для клиента';
  END IF;

  SELECT a.active_version_id, v.version
    INTO v_prev_id, v_prev_ver
  FROM public.client_program_assignments a
  JOIN public.nutrition_plan_versions v ON v.id = a.active_version_id
  WHERE a.course_id = v_course AND a.kind = 'nutrition';

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.nutrition_plan_versions
      SET status = 'superseded'
      WHERE id = v_prev_id AND status = 'published';
    v_new_ver := COALESCE(v_prev_ver, 0) + 1;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_ver
    FROM public.nutrition_plan_versions WHERE course_id = v_course;
  END IF;

  INSERT INTO public.nutrition_plan_versions (
    client_id, course_id, version, status, snapshot, content_hash,
    parent_version_id, created_by, published_at, published_by
  ) VALUES (
    p_client_id, v_course, v_new_ver, 'published', p_snapshot, p_content_hash,
    v_prev_id, v_actor, now(), v_actor
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.client_program_assignments (client_id, course_id, kind, active_version_id, updated_by)
  VALUES (p_client_id, v_course, 'nutrition', v_new_id, v_actor)
  ON CONFLICT (course_id, kind) WHERE course_id IS NOT NULL DO UPDATE
    SET active_version_id = EXCLUDED.active_version_id,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  INSERT INTO public.program_change_log (
    client_id, kind, action, actor_id, from_version_id, to_version_id, measurement_id, diff
  ) VALUES (
    p_client_id, 'nutrition', 'publish', v_actor, v_prev_id, v_new_id, p_measurement_id,
    jsonb_build_object(
      'reason', p_reason,
      'content_hash', p_content_hash,
      'recommendation_id', p_recommendation_id,
      'course_id', v_course
    )
  );

  INSERT INTO public.client_notifications (user_id, type, message, link)
  VALUES (
    p_client_id,
    'nutrition_published',
    'Тренер обновил вашу программу питания с учётом текущего прогресса',
    '/dashboard/nutrition'
  );

  IF p_recommendation_id IS NOT NULL THEN
    UPDATE public.nutrition_recommendations
      SET status = 'accepted', reviewed_at = now(), reviewed_by = v_actor
      WHERE id = p_recommendation_id AND client_id = p_client_id;
  END IF;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_training_version(
  p_client_id uuid,
  p_snapshot jsonb,
  p_content_hash text,
  p_reason text DEFAULT NULL,
  p_course_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_course uuid;
  v_prev_id uuid;
  v_prev_ver int;
  v_new_id uuid;
  v_new_ver int;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'Только тренер может публиковать тренировки';
  END IF;
  IF p_snapshot IS NULL OR p_content_hash IS NULL OR length(p_content_hash) = 0 THEN
    RAISE EXCEPTION 'Snapshot и content_hash обязательны';
  END IF;

  v_course := public.resolve_client_course_id(p_client_id, p_course_id);
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'Курс не найден — создайте курс для клиента';
  END IF;

  SELECT a.active_version_id, v.version
    INTO v_prev_id, v_prev_ver
  FROM public.client_program_assignments a
  JOIN public.training_program_versions v ON v.id = a.active_version_id
  WHERE a.course_id = v_course AND a.kind = 'training';

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.training_program_versions
      SET status = 'superseded'
      WHERE id = v_prev_id AND status = 'published';
    v_new_ver := COALESCE(v_prev_ver, 0) + 1;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_ver
    FROM public.training_program_versions WHERE course_id = v_course;
  END IF;

  INSERT INTO public.training_program_versions (
    client_id, course_id, version, status, snapshot, content_hash,
    parent_version_id, created_by, published_at, published_by
  ) VALUES (
    p_client_id, v_course, v_new_ver, 'published', p_snapshot, p_content_hash,
    v_prev_id, v_actor, now(), v_actor
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.client_program_assignments (client_id, course_id, kind, active_version_id, updated_by)
  VALUES (p_client_id, v_course, 'training', v_new_id, v_actor)
  ON CONFLICT (course_id, kind) WHERE course_id IS NOT NULL DO UPDATE
    SET active_version_id = EXCLUDED.active_version_id,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  INSERT INTO public.program_change_log (
    client_id, kind, action, actor_id, from_version_id, to_version_id, diff
  ) VALUES (
    p_client_id, 'training', 'publish', v_actor, v_prev_id, v_new_id,
    jsonb_build_object('reason', p_reason, 'content_hash', p_content_hash, 'course_id', v_course)
  );

  INSERT INTO public.client_notifications (user_id, type, message, link)
  VALUES (
    p_client_id,
    'training_published',
    'Тренер опубликовал для вас программу тренировок',
    '/dashboard/training'
  );

  RETURN v_new_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
