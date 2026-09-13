
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'measurement',
  client_id uuid NOT NULL,
  measurement_id uuid,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view notifications"
  ON public.admin_notifications FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update notifications"
  ON public.admin_notifications FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete notifications"
  ON public.admin_notifications FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX admin_notifications_created_idx ON public.admin_notifications (created_at DESC);
CREATE INDEX admin_notifications_unread_idx ON public.admin_notifications (is_read) WHERE is_read = false;

CREATE OR REPLACE FUNCTION public.notify_admin_on_measurement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _parts text[] := ARRAY[]::text[];
  _msg text;
BEGIN
  -- Skip notifications when an admin creates the measurement themselves
  IF public.has_role(NEW.user_id, 'admin') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Клиент') INTO _name
  FROM public.profiles WHERE id = NEW.user_id;

  IF NEW.weight_kg IS NOT NULL THEN _parts := _parts || ('вес ' || NEW.weight_kg || ' кг'); END IF;
  IF NEW.waist_cm  IS NOT NULL THEN _parts := _parts || ('талия ' || NEW.waist_cm || ' см'); END IF;
  IF NEW.hips_cm   IS NOT NULL THEN _parts := _parts || ('бёдра ' || NEW.hips_cm || ' см'); END IF;
  IF NEW.chest_cm  IS NOT NULL THEN _parts := _parts || ('грудь ' || NEW.chest_cm || ' см'); END IF;

  _msg := COALESCE(_name, 'Клиент') || ' добавил(а) замер' ||
          CASE WHEN array_length(_parts, 1) > 0 THEN ': ' || array_to_string(_parts, ', ') ELSE '' END;

  INSERT INTO public.admin_notifications (type, client_id, measurement_id, message)
  VALUES ('measurement', NEW.user_id, NEW.id, _msg);

  RETURN NEW;
END;
$$;

CREATE TRIGGER measurements_notify_admin
AFTER INSERT ON public.measurements
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_on_measurement();
