-- Access control (safe version — without ::app_role cast)

-- 0) Enum, if missing
DO $$
BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'client');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.client_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_onboarding'
    CHECK (status IN ('pending_onboarding', 'awaiting_approval', 'active', 'suspended')),
  activated_at timestamptz,
  activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.client_access TO authenticated;
GRANT ALL ON public.client_access TO service_role;
ALTER TABLE public.client_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own access" ON public.client_access;
CREATE POLICY "Users view own access"
  ON public.client_access FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
    )
  );

DROP POLICY IF EXISTS "Users insert own pending access" ON public.client_access;
CREATE POLICY "Users insert own pending access"
  ON public.client_access FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_onboarding'
  );

DROP POLICY IF EXISTS "Users mark awaiting after onboarding" ON public.client_access;
CREATE POLICY "Users mark awaiting after onboarding"
  ON public.client_access FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND status = 'pending_onboarding'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'awaiting_approval'
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_email constant text := 'panova.fortuna@gmail.com';
  _role text;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO NOTHING;

  IF lower(NEW.email) = _admin_email THEN
    _role := 'admin';
  ELSE
    _role := 'client';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _role = 'client' THEN
    INSERT INTO public.client_access (user_id, status)
    VALUES (NEW.id, 'pending_onboarding')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_client_awaiting_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_new_completion boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = NEW.user_id AND ur.role::text = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  _is_new_completion := NEW.completed_at IS NOT NULL AND (
    TG_OP = 'INSERT' OR OLD.completed_at IS NULL
  );

  IF NOT _is_new_completion THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.client_access (user_id, status)
  VALUES (NEW.user_id, 'awaiting_approval')
  ON CONFLICT (user_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now()
    WHERE public.client_access.status IN ('pending_onboarding', 'awaiting_approval');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_client_awaiting_approval ON public.onboarding_responses;
CREATE TRIGGER trg_mark_client_awaiting_approval
AFTER INSERT OR UPDATE OF completed_at ON public.onboarding_responses
FOR EACH ROW EXECUTE FUNCTION public.mark_client_awaiting_approval();

INSERT INTO public.client_access (user_id, status, activated_at)
SELECT ur.user_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.training_programs tp WHERE tp.user_id = ur.user_id)
      OR EXISTS (SELECT 1 FROM public.nutrition_plans np WHERE np.user_id = ur.user_id)
      THEN 'active'
    WHEN o.completed_at IS NOT NULL THEN 'awaiting_approval'
    ELSE 'pending_onboarding'
  END,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.training_programs tp WHERE tp.user_id = ur.user_id)
      OR EXISTS (SELECT 1 FROM public.nutrition_plans np WHERE np.user_id = ur.user_id)
      THEN now()
    ELSE NULL
  END
FROM public.user_roles ur
LEFT JOIN public.onboarding_responses o ON o.user_id = ur.user_id
WHERE ur.role::text = 'client'
  AND NOT EXISTS (
    SELECT 1 FROM public.client_access ca WHERE ca.user_id = ur.user_id
  )
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.client_access ca
SET status = 'awaiting_approval',
    updated_at = now()
FROM public.onboarding_responses o
WHERE o.user_id = ca.user_id
  AND o.completed_at IS NOT NULL
  AND ca.status = 'pending_onboarding';

DROP POLICY IF EXISTS "Owner or admin reads program" ON public.training_programs;
CREATE POLICY "Owner or admin reads program"
  ON public.training_programs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
    )
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
    )
  );

DROP POLICY IF EXISTS "Owner reads own plan" ON public.nutrition_plans;
CREATE POLICY "Owner reads own plan"
  ON public.nutrition_plans FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
    )
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
    )
  );
