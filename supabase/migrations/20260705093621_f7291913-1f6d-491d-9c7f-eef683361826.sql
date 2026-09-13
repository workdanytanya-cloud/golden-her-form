
-- ============ EXERCISES ============
CREATE TABLE public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL, -- warmup | mobility | activation | core | strength_lower | strength_upper | strength_full | cardio | cooldown
  muscle_groups text[] NOT NULL DEFAULT '{}',
  equipment text[] NOT NULL DEFAULT '{}', -- bodyweight, dumbbell, band, mat, bench, ...
  difficulty text NOT NULL DEFAULT 'beginner', -- beginner | intermediate | advanced
  tags text[] NOT NULL DEFAULT '{}', -- rehab, low_impact, no_jumping, home, ...
  description text,
  cues jsonb NOT NULL DEFAULT '[]'::jsonb,          -- string[]: ключевые технические подсказки
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb, -- string[]
  gif_url text,
  video_url text,
  default_sets int NOT NULL DEFAULT 3,
  default_reps text NOT NULL DEFAULT '12',
  tempo text, -- e.g. '3-1-1'
  rest_seconds int NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.exercises TO authenticated;
GRANT ALL ON public.exercises TO service_role;

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exercises readable by authenticated"
  ON public.exercises FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admin can insert exercises"
  ON public.exercises FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admin can update exercises"
  ON public.exercises FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admin can delete exercises"
  ON public.exercises FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE TRIGGER exercises_set_updated
  BEFORE UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TRAINING PROGRAMS ============
CREATE TABLE public.training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  sessions_per_week int NOT NULL DEFAULT 3,
  goal text,                -- weight_loss | tone | muscle_gain | rehab | maintain
  level text NOT NULL DEFAULT 'beginner',
  has_injuries boolean NOT NULL DEFAULT false,
  injuries_details text,
  equipment text[] NOT NULL DEFAULT '{}',
  location text,            -- home | gym | outdoor
  notes text,               -- комментарий тренера
  faq jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{q, a}]
  targets_manual boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_programs TO authenticated;
GRANT ALL ON public.training_programs TO service_role;

ALTER TABLE public.training_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner or admin reads program"
  ON public.training_programs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner inserts own program"
  ON public.training_programs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner or admin updates program"
  ON public.training_programs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner or admin deletes program"
  ON public.training_programs FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'));

CREATE TRIGGER training_programs_set_updated
  BEFORE UPDATE ON public.training_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TRAINING DAYS ============
CREATE TABLE public.training_program_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.training_programs(id) ON DELETE CASCADE,
  day_index int NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  is_rest boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '',
  focus text,          -- на что направлена (мышечные группы / цель)
  description text,    -- задачи тренировки
  warmup jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{exercise_id, sets, reps, rest_seconds, tempo, note}]
  exercises jsonb NOT NULL DEFAULT '[]'::jsonb,
  cooldown jsonb NOT NULL DEFAULT '[]'::jsonb,
  day_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, day_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_program_days TO authenticated;
GRANT ALL ON public.training_program_days TO service_role;

ALTER TABLE public.training_program_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner or admin reads days"
  ON public.training_program_days FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Owner or admin writes days"
  ON public.training_program_days FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Owner or admin updates days"
  ON public.training_program_days FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Owner or admin deletes days"
  ON public.training_program_days FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_programs p
      WHERE p.id = program_id
        AND (p.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
    )
  );

CREATE TRIGGER training_program_days_set_updated
  BEFORE UPDATE ON public.training_program_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX ON public.training_program_days (program_id, day_index);

-- ============ SEED EXERCISES ============
INSERT INTO public.exercises
  (slug, name, category, muscle_groups, equipment, difficulty, tags, description, cues, common_mistakes, default_sets, default_reps, tempo, rest_seconds)
VALUES
-- WARMUP / MOBILITY (общая разминка)
('cat-cow','Кошка-корова','warmup','{"позвоночник","кор"}','{"mat"}','beginner','{"rehab","low_impact","home"}',
 'Плавное прокатывание позвоночника из округления в прогиб. Разогревает межпозвонковые сегменты и активирует глубокие стабилизаторы.',
 '["Ладони под плечами, колени под тазом","Вдох — макушкой тянемся вперёд, грудь раскрывается","Выдох — округляем спину, прижимаем подбородок к груди","Двигаемся медленно, без резких переломов"]',
 '["Резкие переразгибания в пояснице","Проваленные плечи","Задержки дыхания"]',
 2,'8-10','3-1-3',30),

