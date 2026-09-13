-- Неизменяемые опубликованные версии меню и тренировок.
-- Безопасно: только CREATE IF NOT EXISTS, без DROP TABLE / TRUNCATE клиентских данных.
-- После apply: клиент читает snapshot; seed/деплой не перезаписывают версии.

-- ========== nutrition_plan_versions ==========
CREATE TABLE IF NOT EXISTS public.nutrition_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid REFERENCES public.nutrition_plan_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, version)
);

CREATE INDEX IF NOT EXISTS nutrition_plan_versions_client_status_idx
  ON public.nutrition_plan_versions (client_id, status);

-- ========== training_program_versions ==========
CREATE TABLE IF NOT EXISTS public.training_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid REFERENCES public.training_program_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, version)
);

CREATE INDEX IF NOT EXISTS training_program_versions_client_status_idx
  ON public.training_program_versions (client_id, status);

-- ========== client_program_assignments ==========
CREATE TABLE IF NOT EXISTS public.client_program_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nutrition', 'training')),
  active_version_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (client_id, kind)
);

-- ========== nutrition_recommendations ==========
CREATE TABLE IF NOT EXISTS public.nutrition_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL,
  based_on_version_id uuid REFERENCES public.nutrition_plan_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_trainer_review'
    CHECK (status IN ('pending_trainer_review', 'accepted', 'rejected', 'replaced')),
  assigned_kcal numeric(10,2) NOT NULL DEFAULT 0,
  assigned_protein_g numeric(10,2) NOT NULL DEFAULT 0,
  assigned_fat_g numeric(10,2) NOT NULL DEFAULT 0,
  assigned_carbs_g numeric(10,2) NOT NULL DEFAULT 0,
  recommended_kcal numeric(10,2) NOT NULL,
  recommended_protein_g numeric(10,2) NOT NULL,
  recommended_fat_g numeric(10,2) NOT NULL,
  recommended_carbs_g numeric(10,2) NOT NULL,
  assigned_weight_kg numeric(6,2),
  new_weight_kg numeric(6,2),
  bmr numeric(10,2) NOT NULL,
  tdee numeric(10,2) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS nutrition_recommendations_client_status_idx
  ON public.nutrition_recommendations (client_id, status, created_at DESC);

-- ========== program_change_log (append-only) ==========
CREATE TABLE IF NOT EXISTS public.program_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nutrition', 'training')),
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_version_id uuid,
  to_version_id uuid,
  measurement_id uuid,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS program_change_log_client_idx
  ON public.program_change_log (client_id, created_at DESC);

-- ========== Grants ==========
GRANT SELECT ON public.nutrition_plan_versions TO authenticated;
GRANT SELECT ON public.training_program_versions TO authenticated;
GRANT SELECT ON public.client_program_assignments TO authenticated;
GRANT SELECT ON public.nutrition_recommendations TO authenticated;
GRANT SELECT ON public.program_change_log TO authenticated;
GRANT ALL ON public.nutrition_plan_versions TO service_role;
GRANT ALL ON public.training_program_versions TO service_role;
GRANT ALL ON public.client_program_assignments TO service_role;
GRANT ALL ON public.nutrition_recommendations TO service_role;
GRANT ALL ON public.program_change_log TO service_role;

-- Admin may update recommendation status
GRANT UPDATE ON public.nutrition_recommendations TO authenticated;

-- ========== RLS ==========
ALTER TABLE public.nutrition_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_program_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_program_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS npv_select ON public.nutrition_plan_versions;
CREATE POLICY npv_select ON public.nutrition_plan_versions FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      client_id = auth.uid()
      AND status IN ('published', 'superseded', 'archived')
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
    )
  );

DROP POLICY IF EXISTS tpv_select ON public.training_program_versions;
CREATE POLICY tpv_select ON public.training_program_versions FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      client_id = auth.uid()
      AND status IN ('published', 'superseded', 'archived')
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
    )
  );

