
CREATE TABLE public.client_access (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending_onboarding',
  activated_at timestamptz,
  activated_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_access_status_chk CHECK (
    status IN ('pending_onboarding', 'awaiting_approval', 'active', 'paused')
  )
);

GRANT SELECT ON public.client_access TO authenticated;
GRANT ALL ON public.client_access TO service_role;

ALTER TABLE public.client_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own access"
  ON public.client_access FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins view all access"
  ON public.client_access FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert access"
  ON public.client_access FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update access"
  ON public.client_access FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete access"
  ON public.client_access FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_client_access_updated_at
BEFORE UPDATE ON public.client_access
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend handle_new_user to also create a client_access row for non-admins
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _admin_email constant text := 'panova.fortuna@gmail.com';
  _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO NOTHING;

  IF lower(new.email) = _admin_email THEN
    _role := 'admin';
  ELSE
    _role := 'client';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _role = 'client' THEN
    INSERT INTO public.client_access (user_id, status)
    VALUES (new.id, 'pending_onboarding')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$function$;

-- Advance status when onboarding gets submitted for the first time
CREATE OR REPLACE FUNCTION public.mark_client_awaiting_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.completed_at IS NULL) THEN
    INSERT INTO public.client_access (user_id, status)
    VALUES (NEW.user_id, 'awaiting_approval')
    ON CONFLICT (user_id) DO UPDATE
    SET status = CASE
      WHEN public.client_access.status = 'pending_onboarding' THEN 'awaiting_approval'
      ELSE public.client_access.status
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_client_awaiting_approval() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER onboarding_mark_awaiting
AFTER INSERT OR UPDATE ON public.onboarding_responses
FOR EACH ROW EXECUTE FUNCTION public.mark_client_awaiting_approval();

-- Backfill existing clients
INSERT INTO public.client_access (user_id, status)
SELECT ur.user_id, 'pending_onboarding'
FROM public.user_roles ur
WHERE ur.role = 'client'
ON CONFLICT (user_id) DO NOTHING;

-- Anyone who already submitted onboarding moves to awaiting_approval
UPDATE public.client_access ca
SET status = 'awaiting_approval'
FROM public.onboarding_responses o
WHERE o.user_id = ca.user_id
  AND o.completed_at IS NOT NULL
  AND ca.status = 'pending_onboarding';
