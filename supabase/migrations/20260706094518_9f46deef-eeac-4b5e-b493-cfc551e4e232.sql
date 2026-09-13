
-- 1. Table
CREATE TABLE public.client_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_notifications_user_created_idx
  ON public.client_notifications (user_id, created_at DESC);

-- 2. Grants
GRANT SELECT, UPDATE, DELETE ON public.client_notifications TO authenticated;
GRANT ALL ON public.client_notifications TO service_role;

-- 3. RLS
ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications"
  ON public.client_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users update own notifications"
  ON public.client_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own notifications"
  ON public.client_notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_notifications;

-- 5. Trigger: notify client when access is activated
CREATE OR REPLACE FUNCTION public.notify_client_on_access_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    INSERT INTO public.client_notifications (user_id, type, message, link)
    VALUES (
      NEW.user_id,
      'access_granted',
      'Тренер открыл вам доступ к программе. Загляните в раздел тренировок и питания — можно начинать.',
      '/dashboard'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_client_on_access_activation
AFTER INSERT OR UPDATE OF status ON public.client_access
FOR EACH ROW EXECUTE FUNCTION public.notify_client_on_access_activation();
