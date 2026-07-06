-- Restrict inserts on notification tables to service role / SECURITY DEFINER triggers only.
-- Deny direct client inserts by adding an explicit INSERT policy that never matches for authenticated/anon.

CREATE POLICY "No client inserts on admin_notifications"
  ON public.admin_notifications
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "No client inserts on client_notifications"
  ON public.client_notifications
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