DROP POLICY IF EXISTS cpa_select ON public.client_program_assignments;
CREATE POLICY cpa_select ON public.client_program_assignments FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR client_id = auth.uid());

DROP POLICY IF EXISTS nrec_select ON public.nutrition_recommendations;
CREATE POLICY nrec_select ON public.nutrition_recommendations FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR client_id = auth.uid());

DROP POLICY IF EXISTS nrec_admin_update ON public.nutrition_recommendations;
CREATE POLICY nrec_admin_update ON public.nutrition_recommendations FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS pcl_select ON public.program_change_log;
CREATE POLICY pcl_select ON public.program_change_log FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR client_id = auth.uid());

-- Нет INSERT/UPDATE/DELETE политик для клиентов на versions/assignments/log —
-- пишет только SECURITY DEFINER RPC.

-- ========== Триггеры иммутабельности ==========
CREATE OR REPLACE FUNCTION public.prevent_published_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Удаление версий программ запрещено';
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Разрешаем только смену статуса published -> superseded|archived
  IF OLD.snapshot IS DISTINCT FROM NEW.snapshot
     OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
     OR OLD.client_id IS DISTINCT FROM NEW.client_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.parent_version_id IS DISTINCT FROM NEW.parent_version_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'Опубликованную версию нельзя изменять напрямую';
  END IF;

  IF OLD.status = 'published' AND NEW.status IN ('superseded', 'archived') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'superseded' AND NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Недопустимый переход статуса версии: % → %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS nutrition_plan_versions_immutable ON public.nutrition_plan_versions;
CREATE TRIGGER nutrition_plan_versions_immutable
  BEFORE UPDATE OR DELETE ON public.nutrition_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_published_version_mutation();

DROP TRIGGER IF EXISTS training_program_versions_immutable ON public.training_program_versions;
CREATE TRIGGER training_program_versions_immutable
  BEFORE UPDATE OR DELETE ON public.training_program_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_published_version_mutation();

CREATE OR REPLACE FUNCTION public.prevent_program_change_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Журнал изменений нельзя изменять или удалять';
END;
$$;

DROP TRIGGER IF EXISTS program_change_log_immutable ON public.program_change_log;
CREATE TRIGGER program_change_log_immutable
  BEFORE UPDATE OR DELETE ON public.program_change_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_program_change_log_mutation();

-- ========== Клиент не может UPDATE/DELETE замеры ==========
DROP POLICY IF EXISTS "Users update own measurements" ON public.measurements;
DROP POLICY IF EXISTS "Users delete own measurements" ON public.measurements;

-- ========== Клиент не пишет training_programs (только admin; onboarding — через отсутствие строки) ==========
DROP POLICY IF EXISTS "Owner inserts own program" ON public.training_programs;
CREATE POLICY "Owner inserts own program"
  ON public.training_programs FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.training_programs tp WHERE tp.user_id = auth.uid()
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'training'
      )
    )
  );

DROP POLICY IF EXISTS "Owner or admin updates program" ON public.training_programs;
CREATE POLICY "Owner or admin updates program"
  ON public.training_programs FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'training'
      )
    )
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'training'
      )
    )
  );

DROP POLICY IF EXISTS "Owner or admin deletes program" ON public.training_programs;
CREATE POLICY "Owner or admin deletes program"
  ON public.training_programs FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- Дни: admin всегда; клиент — только до первой публикации (онбординг-черновик)
DROP POLICY IF EXISTS "Days follow parent program (insert)" ON public.training_program_days;
DROP POLICY IF EXISTS "Days follow parent program (update)" ON public.training_program_days;
DROP POLICY IF EXISTS "Days follow parent program (delete)" ON public.training_program_days;
DROP POLICY IF EXISTS "Owner or admin writes days" ON public.training_program_days;
DROP POLICY IF EXISTS "Owner or admin updates days" ON public.training_program_days;
DROP POLICY IF EXISTS "Owner or admin deletes days" ON public.training_program_days;
DROP POLICY IF EXISTS "Owner or admin reads days" ON public.training_program_days;
DROP POLICY IF EXISTS "Days admin insert" ON public.training_program_days;
DROP POLICY IF EXISTS "Days admin update" ON public.training_program_days;
DROP POLICY IF EXISTS "Days admin delete" ON public.training_program_days;

