-- ONE TIME in Supabase SQL Editor (production)
-- Adds week_index + seeds 12 sheet exercises from coach Google Sheet
-- After Run: Project Settings -> API -> Reload schema, then use Program from table in admin


-- Скопируйте целиком в Supabase → SQL Editor (production) и выполните один раз.
-- После этого: git pull на сервере, снова «Таблица тренера · 4 нед.» в админке.

-- 1) Колонки week_index и program_weeks
ALTER TABLE public.training_program_days
  ADD COLUMN IF NOT EXISTS week_index int NOT NULL DEFAULT 0
  CHECK (week_index >= 0 AND week_index <= 11);

ALTER TABLE public.training_program_days
  DROP CONSTRAINT IF EXISTS training_program_days_program_id_day_index_key;

ALTER TABLE public.training_program_days
  DROP CONSTRAINT IF EXISTS training_program_days_program_week_day_key;

ALTER TABLE public.training_program_days
  ADD CONSTRAINT training_program_days_program_week_day_key
  UNIQUE (program_id, week_index, day_index);

CREATE INDEX IF NOT EXISTS training_program_days_program_week_day_idx
  ON public.training_program_days (program_id, week_index, day_index);

ALTER TABLE public.training_programs
  ADD COLUMN IF NOT EXISTS program_weeks int NOT NULL DEFAULT 1
  CHECK (program_weeks >= 1 AND program_weeks <= 12);

-- 2) Атомарная замена дней (без «пустой программы» при ошибке вставки)
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
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = p_program_id AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'
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

