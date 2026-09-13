CREATE OR REPLACE FUNCTION public.set_updated_at_utc()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = (now() AT TIME ZONE 'utc');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_utc();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_utc();

DROP TRIGGER IF EXISTS client_access_set_updated_at ON public.client_access;
CREATE TRIGGER client_access_set_updated_at
  BEFORE UPDATE ON public.client_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_utc();

CREATE OR REPLACE FUNCTION public.prevent_published_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Удаление опубликованных версий программ запрещено';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.snapshot IS DISTINCT FROM NEW.snapshot
     OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
     OR OLD.client_id IS DISTINCT FROM NEW.client_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.parent_version_id IS DISTINCT FROM NEW.parent_version_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.course_id IS DISTINCT FROM NEW.course_id
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
  RAISE EXCEPTION 'Журнал изменений программ нельзя изменять или удалять';
END;
$$;

DROP TRIGGER IF EXISTS program_change_log_immutable ON public.program_change_log;
CREATE TRIGGER program_change_log_immutable
  BEFORE UPDATE OR DELETE ON public.program_change_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_program_change_log_mutation();

CREATE OR REPLACE FUNCTION public.prevent_exercise_media_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Журнал ссылок на видео нельзя изменять или удалять';
END;
$$;

DROP TRIGGER IF EXISTS exercise_media_change_log_immutable ON public.exercise_media_change_log;
CREATE TRIGGER exercise_media_change_log_immutable
  BEFORE UPDATE OR DELETE ON public.exercise_media_change_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_exercise_media_log_mutation();

CREATE OR REPLACE FUNCTION public.assert_assignment_points_to_published()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client uuid;
  v_course uuid;
  v_status text;
BEGIN
  IF NEW.kind = 'nutrition' THEN
    SELECT client_id, course_id, status INTO v_client, v_course, v_status
    FROM public.nutrition_plan_versions WHERE id = NEW.active_version_id;
  ELSIF NEW.kind = 'training' THEN
    SELECT client_id, course_id, status INTO v_client, v_course, v_status
    FROM public.training_program_versions WHERE id = NEW.active_version_id;
  ELSE
    RAISE EXCEPTION 'Неизвестный kind назначения';
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Назначение ссылается на несуществующую версию';
  END IF;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'Назначение может указывать только на published-версию';
  END IF;
  IF v_client IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'Версия принадлежит другому клиенту';
  END IF;
  IF v_course IS DISTINCT FROM NEW.course_id THEN
    RAISE EXCEPTION 'Версия принадлежит другому курсу';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_program_assignments_published ON public.client_program_assignments;
CREATE TRIGGER client_program_assignments_published
  BEFORE INSERT OR UPDATE ON public.client_program_assignments
  FOR EACH ROW EXECUTE FUNCTION public.assert_assignment_points_to_published();
