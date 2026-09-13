-- Production: permission denied for function has_role при сохранении/генерации тренировок.
-- Выполните также: production-fix-training-programs-rls.sql (если ещё не применяли).
-- Этот файл — только UPDATE-политика без public.has_role.

DROP POLICY IF EXISTS "Owner or admin updates program" ON public.training_programs;
CREATE POLICY "Owner or admin updates program"
  ON public.training_programs FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR auth.uid() = user_id
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR auth.uid() = user_id
  );

NOTIFY pgrst, 'reload schema';
