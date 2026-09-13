-- Мультинедельные программы (до 12 недель): week_index + program_weeks

ALTER TABLE public.training_program_days
  ADD COLUMN IF NOT EXISTS week_index int NOT NULL DEFAULT 0
  CHECK (week_index >= 0 AND week_index <= 11);

ALTER TABLE public.training_program_days
  DROP CONSTRAINT IF EXISTS training_program_days_program_id_day_index_key;

ALTER TABLE public.training_program_days
  ADD CONSTRAINT training_program_days_program_week_day_key
  UNIQUE (program_id, week_index, day_index);

CREATE INDEX IF NOT EXISTS training_program_days_program_week_day_idx
  ON public.training_program_days (program_id, week_index, day_index);

ALTER TABLE public.training_programs
  ADD COLUMN IF NOT EXISTS program_weeks int NOT NULL DEFAULT 1
  CHECK (program_weeks >= 1 AND program_weeks <= 12);