CREATE POLICY "Owner or admin reads days"
  ON public.training_program_days FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.client_access ca
          WHERE ca.user_id = auth.uid()
            AND ca.status IN ('active', 'awaiting_approval')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.client_program_assignments a
          WHERE a.client_id = auth.uid() AND a.kind = 'training'
        )
    )
  );

CREATE POLICY "Days admin insert" ON public.training_program_days FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.client_program_assignments a
          WHERE a.client_id = auth.uid() AND a.kind = 'training'
        )
    )
  );

CREATE POLICY "Days admin update" ON public.training_program_days FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.client_program_assignments a
          WHERE a.client_id = auth.uid() AND a.kind = 'training'
        )
    )
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.client_program_assignments a
          WHERE a.client_id = auth.uid() AND a.kind = 'training'
        )
    )
  );

CREATE POLICY "Days admin delete" ON public.training_program_days FOR DELETE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id AND p.user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.client_program_assignments a
          WHERE a.client_id = auth.uid() AND a.kind = 'training'
        )
    )
  );
-- Клиент не меняет legacy-меню после появления assignment
DROP POLICY IF EXISTS "Owner updates own plan" ON public.nutrition_plans;
CREATE POLICY "Owner updates own plan"
  ON public.nutrition_plans FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND COALESCE(plan_mode, 'legacy') <> 'constructor'
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
      )
    )
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND COALESCE(plan_mode, 'legacy') <> 'constructor'
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
      )
    )
  );

-- Уточнение: если assignment есть — клиент не читает nutrition_plans вообще
DROP POLICY IF EXISTS "Owner reads own plan" ON public.nutrition_plans;
CREATE POLICY "Owner reads own plan"
  ON public.nutrition_plans FOR SELECT TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.client_access ca
        WHERE ca.user_id = auth.uid()
          AND ca.status IN ('active', 'awaiting_approval')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
      )
      AND (
        COALESCE(plan_mode, 'legacy') <> 'constructor'
        OR plan_status = 'assigned'
      )
    )
  );