('worlds-greatest-stretch','World''s Greatest Stretch','warmup','{"бёдра","грудной отдел","кор"}','{"mat"}','beginner','{"mobility","home"}',
 'Комплексная мобилизация: раскрывает тазобедренный, грудной отдел и заднюю поверхность бедра одним движением.',
 '["Из планки шагаем ногой к одноимённой руке","Опорная ладонь под плечом, задняя нога прямая","На вдохе поднимаем руку вверх, разворачивая грудь","Взгляд за рукой, таз держим ровно"]',
 '["Прогиб в пояснице вместо ротации в грудном","Заваленное колено передней ноги"]',
 2,'6 на сторону','2-1-2',30),

('band-shoulder-dislocates','Раскрытие плеч с резинкой','warmup','{"плечи","грудной отдел"}','{"band"}','beginner','{"rehab","mobility"}',
 'Мягкая мобилизация плечевых суставов. Улучшает подвижность и готовит плечи к жимам и тягам.',
 '["Резинка шире плеч, хват сверху","Прямые руки проводим над головой назад и обратно","Живот держим втянутым, рёбра не выпячиваем","Движение медленное, без рывков"]',
 '["Слишком узкий хват","Прогиб в пояснице","Сгибание локтей"]',
 2,'10','2-0-2',30),

('leg-swings','Махи ногой стоя','warmup','{"бёдра"}','{}','beginner','{"mobility","home"}',
 'Динамическая мобилизация тазобедренного сустава — вперёд-назад и в стороны.',
 '["Держимся за опору, корпус ровно","Мах в амплитуде, где нет боли","Стопа расслаблена","Таз стабилен, не заваливаем"]',
 '["Раскачка корпусом","Мах через боль"]',
 1,'10 на сторону','1-0-1',20),

('hip-circles','Круги тазом','warmup','{"таз","поясница"}','{}','beginner','{"mobility","home"}',
 'Мягко смазывает тазобедренные суставы и активирует поясницу.',
 '["Ноги на ширине таза, колени мягкие","Круги медленные, амплитуда без боли","Работает таз, а не всё туловище"]',
 '["Резкие движения","Прогиб в пояснице"]',
 1,'8 в каждую сторону','2-0-2',20),

-- ACTIVATION
('glute-bridge','Ягодичный мостик','activation','{"ягодицы","задняя поверхность бедра"}','{"mat"}','beginner','{"rehab","low_impact","home"}',
 'База для активации ягодиц. Устраняет доминирование поясницы в разгибании бедра.',
 '["Стопы на ширине таза, пятки под коленями","Выжимаем таз пятками, сжимая ягодицы","Ребра прижаты, поясница нейтральна","Пик — сжатие ягодиц 1 секунду, затем медленно вниз"]',
 '["Толчок поясницей вместо ягодиц","Заваленные внутрь колени","Приподнятые пятки"]',
 3,'12-15','2-1-2',45),

('clamshell','Ракушка с резинкой','activation','{"средняя ягодичная"}','{"band","mat"}','beginner','{"rehab","home"}',
 'Изолирует среднюю ягодичную мышцу — ключ к стабильному тазу и здоровым коленям.',
 '["Лёжа на боку, колени согнуты, стопы вместе","Резинка над коленями","Разводим верхнее колено, не проворачивая таз","Медленно возвращаем"]',
 '["Прокрут таза назад","Резкие рывки","Малая амплитуда"]',
 3,'15 на сторону','2-1-2',30),

('band-monster-walk','Ходьба «монстра» с резинкой','activation','{"ягодицы","бёдра"}','{"band"}','beginner','{"home"}',
 'Разогревает и включает ягодицы перед приседами и выпадами.',
 '["Резинка над коленями или на щиколотках","Полуприсед, спина прямая","Шаг в сторону, сохраняя натяжение резинки","Стопы не сводим"]',
 '["Заваленные внутрь колени","Разгибание корпуса при шаге"]',
 3,'10 шагов в каждую сторону','1-0-1',30),

('dead-bug','Dead Bug','core','{"кор","поперечная мышца живота"}','{"mat"}','beginner','{"rehab","low_impact"}',
 'Учит держать нейтральную поясницу при движении конечностей — фундамент стабильности.',
 '["Спина прижата к полу, поясница без просвета","На выдохе опускаем противоположные руку и ногу","Ребра не раскрываются","Дыхание ровное, движение медленное"]',
 '["Прогиб поясницы","Слишком быстрая работа","Задержка дыхания"]',
 3,'8 на сторону','3-1-3',45),