GRANT EXECUTE ON FUNCTION public.replace_training_program_days(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_training_program_days(uuid, jsonb) TO service_role;

-- Обновить кэш схемы PostgREST (иногда нужно после ADD COLUMN)
NOTIFY pgrst, 'reload schema';


GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercises TO authenticated;

INSERT INTO public.exercises (
  slug, name, category, muscle_groups, equipment, difficulty, tags,
  description, cues, common_mistakes, video_url,
  default_sets, default_reps, tempo, rest_seconds
) VALUES
(
  'sheet-razminka',
  'Разминка',
  'warmup',
  ARRAY['всё тело']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','warmup','sheet','workout_1','workout_2','workout_3']::text[],
  'Общая разминка перед тренировкой (видео из библиотеки тренера). Ориентир: Выполняем перед тренировкой. Входит в: Тренировка №1, Тренировка №2, Тренировка №3.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/5d436898b2b4100b8f2606f572e42f37/?p=038n_orPqmuDZom6KBVQJw',
  1,
  'по видео',
  NULL,
  30
),
(
  'sheet-bokovye-vypady-v-pruzhinke',
  'Боковые выпады в пружинке',
  'strength_lower',
  ARRAY['ягодицы','квадрицепс','задняя поверхность бедра']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_1']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 2 мин. Входит в: Тренировка №1.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/c1ea8e41254566c91a28c3f26297bc4a/?p=ePnP31U0X_UFBK5f2JI_iQ',
  1,
  '2 мин',
  NULL,
  30
),
(
  'sheet-bokovye-vypady-s-pryzhkom',
  'Боковые выпады с прыжком',
  'strength_lower',
  ARRAY['ягодицы','квадрицепс','задняя поверхность бедра']::text[],
  ARRAY['mat']::text[],
  'intermediate',
  ARRAY['home','sheet','jumping','workout_1']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 1 мин. Входит в: Тренировка №1.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/5efa094470c7a7d4afc1306aa6daf148/?p=ChHl2sVhzTdICNwDEdsTpA',
  1,
  '1 мин',
  NULL,
  30
),
(
  'sheet-poluvypady-na-meste-s-podemom-ganteli-nad-golovoy',
  'Полувыпады на месте с подъемом гантели над головой',
  'strength_lower',
  ARRAY['ягодицы','квадрицепс','задняя поверхность бедра']::text[],
  ARRAY['dumbbell','mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','dumbbell','workout_1']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 1 мин на каждую сторону.. Входит в: Тренировка №1.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/888872dfce12c8c44a762d6ef58d281f/?p=MLPnTWm_932at39veIeJVQ',
  1,
  '1 мин на каждую сторону',
  NULL,
  30
),
(
  'sheet-lodochka-poocheredno',
  'Лодочка поочередно',
  'core',
  ARRAY['кор','пресс']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_1']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 2 мин. Входит в: Тренировка №1.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/bd6dcf87445b4f23b21a8b3aa4be459c/?p=AuaDAhHfEunk7h_3m_qIgw',
  1,
  '2 мин',
  NULL,
  30
),
(
  'sheet-press-v-planke-na-pryamyh-rukah',
  'Пресс в планке на прямых руках',
  'core',
  ARRAY['кор','пресс']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_1']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 1 мин. Входит в: Тренировка №1.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/6896fdc07245ff169d4c9b8023b39612/?p=EOWzU82lBzFAjfXgYJGw9w',
  1,
  '1 мин',
  NULL,
  30
),
(
  'sheet-zaminka',
  'Заминка',
  'cooldown',
  ARRAY['всё тело']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','cooldown','sheet','workout_1','workout_2','workout_3']::text[],
  'Заминка после тренировки (видео из библиотеки тренера). Ориентир: Выполняем в конце тренировки. Входит в: Тренировка №1, Тренировка №2, Тренировка №3.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/1f8b53551d198eb478db839f60e2b38e/?p=1E2mVrulGFVZwUevU6LL-w',
  1,
  'по видео',
  NULL,
  30
),
(
  'sheet-podem-ruk-iz-planki',
  'Подъем рук из планки',
  'strength_upper',
  ARRAY['грудные','плечи','трицепс','кор']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_2']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 2 мин.. Входит в: Тренировка №2.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/15631ca0fc206c840c4d52a46269ed48/?p=HjaTLDIU784vAr44y2k9EA',
  1,
  '2 мин',
  NULL,
  30
),
(
  'sheet-naklony-na-odnoy-noge',
  'Наклоны на одной ноге',
  'strength_lower',
  ARRAY['ягодицы','квадрицепс','задняя поверхность бедра']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_2']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 3 подхода. Входит в: Тренировка №2.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/ca55d570cd4fa40de091f3c5fa8a97c2/?p=zuRn-7u8F8sxDM6nXna9ZA',
  3,
  '10-12',
  NULL,
  60
),
(
  'sheet-prisedaniya-s-kasaniem-ladoney',
  'Приседания с касанием ладоней',
  'strength_lower',
  ARRAY['ягодицы','квадрицепс','задняя поверхность бедра']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_2']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 3 подхода. Входит в: Тренировка №2.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/9331f590c837919dd520ef4aa58eed8a/?p=SAXg8tWFAFz0MaiCMy-bAg',
  3,
  '10-12',
  NULL,
  60
),
(
  'sheet-otzhimanie-podem-ruki',
  'Отжимание+ подъем руки',
  'strength_upper',
  ARRAY['грудные','плечи','трицепс','кор']::text[],
  ARRAY['mat']::text[],
  'beginner',
  ARRAY['home','sheet','low_impact','workout_2']::text[],
  'Упражнение из программы тренера. Ориентир по времени/подходам — из таблицы; техника — по видео. Ориентир: 3 подхода. Входит в: Тренировка №2.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/3f4a7c277fa04b322a1201f80d73a77a/?p=_8iTZMqOERyAU_ia3PZFcA',
  3,
  '10-12',
  NULL,
  60
),
(
  'sheet-trenirovka',
  'Тренировка',
  'strength_full',
  ARRAY['всё тело']::text[],
  ARRAY['mat','dumbbell']::text[],
  'intermediate',
  ARRAY['home','circuit','sheet','workout_3']::text[],
  'Круговая тренировка целиком — выполнить 2 круга по видео. Ориентир: Выполнить 2 круга. Входит в: Тренировка №3.',
  '["Смотрите технику на видео тренера","Дышите ровно, без задержек"]'::jsonb,
  '["Спешка и потеря контроля","Выполнение через боль"]'::jsonb,
  'https://rutube.ru/video/private/7fa296acda21a0a927040e8691d0fc34/?p=irriLbC6v5LkCaKwW-qBfA',
  2,
  'круг',
  NULL,
  60
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  muscle_groups = EXCLUDED.muscle_groups,
  equipment = EXCLUDED.equipment,
  difficulty = EXCLUDED.difficulty,
  tags = EXCLUDED.tags,
  description = EXCLUDED.description,
  cues = EXCLUDED.cues,
  common_mistakes = EXCLUDED.common_mistakes,
  video_url = EXCLUDED.video_url,
  default_sets = EXCLUDED.default_sets,
  default_reps = EXCLUDED.default_reps,
  rest_seconds = EXCLUDED.rest_seconds,
  updated_at = now();