DROP POLICY IF EXISTS "Days follow parent plan (read)" ON public.nutrition_plan_days;
CREATE POLICY "Days follow parent plan (read)"
  ON public.nutrition_plan_days FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (
            p.user_id = auth.uid()
            AND NOT EXISTS (
              SELECT 1 FROM public.client_program_assignments a
              WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
            )
            AND (
              COALESCE(p.plan_mode, 'legacy') <> 'constructor'
              OR p.plan_status = 'assigned'
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "Days follow parent plan (update)" ON public.nutrition_plan_days;
CREATE POLICY "Days follow parent plan (update)"
  ON public.nutrition_plan_days FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (
            p.user_id = auth.uid()
            AND COALESCE(p.plan_mode, 'legacy') <> 'constructor'
            AND NOT EXISTS (
              SELECT 1 FROM public.client_program_assignments a
              WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nutrition_plans p
      WHERE p.id = nutrition_plan_days.plan_id
        AND (
          private.has_role(auth.uid(), 'admin')
          OR (
            p.user_id = auth.uid()
            AND COALESCE(p.plan_mode, 'legacy') <> 'constructor'
            AND NOT EXISTS (
              SELECT 1 FROM public.client_program_assignments a
              WHERE a.client_id = auth.uid() AND a.kind = 'nutrition'
            )
          )
        )
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
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = auth.uid() AND a.kind = 'training'
      )
    )
  );

-- ========== RPC публикации ==========
CREATE OR REPLACE FUNCTION public.publish_nutrition_version(
  p_client_id uuid,
  p_snapshot jsonb,
  p_content_hash text,
  p_reason text DEFAULT NULL,
  p_measurement_id uuid DEFAULT NULL,
  p_recommendation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
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

  SELECT a.active_version_id, v.version
    INTO v_prev_id, v_prev_ver
  FROM public.client_program_assignments a
  JOIN public.nutrition_plan_versions v ON v.id = a.active_version_id
  WHERE a.client_id = p_client_id AND a.kind = 'nutrition';

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.nutrition_plan_versions
      SET status = 'superseded'
      WHERE id = v_prev_id AND status = 'published';
    v_new_ver := COALESCE(v_prev_ver, 0) + 1;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_ver
    FROM public.nutrition_plan_versions WHERE client_id = p_client_id;
  END IF;

  INSERT INTO public.nutrition_plan_versions (
    client_id, version, status, snapshot, content_hash,
    parent_version_id, created_by, published_at, published_by
  ) VALUES (
    p_client_id, v_new_ver, 'published', p_snapshot, p_content_hash,
    v_prev_id, v_actor, now(), v_actor
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.client_program_assignments (client_id, kind, active_version_id, updated_by)
  VALUES (p_client_id, 'nutrition', v_new_id, v_actor)
  ON CONFLICT (client_id, kind) DO UPDATE
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
      'recommendation_id', p_recommendation_id
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
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
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

  SELECT a.active_version_id, v.version
    INTO v_prev_id, v_prev_ver
  FROM public.client_program_assignments a
  JOIN public.training_program_versions v ON v.id = a.active_version_id
  WHERE a.client_id = p_client_id AND a.kind = 'training';

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.training_program_versions
      SET status = 'superseded'
      WHERE id = v_prev_id AND status = 'published';
    v_new_ver := COALESCE(v_prev_ver, 0) + 1;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_ver
    FROM public.training_program_versions WHERE client_id = p_client_id;
  END IF;

  INSERT INTO public.training_program_versions (
    client_id, version, status, snapshot, content_hash,
    parent_version_id, created_by, published_at, published_by
  ) VALUES (
    p_client_id, v_new_ver, 'published', p_snapshot, p_content_hash,
    v_prev_id, v_actor, now(), v_actor
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.client_program_assignments (client_id, kind, active_version_id, updated_by)
  VALUES (p_client_id, 'training', v_new_id, v_actor)
  ON CONFLICT (client_id, kind) DO UPDATE
    SET active_version_id = EXCLUDED.active_version_id,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  INSERT INTO public.program_change_log (
    client_id, kind, action, actor_id, from_version_id, to_version_id, diff
  ) VALUES (
    p_client_id, 'training', 'publish', v_actor, v_prev_id, v_new_id,
    jsonb_build_object('reason', p_reason, 'content_hash', p_content_hash)
  );

  INSERT INTO public.client_notifications (user_id, type, message, link)
  VALUES (
    p_client_id,
    'training_published',
    'Тренер обновил вашу программу тренировок',
    '/dashboard/training'
  );

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_nutrition_version(uuid, jsonb, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_training_version(uuid, jsonb, text, text) TO authenticated;

-- replace_training_program_days: admin всегда; клиент — только до первой публикации
CREATE OR REPLACE FUNCTION public.replace_training_program_days(
  p_program_id uuid,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.training_programs WHERE id = p_program_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Программа не найдена';
  END IF;

  IF NOT (
    private.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = v_owner
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_assignments a
        WHERE a.client_id = v_owner AND a.kind = 'training'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Нет доступа к программе';
  END IF;

  DELETE FROM public.training_program_days WHERE program_id = p_program_id;

  INSERT INTO public.training_program_days (
    program_id, week_index, day_index, is_rest, title, focus, description,
    warmup, exercises, cooldown, day_note
  )
  SELECT
    p_program_id,
    COALESCE((r->>'week_index')::int, 0),
    (r->>'day_index')::int,
    COALESCE((r->>'is_rest')::boolean, false),
    COALESCE(r->>'title', ''),
    r->>'focus',
    r->>'description',
    COALESCE(r->'warmup', '[]'::jsonb),
    COALESCE(r->'exercises', '[]'::jsonb),
    COALESCE(r->'cooldown', '[]'::jsonb),
    r->>'day_note'
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ========== Рекомендация после замера (меню не трогаем) ==========
CREATE OR REPLACE FUNCTION public.create_nutrition_recommendation_on_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weight numeric;
  v_height numeric;
  v_gender text;
  v_birth date;
  v_age int;
  v_activity text;
  v_goal text;
  v_factor numeric;
  v_adj numeric;
  v_bmr numeric;
  v_tdee numeric;
  v_kcal numeric;
  v_prot numeric;
  v_fat numeric;
  v_carbs numeric;
  v_assigned jsonb;
  v_ver uuid;
  v_ak numeric := 0;
  v_ap numeric := 0;
  v_af numeric := 0;
  v_ac numeric := 0;
BEGIN
  v_weight := NEW.weight_kg;
  IF v_weight IS NULL OR v_weight < 30 THEN
    RETURN NEW;
  END IF;

  SELECT p.height_cm, p.gender, p.birth_date
    INTO v_height, v_gender, v_birth
  FROM public.profiles p WHERE p.id = NEW.user_id;

  SELECT o.activity_level, o.goal_primary
    INTO v_activity, v_goal
  FROM public.onboarding_responses o WHERE o.user_id = NEW.user_id;

  v_height := COALESCE(v_height, 165);
  v_age := COALESCE(
    EXTRACT(YEAR FROM age(CURRENT_DATE, v_birth))::int,
    30
  );
  v_factor := CASE lower(COALESCE(v_activity, 'medium'))
    WHEN 'sedentary' THEN 1.2
    WHEN 'low' THEN 1.2
    WHEN 'high' THEN 1.55
    WHEN 'very_high' THEN 1.725
    ELSE 1.375
  END;
  v_adj := CASE
    WHEN lower(COALESCE(v_goal, '')) ~ '(похуд|снижен|жир|lose)' THEN -0.15
    WHEN lower(COALESCE(v_goal, '')) ~ '(набор|мышц|gain)' THEN 0.10
    ELSE 0
  END;

  IF COALESCE(v_gender, 'female') = 'male' THEN
    v_bmr := 10 * v_weight + 6.25 * v_height - 5 * v_age + 5;
  ELSE
    v_bmr := 10 * v_weight + 6.25 * v_height - 5 * v_age - 161;
  END IF;
  v_tdee := v_bmr * v_factor;
  v_prot := round((v_weight * 1.8)::numeric, 1);
  v_fat := round((v_weight * 0.9)::numeric, 1);
  v_kcal := round((v_tdee * (1 + v_adj))::numeric, 0);
  -- синхронизация ккал с БЖУ
  v_carbs := greatest(0, round(((v_kcal - v_prot * 4 - v_fat * 9) / 4)::numeric, 1));
  v_kcal := round((v_prot * 4 + v_carbs * 4 + v_fat * 9)::numeric, 0);

  SELECT a.active_version_id, v.snapshot->'targets'
    INTO v_ver, v_assigned
  FROM public.client_program_assignments a
  JOIN public.nutrition_plan_versions v ON v.id = a.active_version_id
  WHERE a.client_id = NEW.user_id AND a.kind = 'nutrition' AND v.status = 'published';

  IF v_assigned IS NOT NULL THEN
    v_ak := COALESCE((v_assigned->>'kcal')::numeric, 0);
    v_ap := COALESCE((v_assigned->>'protein_g')::numeric, 0);
    v_af := COALESCE((v_assigned->>'fat_g')::numeric, 0);
    v_ac := COALESCE((v_assigned->>'carbs_g')::numeric, 0);
  END IF;

  UPDATE public.nutrition_recommendations
    SET status = 'replaced'
    WHERE client_id = NEW.user_id AND status = 'pending_trainer_review';

  INSERT INTO public.nutrition_recommendations (
    client_id, measurement_id, based_on_version_id, status,
    assigned_kcal, assigned_protein_g, assigned_fat_g, assigned_carbs_g,
    recommended_kcal, recommended_protein_g, recommended_fat_g, recommended_carbs_g,
    new_weight_kg, bmr, tdee, reason
  ) VALUES (
    NEW.user_id, NEW.id, v_ver, 'pending_trainer_review',
    v_ak, v_ap, v_af, v_ac,
    v_kcal, v_prot, v_fat, v_carbs,
    v_weight, round(v_bmr, 0), round(v_tdee, 0),
    'Новые замеры клиента — требуется проверка тренера'
  );

  INSERT INTO public.admin_notifications (type, client_id, measurement_id, message)
  VALUES (
    'nutrition_recommendation',
    NEW.user_id,
    NEW.id,
    'Новые замеры: пересчитана рекомендация КБЖУ. Активное меню не изменено — нужна проверка.'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS measurements_create_nutrition_recommendation ON public.measurements;
CREATE TRIGGER measurements_create_nutrition_recommendation
  AFTER INSERT ON public.measurements
  FOR EACH ROW EXECUTE FUNCTION public.create_nutrition_recommendation_on_measurement();

-- ========== Backfill существующих программ ==========
CREATE OR REPLACE FUNCTION public.freeze_exercise_sets(p_sets jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    s || jsonb_build_object(
      'exercise', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', e.id,
        'slug', e.slug,
        'name', e.name,
        'category', e.category,
        'muscle_groups', to_jsonb(e.muscle_groups),
        'equipment', to_jsonb(e.equipment),
        'difficulty', e.difficulty,
        'tags', to_jsonb(e.tags),
        'description', e.description,
        'cues', e.cues,
        'common_mistakes', e.common_mistakes,
        'gif_url', e.gif_url,
        'video_url', e.video_url,
        'default_sets', e.default_sets,
        'default_reps', e.default_reps,
        'tempo', e.tempo,
        'rest_seconds', e.rest_seconds
      ) END
    )
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_sets, '[]'::jsonb)) AS s
  LEFT JOIN public.exercises e ON e.id::text = s->>'exercise_id';
$$;

-- Тренировки: backfill published v1
INSERT INTO public.training_program_versions (
  client_id, version, status, snapshot, content_hash, created_by, published_at, published_by
)
SELECT
  p.user_id,
  1,
  'published',
  jsonb_build_object(
    'name', 'Программа тренировок',
    'sessions_per_week', p.sessions_per_week,
    'goal', p.goal,
    'level', p.level,
    'has_injuries', p.has_injuries,
    'injuries_details', p.injuries_details,
    'equipment', to_jsonb(p.equipment),
    'location', p.location,
    'notes', p.notes,
    'faq', p.faq,
    'program_weeks', COALESCE(p.program_weeks, 1),
    'days', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'week_index', COALESCE(d.week_index, 0),
          'day_index', d.day_index,
          'is_rest', d.is_rest,
          'title', d.title,
          'focus', d.focus,
          'description', d.description,
          'warmup', public.freeze_exercise_sets(d.warmup),
          'exercises', public.freeze_exercise_sets(d.exercises),
          'cooldown', public.freeze_exercise_sets(d.cooldown),
          'day_note', d.day_note
        ) ORDER BY COALESCE(d.week_index, 0), d.day_index
      )
      FROM public.training_program_days d WHERE d.program_id = p.id
    ), '[]'::jsonb)
  ),
  md5(p.id::text || COALESCE(p.generated_at::text, '')),
  NULL,
  now(),
  NULL
FROM public.training_programs p
WHERE EXISTS (SELECT 1 FROM public.training_program_days d WHERE d.program_id = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.training_program_versions v WHERE v.client_id = p.user_id
  );

INSERT INTO public.client_program_assignments (client_id, kind, active_version_id)
SELECT v.client_id, 'training', v.id
FROM public.training_program_versions v
WHERE v.version = 1 AND v.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.client_id = v.client_id AND a.kind = 'training'
  );

-- Питание constructor: backfill из meal_plan_items
INSERT INTO public.nutrition_plan_versions (
  client_id, version, status, snapshot, content_hash, published_at
)
SELECT
  p.user_id,
  1,
  'published',
  jsonb_build_object(
    'kind', 'constructor',
    'meal_schedule_mode', COALESCE(p.meal_schedule_mode, 'two_main_two_snacks'),
    'primary_meal_slot', COALESCE(p.primary_meal_slot, 'lunch'),
    'meals_per_day', 4,
    'targets', jsonb_build_object(
      'kcal', p.target_kcal,
      'protein_g', p.target_protein_g,
      'fat_g', p.target_fat_g,
      'carbs_g', p.target_carbs_g
    ),
    'bmr', p.bmr,
    'tdee', p.tdee,
    'calorie_adjustment_pct', p.calorie_adjustment_pct,
    'constructor_days', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'day_index', d.day_index,
          'day_note', d.day_note,
          'items', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'slot', i.slot,
                'recipe_id', i.recipe_id,
                'recipe_name', i.recipe_name,
                'requires_cooking', i.requires_cooking,
                'prep_time_min', i.prep_time_min,
                'steps', i.steps,
                'weighing_note', i.weighing_note,
                'snack_action', i.snack_action,
                'replacements', '[]'::jsonb,
                'ingredients', COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'product_id', ig.product_id,
                      'product_name', ig.product_name,
                      'grams', ig.grams::text,
                      'weighing_note', ig.weighing_note,
                      'measurement_state', ig.weighing_note,
                      'kcal_per_100g', ig.kcal_per_100g::text,
                      'protein_per_100g', ig.protein_per_100g::text,
                      'fat_per_100g', ig.fat_per_100g::text,
                      'carbs_per_100g', ig.carbs_per_100g::text,
                      'fiber_per_100g', ig.fiber_per_100g::text,
                      'kcal', ig.kcal::text,
                      'protein_g', ig.protein_g::text,
                      'fat_g', ig.fat_g::text,
                      'carbs_g', ig.carbs_g::text,
                      'fiber_g', ig.fiber_g::text,
                      'sort_order', ig.sort_order
                    ) ORDER BY ig.sort_order
                  )
                  FROM public.meal_plan_item_ingredients ig
                  WHERE ig.meal_item_id = i.id
                ), '[]'::jsonb),
                'kcal', i.kcal::text,
                'protein_g', i.protein_g::text,
                'fat_g', i.fat_g::text,
                'carbs_g', i.carbs_g::text,
                'fiber_g', i.fiber_g::text
              ) ORDER BY i.sort_order
            )
            FROM public.meal_plan_items i WHERE i.plan_day_id = d.id
          ), '[]'::jsonb),
          'kcal', COALESCE((SELECT SUM(i2.kcal)::text FROM public.meal_plan_items i2 WHERE i2.plan_day_id = d.id), '0'),
          'protein_g', COALESCE((SELECT SUM(i2.protein_g)::text FROM public.meal_plan_items i2 WHERE i2.plan_day_id = d.id), '0'),
          'fat_g', COALESCE((SELECT SUM(i2.fat_g)::text FROM public.meal_plan_items i2 WHERE i2.plan_day_id = d.id), '0'),
          'carbs_g', COALESCE((SELECT SUM(i2.carbs_g)::text FROM public.meal_plan_items i2 WHERE i2.plan_day_id = d.id), '0'),
          'fiber_g', COALESCE((SELECT SUM(i2.fiber_g)::text FROM public.meal_plan_items i2 WHERE i2.plan_day_id = d.id), '0')
        ) ORDER BY d.day_index
      )
      FROM public.nutrition_plan_days d WHERE d.plan_id = p.id
    ), '[]'::jsonb),
    'legacy_days', '[]'::jsonb,
    'notes', p.notes,
    'reason', 'backfill'
  ),
  md5(p.id::text || COALESCE(p.generated_at::text, '')),
  now()
