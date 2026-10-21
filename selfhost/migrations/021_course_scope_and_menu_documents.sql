ALTER TABLE public.client_courses
  ADD COLUMN IF NOT EXISTS program_scope text NOT NULL DEFAULT 'both';

ALTER TABLE public.client_courses
  DROP CONSTRAINT IF EXISTS client_courses_program_scope_check;
ALTER TABLE public.client_courses
  ADD CONSTRAINT client_courses_program_scope_check
  CHECK (program_scope IN ('nutrition', 'training', 'both'));

UPDATE public.client_courses c
SET program_scope = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.course_id = c.id AND a.kind = 'nutrition'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.course_id = c.id AND a.kind = 'training'
  ) THEN 'nutrition'
  WHEN EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.course_id = c.id AND a.kind = 'training'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.client_program_assignments a
    WHERE a.course_id = c.id AND a.kind = 'nutrition'
  ) THEN 'training'
  ELSE 'both'
END;

CREATE TABLE IF NOT EXISTS public.client_course_scope_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.client_courses(id) ON DELETE CASCADE,
  old_scope text,
  new_scope text NOT NULL CHECK (new_scope IN ('nutrition', 'training', 'both')),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS client_course_scope_changes_course_idx
  ON public.client_course_scope_changes (course_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.nutrition_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.client_courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  display_mode text NOT NULL DEFAULT 'supplement'
    CHECK (display_mode IN ('supplement', 'primary')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  version integer NOT NULL CHECK (version > 0),
  replaces_id uuid REFERENCES public.nutrition_documents(id) ON DELETE RESTRICT,
  storage_key uuid NOT NULL UNIQUE,
  original_name text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  rendered_html text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  published_at timestamptz,
  archived_at timestamptz,
  UNIQUE (course_id, version)
);

CREATE INDEX IF NOT EXISTS nutrition_documents_client_course_idx
  ON public.nutrition_documents (client_id, course_id, status, version DESC);

CREATE OR REPLACE FUNCTION public.guard_published_nutrition_document()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') AND (
    OLD.storage_key IS DISTINCT FROM NEW.storage_key OR
    OLD.sha256 IS DISTINCT FROM NEW.sha256 OR
    OLD.size_bytes IS DISTINCT FROM NEW.size_bytes OR
    OLD.media_type IS DISTINCT FROM NEW.media_type OR
    OLD.original_name IS DISTINCT FROM NEW.original_name OR
    OLD.rendered_html IS DISTINCT FROM NEW.rendered_html OR
    OLD.version IS DISTINCT FROM NEW.version OR
    OLD.client_id IS DISTINCT FROM NEW.client_id OR
    OLD.course_id IS DISTINCT FROM NEW.course_id
  ) THEN
    RAISE EXCEPTION 'published nutrition document payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nutrition_documents_immutable_published ON public.nutrition_documents;
CREATE TRIGGER nutrition_documents_immutable_published
  BEFORE UPDATE ON public.nutrition_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_published_nutrition_document();
