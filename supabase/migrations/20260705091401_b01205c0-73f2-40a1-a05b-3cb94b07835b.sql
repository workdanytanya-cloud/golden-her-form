CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;

ALTER POLICY "Admins delete notifications"
  ON public.admin_notifications
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins update notifications"
  ON public.admin_notifications
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins view notifications"
  ON public.admin_notifications
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins delete access"
  ON public.client_access
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins insert access"
  ON public.client_access
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins update access"
  ON public.client_access
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins view all access"
  ON public.client_access
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins manage dishes"
  ON public.dishes
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins delete measurements"
  ON public.measurements
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins insert measurements"
  ON public.measurements
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins update measurements"
  ON public.measurements
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins view all measurements"
  ON public.measurements
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Days follow parent plan (delete)"
  ON public.nutrition_plan_days
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

ALTER POLICY "Days follow parent plan (insert)"
  ON public.nutrition_plan_days
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

ALTER POLICY "Days follow parent plan (read)"
  ON public.nutrition_plan_days
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

ALTER POLICY "Days follow parent plan (update)"
  ON public.nutrition_plan_days
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

ALTER POLICY "Owner deletes own plan"
  ON public.nutrition_plans
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Owner reads own plan"
  ON public.nutrition_plans
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Owner updates own plan"
  ON public.nutrition_plans
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Owner writes own plan"
  ON public.nutrition_plans
  WITH CHECK (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins update all onboarding"
  ON public.onboarding_responses
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins view all onboarding"
  ON public.onboarding_responses
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins can view all profiles"
  ON public.profiles
  USING (private.has_role(auth.uid(), 'admin'));

ALTER POLICY "Admins can view all roles"
  ON public.user_roles
  USING (private.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.notify_admin_on_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _parts text[] := ARRAY[]::text[];
  _msg text;
BEGIN
  IF private.has_role(NEW.user_id, 'admin') THEN
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

CREATE OR REPLACE FUNCTION public.notify_admin_on_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _msg text;
  _is_new_completion boolean;
BEGIN
  IF private.has_role(NEW.user_id, 'admin') THEN
    RETURN NEW;
  END IF;

  _is_new_completion := NEW.completed_at IS NOT NULL AND (
    TG_OP = 'INSERT' OR OLD.completed_at IS NULL
  );

  IF NOT _is_new_completion THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Клиент') INTO _name
  FROM public.profiles WHERE id = NEW.user_id;

  _msg := COALESCE(_name, 'Клиент') || ' заполнил(а) анкету онбординга';

  INSERT INTO public.admin_notifications (type, client_id, message)
  VALUES ('onboarding', NEW.user_id, _msg);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;