('bird-dog','Bird Dog','core','{"кор","поясница","ягодицы"}','{"mat"}','beginner','{"rehab"}',
 'Развивает диагональную стабилизацию корпуса — ключ к здоровой пояснице.',
 '["Ладони под плечами, колени под тазом","Вытягиваем противоположные руку и ногу параллельно полу","Таз ровный, не заваливаем","Пауза 1 сек в верхней точке"]',
 '["Поворот таза","Прогиб в пояснице","Скорость вместо контроля"]',
 3,'8 на сторону','2-1-2',45),

('plank','Планка на локтях','core','{"кор","плечи"}','{"mat"}','beginner','{"home"}',
 'База изометрии кора. Работают глубокие стабилизаторы позвоночника.',
 '["Локти под плечами, предплечья параллельны","Ягодицы поджаты, живот втянут","Пятки, таз и плечи — на одной линии","Дыхание ровное"]',
 '["Провал таза","Задранная голова","Задержка дыхания"]',
 3,'30-45 сек','iso',45),

('side-plank','Боковая планка','core','{"косые","квадратная поясничная"}','{"mat"}','beginner','{"rehab"}',
 'Укрепляет боковой пресс и квадратную мышцу поясницы — стабильность таза.',
 '["Локоть под плечом, стопы одна на другой","Таз тянем вверх, тело — прямая линия","Ягодицы включены","Дыхание не задерживаем"]',
 '["Провал таза","Скручивание вперёд"]',
 3,'20-30 сек','iso',45),

('hollow-hold','Hollow Hold','core','{"прямая мышца живота"}','{"mat"}','intermediate','{}',
 'Изометрия для глубокого пресса, готовит корпус к силовой работе.',
 '["Поясница вжата в пол","Плечи и стопы приподняты","Рёбра прижаты, нет прогиба","Дыхание в нижние ребра"]',
 '["Прогиб поясницы","Задержка дыхания"]',
 3,'20 сек','iso',45),

-- LOWER BODY STRENGTH
('goblet-squat','Гоблет-присед','strength_lower','{"квадрицепс","ягодицы"}','{"dumbbell"}','beginner','{}',
 'Учит паттерну приседа с вертикальным корпусом. Отличный вариант для начинающих и после травм.',
 '["Гантель у груди, локти вниз","Стопы чуть шире плеч, носки слегка врозь","Таз назад, колени по линии стоп","Опускаемся до параллели или ниже, если хватает мобильности"]',
 '["Колени внутрь","Округление поясницы","Пятки отрываются"]',
 4,'10-12','3-1-1',75),

('bodyweight-squat','Присед без веса','strength_lower','{"квадрицепс","ягодицы"}','{}','beginner','{"home","rehab"}',
 'Разминочный/технический присед. База для отработки паттерна.',
 '["Стопы чуть шире плеч","Таз назад, грудь развёрнута","Колени в сторону носков","Пятки прижаты"]',
 '["Заваленные колени","Отрыв пятки","Округление поясницы"]',
 3,'15','2-1-2',45),

('romanian-deadlift-db','Румынская тяга с гантелями','strength_lower','{"задняя поверхность","ягодицы","поясница"}','{"dumbbell"}','intermediate','{}',
 'Учит шарниру бедра, укрепляет заднюю цепь. Ключевое движение для тонуса и здоровой поясницы.',
 '["Гантели у бедер, лопатки собраны","Колени мягко согнуты, таз уходит назад","Спина нейтральная, штанга/гантели скользят по бёдрам","Вниз — до лёгкого натяжения задней поверхности, затем через ягодицы вверх"]',
 '["Округление поясницы","Присед вместо шарнира","Гантели далеко от бёдер"]',
 4,'10','3-1-1',75),

('split-squat','Болгарский сплит-присед','strength_lower','{"квадрицепс","ягодицы"}','{"dumbbell","bench"}','intermediate','{}',
 'Односторонний присед — исправляет дисбалансы, развивает ягодицы и стабильность.',
 '["Задняя нога на возвышении, стопа расслаблена","Опускаем таз строго вниз, колено передней ноги над стопой","Корпус чуть наклонён вперёд","Толчок через пятку передней ноги"]',
 '["Заваленное вперёд колено","Скачок таза","Раскачка корпусом"]',
 3,'10 на сторону','3-1-1',60),

