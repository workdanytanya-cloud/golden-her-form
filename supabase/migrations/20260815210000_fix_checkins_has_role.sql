-- weekly_check_ins / workout_feedback policies used public.has_role,
-- but EXECUTE on public.has_role was revoked from authenticated.
-- Evaluating those policies aborts client upserts with:
--   permission denied for function has_role
-- Fix: use private.has_role (granted to authenticated).

DROP POLICY IF EXISTS "Admins view all weekly check-ins" ON public.weekly_check_ins;
DROP POLICY IF EXISTS "Admins manage weekly check-ins" ON public.weekly_check_ins;
DROP POLICY IF EXISTS "Admins view all workout feedback" ON public.workout_feedback;
DROP POLICY IF EXISTS "Admins manage workout feedback" ON public.workout_feedback;

CREATE POLICY "Admins view all weekly check-ins"
  ON public.weekly_check_ins FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage weekly check-ins"
  ON public.weekly_check_ins FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins view all workout feedback"
  ON public.workout_feedback FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage workout feedback"
  ON public.workout_feedback FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));