FROM public.nutrition_plans p
WHERE COALESCE(p.plan_mode, 'legacy') = 'constructor'
  AND COALESCE(p.plan_status, 'draft') = 'assigned'
  AND EXISTS (
    SELECT 1 FROM public.nutrition_plan_days d
    JOIN public.meal_plan_items i ON i.plan_day_id = d.id
    WHERE d.plan_id = p.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_plan_versions v WHERE v.client_id = p.user_id
  );

-- Legacy menus backfill
INSERT INTO public.nutrition_plan_versions (
  client_id, version, status, snapshot, content_hash, published_at
)
SELECT
  p.user_id,
  1,
  'published',
  jsonb_build_object(
    'kind', 'legacy',
    'meal_schedule_mode', 'legacy',
    'primary_meal_slot', 'lunch',
    'meals_per_day', p.meals_per_day,
    'targets', jsonb_build_object(
      'kcal', p.target_kcal,
      'protein_g', p.target_protein_g,
      'fat_g', p.target_fat_g,
      'carbs_g', p.target_carbs_g
    ),
    'bmr', NULL,
    'tdee', NULL,
    'calorie_adjustment_pct', NULL,
    'constructor_days', '[]'::jsonb,
    'legacy_days', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'day_index', d.day_index,
          'day_note', d.day_note,
          'meals', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'slot', m->>'slot',
                'portion_g', COALESCE((m->>'portion_g')::numeric, 0),
                'note', m->>'note',
                'dish', jsonb_build_object(
                  'id', ds.id,
                  'slug', ds.slug,
                  'name', ds.name,
                  'meal_type', ds.meal_type,
                  'calories_per_100g', ds.calories_per_100g,
                  'protein_per_100g', ds.protein_per_100g,
                  'fat_per_100g', ds.fat_per_100g,
                  'carbs_per_100g', ds.carbs_per_100g,
                  'ingredients', ds.ingredients,
                  'steps', ds.steps,
                  'replacements', ds.replacements,
                  'description', ds.description
                )
              )
            )
            FROM jsonb_array_elements(COALESCE(d.meals, '[]'::jsonb)) m
            LEFT JOIN public.dishes ds ON ds.id::text = m->>'dish_id'
          ), '[]'::jsonb)
        ) ORDER BY d.day_index
      )
      FROM public.nutrition_plan_days d WHERE d.plan_id = p.id
    ), '[]'::jsonb),
    'notes', p.notes,
    'reason', 'backfill'
  ),
  md5(p.id::text || COALESCE(p.generated_at::text, '')),
  now()