('reverse-lunge','Обратный выпад','strength_lower','{"квадрицепс","ягодицы"}','{"dumbbell"}','beginner','{"home","rehab"}',
 'Мягкий выпад с меньшей нагрузкой на колено, чем классический — идеален для восстановления.',
 '["Шаг назад, опускаем колено к полу","Колено передней ноги над стопой","Толчок через пятку передней ноги","Корпус вертикален"]',
 '["Колено внутрь","Слишком короткий шаг","Раскачка"]',
 3,'10 на сторону','2-1-1',60),

('hip-thrust','Ягодичный мост со штангой/гантелей','strength_lower','{"ягодицы"}','{"bench","dumbbell"}','intermediate','{}',
 'Максимальная нагрузка на ягодицы. Ключ к красивой форме и здоровой пояснице.',
 '["Лопатки на скамье, стопы под коленями","Выжимаем таз вверх до линии плечи-таз-колени","Ребра прижаты, нейтральная шея","Пик — сжатие 1-2 сек"]',
 '["Гиперразгибание в пояснице","Заваленные колени","Слишком далёкие стопы"]',
 4,'10-12','3-1-2',75),

('step-up','Зашагивание на возвышение','strength_lower','{"ягодицы","квадрицепс"}','{"bench","dumbbell"}','beginner','{"rehab"}',
 'Функциональное упражнение — прорабатывает ягодицы и учит контролировать движение одной ноги.',
 '["Стопа полностью на возвышении, высота — до колена","Выпрямляемся через пятку, вторую ногу поднимаем в колене","Опускаемся медленно, контролируя таз","Корпус ровный"]',
 '["Толчок задней ногой","Заваленное колено","Ускорение вниз"]',
 3,'10 на сторону','2-1-2',60),

('calf-raise','Подъём на носки','strength_lower','{"икры"}','{}','beginner','{"home"}',
 'Укрепляет икроножные и стопу. Важно для устойчивости и здоровья ахилла.',
 '["Стоя, опора для баланса","Поднимаемся на носки максимально высоко","Пауза 1 сек в верхней точке","Медленно опускаемся"]',
 '["Быстрый темп","Заваленный внутрь свод стопы"]',
 3,'15-20','2-1-2',45),

-- UPPER BODY STRENGTH
('pushup','Отжимание','strength_upper','{"грудные","трицепс","плечи"}','{"mat"}','beginner','{"home"}',
 'База для верха: работает грудь, трицепс, плечи и глубокая стабилизация корпуса.',
 '["Ладони под плечами, тело — прямая линия","Локти под углом ~45° к корпусу","Опускаемся до касания грудью, локти движутся к рёбрам","Ягодицы поджаты"]',
 '["Провал таза","Развернутые в стороны локти","Опущенная голова"]',
 3,'8-12','2-1-2',60),

('knee-pushup','Отжимание с колен','strength_upper','{"грудные","трицепс"}','{"mat"}','beginner','{"home","rehab"}',
 'Регрессия классического отжимания — учит паттерну без перегрузки плеч.',
 '["Опора на колени и ладони, тело — прямая линия от колен до макушки","Локти под 45°","Опускаемся до касания грудью, толкаемся"]',
 '["Провал в пояснице","Локти в стороны"]',
 3,'10-12','2-1-2',45),

('db-bench-press','Жим гантелей лёжа','strength_upper','{"грудные","трицепс","плечи"}','{"dumbbell","bench"}','intermediate','{}',
 'Классика для верха. Гантели дают больше амплитуды и щадят плечи.',
 '["Лопатки сведены и опущены","Гантели на уровне груди, локти под 45°","Жмём вверх без сведения гантелей друг о друга","Стопы прижаты к полу"]',
 '["Отрыв поясницы","Разлёт локтей","Отбив гантелей от груди"]',
 4,'10','2-1-1',75),

('db-row','Тяга гантели в наклоне','strength_upper','{"широчайшие","средняя часть спины"}','{"dumbbell","bench"}','beginner','{}',
 'База для спины. Учит правильно вести локоть и сводить лопатку.',
 '["Одна рука и одноимённое колено на скамье","Спина параллельно полу, нейтральная","Тяга локтем вдоль корпуса к бедру","Пик — сжатие лопатки"]',
 '["Работа рукой вместо спины","Скручивание корпуса","Рывок"]',
 4,'10 на сторону','2-1-2',60),

