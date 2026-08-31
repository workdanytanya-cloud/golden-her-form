-- Production: duplicate key при «Новый курс» + право удалять черновики.

GRANT DELETE ON public.client_courses TO authenticated;

ALTER TABLE public.nutrition_plans
  DROP CONSTRAINT IF EXISTS nutrition_plans_user_id_key;

ALTER TABLE public.training_programs
  DROP CONSTRAINT IF EXISTS training_programs_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plans_course_id_key
  ON public.nutrition_plans (course_id)
  WHERE course_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS training_programs_course_id_key
  ON public.training_programs (course_id)
  WHERE course_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