FROM public.nutrition_plans p
WHERE COALESCE(p.plan_mode, 'legacy') = 'legacy'
  AND EXISTS (SELECT 1 FROM public.nutrition_plan_days d WHERE d.plan_id = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_plan_versions v WHERE v.client_id = p.user_id
  );

INSERT INTO public.client_program_assignments (client_id, kind, active_version_id)
SELECT v.client_id, 'nutrition', v.id
FROM public.nutrition_plan_versions v
WHERE v.version = 1 AND v.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.client_id = v.client_id AND a.kind = 'nutrition'
  );

INSERT INTO public.program_change_log (client_id, kind, action, actor_id, to_version_id, diff)
SELECT v.client_id, 'nutrition', 'backfill_publish', NULL, v.id,
  jsonb_build_object('content_hash', v.content_hash)
FROM public.nutrition_plan_versions v
WHERE v.version = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.program_change_log l
    WHERE l.to_version_id = v.id AND l.action = 'backfill_publish'
  );

INSERT INTO public.program_change_log (client_id, kind, action, actor_id, to_version_id, diff)
SELECT v.client_id, 'training', 'backfill_publish', NULL, v.id,
  jsonb_build_object('content_hash', v.content_hash)
FROM public.training_program_versions v
WHERE v.version = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.program_change_log l
    WHERE l.to_version_id = v.id AND l.action = 'backfill_publish'
  );