('band-row','Тяга в наклоне с резинкой','strength_upper','{"спина","задние дельты"}','{"band"}','beginner','{"home","rehab"}',
 'Домашний аналог тяги. Развивает мышцы спины и укрепляет позу.',
 '["Резинка под стопами, спина параллельно полу","Тяга локтями назад, сводя лопатки","Медленный возврат"]',
 '["Раскачка корпусом","Тяга плечами"]',
 3,'12-15','2-1-2',45),

('db-shoulder-press','Жим гантелей стоя','strength_upper','{"плечи","трицепс"}','{"dumbbell"}','intermediate','{}',
 'Развивает плечи и стабильность корпуса.',
 '["Гантели на уровне плеч, ладони вперёд","Ягодицы и пресс собраны","Жмём вверх, не разгибая до замка","Ребра прижаты"]',
 '["Прогиб поясницы","Разлёт локтей вперёд","Задержка дыхания"]',
 3,'10','2-1-1',60),

('face-pull','Face Pull с резинкой','strength_upper','{"задние дельты","ромбовидные"}','{"band"}','beginner','{"rehab","home"}',
 'Мощная профилактика сутулости и болей в плечах.',
 '["Резинка на уровне лица, хват сверху","Локти в стороны выше запястий","Тянем к лицу, разворачивая кисти наружу","Сводим лопатки в пике"]',
 '["Тянем локти вниз","Работа шеей"]',
 3,'15','2-1-2',45),

('lat-pulldown-band','Тяга сверху с резинкой','strength_upper','{"широчайшие"}','{"band"}','beginner','{"home"}',
 'Развивает широчайшие и укрепляет верх спины.',
 '["Резинка над головой, хват шире плеч","Тянем к ключицам, локти вниз и назад","Корпус слегка отклонён","Медленный возврат"]',
 '["Тяга бицепсами","Сутулость"]',
 3,'12-15','2-1-2',45),

('band-pull-apart','Разведение с резинкой перед собой','strength_upper','{"задние дельты","ромбовидные"}','{"band"}','beginner','{"rehab","home"}',
 'Ежедневная профилактика сутулости и укрепление верха спины.',
 '["Резинка на прямых руках перед собой на уровне груди","Разводим руки в стороны, сводя лопатки","Медленный возврат"]',
 '["Сгибание рук","Прогиб поясницы"]',
 3,'15','2-0-2',30),

('triceps-pushdown-band','Разгибание рук с резинкой','strength_upper','{"трицепс"}','{"band"}','beginner','{"home"}',
 'Изолирует трицепс, поддерживает форму рук.',
 '["Резинка закреплена сверху","Локти прижаты к корпусу","Разгибаем предплечья вниз до полного выпрямления","Возврат под контролем"]',
 '["Отведение локтей вперёд","Раскачка"]',
 3,'12-15','2-1-2',45),

('db-biceps-curl','Сгибание рук с гантелями','strength_upper','{"бицепс"}','{"dumbbell"}','beginner','{}',
 'Классика для бицепса. Работает без раскачки корпусом.',
 '["Гантели в опущенных руках, ладонями вперёд","Сгибаем к плечам, локти зафиксированы","Медленный опуск под контролем"]',
 '["Раскачка","Вывод локтей вперёд"]',
 3,'10-12','2-1-2',45),

-- FULL BODY / CONDITIONING
('kb-swing','Махи гирей','strength_full','{"ягодицы","задняя цепь","кор"}','{"kettlebell"}','intermediate','{}',
 'Мощное движение для задней цепи и жиросжигания.',
 '["Гиря между стоп, шарнир бедрами","Резкий толчок тазом вперёд","Руки — «стропы», гиря взлетает до груди","Спина нейтральна"]',
 '["Присед вместо шарнира","Работа руками"]',
 4,'15','1-0-1',60),

('walking-lunge','Выпады в движении','strength_full','{"ягодицы","квадрицепс"}','{"dumbbell"}','intermediate','{}',
 'Функциональное движение — ягодицы, стабильность и лёгкое кардио.',
 '["Шаг вперёд, опускаем заднее колено близко к полу","Толкаемся через пятку передней ноги","Корпус вертикален"]',
 '["Малый шаг","Заваленное колено"]',
 3,'12 шагов','2-0-1',60),

('mountain-climber','Скалолаз','cardio','{"кор","бёдра"}','{"mat"}','beginner','{"home"}',
 'Кардиоусилитель, включает кор и повышает пульс.',
 '["Позиция планки, плечи над ладонями","По очереди подводим колени к груди","Таз не подпрыгивает","Ритм ровный"]',
 '["Подскок таза","Провал плеч"]',
 3,'30-40 сек','iso',45),

