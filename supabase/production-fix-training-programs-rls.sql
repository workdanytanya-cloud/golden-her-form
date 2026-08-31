-- Production: RLS infinite recursion на training_programs + multi-course.
-- Выполнить в Supabase SQL Editor (скопировать содержимое migrations/20260831140000_fix_training_programs_rls.sql).

CREATE OR REPLACE FUNCTION private.client_has_training_program(
  p_user_id uuid,
  p_course_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_programs tp
    WHERE tp.user_id = p_user_id
      AND (p_course_id IS NULL OR tp.course_id IS DISTINCT FROM p_course_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.client_has_training_assignment(
  p_client_id uuid,
  p_course_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_program_assignments a
    WHERE a.client_id = p_client_id
      AND a.kind = 'training'
      AND (p_course_id IS NULL OR a.course_id IS DISTINCT FROM p_course_id)
  );
$$;

GRANT EXECUTE ON FUNCTION private.client_has_training_program(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.client_has_training_program(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.client_has_training_assignment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.client_has_training_assignment(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS "Owner inserts own program" ON public.training_programs;
CREATE POLICY "Owner inserts own program"
  ON public.training_programs FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT private.client_has_training_program(auth.uid(), course_id)
      AND NOT private.client_has_training_assignment(auth.uid(), course_id)
    )
  );

DROP POLICY IF EXISTS "Owner or admin updates program" ON public.training_programs;
CREATE POLICY "Owner or admin updates program"
  ON public.training_programs FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT private.client_has_training_assignment(auth.uid(), course_id)
    )
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT private.client_has_training_assignment(auth.uid(), course_id)
    )
  );

DROP POLICY IF EXISTS "Owner or admin reads program" ON public.training_programs;
CREATE POLICY "Owner or admin reads program"
  ON public.training_programs FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
      AND NOT private.client_has_training_assignment(auth.uid(), course_id)
    )
  );

NOTIFY pgrst, 'reload schema';