('jumping-jack','Прыжковые «джампинг-джек»','cardio','{"общая нагрузка"}','{}','beginner','{"home"}',
 'Разогрев и лёгкое кардио.',
 '["Прыжком разводим ноги, руки вверх","Возврат в исходное","Мягкое приземление на носки"]',
 '["Жёсткое приземление","Сутулость"]',
 3,'40 сек','iso',30),

('low-jack','«Джек» без прыжка','cardio','{"общая нагрузка"}','{}','beginner','{"home","low_impact","rehab"}',
 'Мягкий вариант для колен и спины: без ударных нагрузок.',
 '["Шаг в сторону, руки вверх","Возврат, другая нога — в сторону","Плавные движения"]',
 '["Раскачка корпусом"]',
 3,'40 сек','iso',30),

('russian-twist','Русский твист','core','{"косые","пресс"}','{"dumbbell","mat"}','intermediate','{}',
 'Работа с косыми мышцами живота через ротацию.',
 '["Сидя, стопы приподняты (или на полу для регрессии)","Корпус отклонён, спина прямая","Поворот грудным отделом, руки идут вбок","Работает пресс, а не только руки"]',
 '["Округление поясницы","Скорость вместо контроля"]',
 3,'20 (10 на сторону)','2-0-2',45),

-- COOLDOWN / STRETCH
('childs-pose','Поза ребёнка','cooldown','{"поясница","бёдра"}','{"mat"}','beginner','{"home","rehab"}',
 'Восстановительная растяжка поясницы и таза.',
 '["Колени врозь, стопы вместе","Таз на пятки, руки вытянуты вперёд","Дыхание глубокое, расслабленное"]',
 '["Напряжённая шея","Отрыв таза"]',
 1,'60 сек','iso',0),

('couch-stretch','Растяжка сгибателей бедра у стены','cooldown','{"сгибатели бедра","квадрицепс"}','{"mat"}','beginner','{"rehab"}',
 'Раскрывает передние поверхности бедра — важно для сидячего образа жизни.',
 '["Заднее колено у стены, стопа на стене","Корпус вертикально, ягодицы поджаты","Держим 30-45 сек, ровное дыхание"]',
 '["Прогиб в пояснице","Терпеть боль"]',
 1,'40 сек на сторону','iso',0),

('pigeon','Голубь','cooldown','{"ягодицы","средняя ягодичная"}','{"mat"}','beginner','{"rehab"}',
 'Растяжка ягодичной и грушевидной — снимает напряжение таза.',
 '["Передняя нога согнута перед собой, голень поперёк коврика","Задняя нога прямая, таз опускается к полу","Корпус наклоняем вперёд по ощущениям"]',
 '["Заваленный на бок таз","Форсирование через боль"]',
 1,'45 сек на сторону','iso',0),

('cat-thoracic','Мобилизация грудного отдела на коленях','cooldown','{"грудной отдел"}','{"mat"}','beginner','{"mobility"}',
 'Раскрывает грудной отдел и снимает напряжение с шеи и плеч.',
 '["Ягодицы к пяткам, одну руку продеваем под другую","На вдохе тянем верхнюю руку вверх, разворачивая грудь","Взгляд за рукой"]',
 '["Ротация в пояснице","Задержка дыхания"]',
 2,'8 на сторону','3-0-3',30),

('hamstring-stretch','Растяжка задней поверхности бедра','cooldown','{"задняя поверхность"}','{"mat"}','beginner','{"home"}',
 'Мягкая растяжка после силовой нагрузки на ноги.',
 '["Лёжа на спине, одну ногу тянем к себе","Колено чуть согнуто","Тянем стопу на себя, чтобы включить голень","Дыхание ровное"]',
 '["Круглая поясница","Форсирование до боли"]',
 1,'40 сек на сторону','iso',0),

('quad-stretch','Растяжка квадрицепса стоя','cooldown','{"квадрицепс"}','{}','beginner','{"home"}',
 'Быстрая растяжка передней поверхности бедра.',
 '["Одной рукой держимся за опору","Другой — стопу к ягодице","Колени рядом, таз чуть подкручен вперёд"]',
 '["Уводить колено в сторону","Прогиб в пояснице"]',
 1,'30 сек на сторону','iso',0);
