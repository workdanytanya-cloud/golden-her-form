-- Канонический каталог для новой генерации.
-- Не изменяет nutrition_plan_versions, content_hash, assignments, users, sessions.

CREATE TABLE IF NOT EXISTS public.recipe_canonical_map (
  archived_slug text PRIMARY KEY,
  canonical_slug text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

INSERT INTO public.recipe_canonical_map (archived_slug, canonical_slug, reason)
VALUES (
  'omelette-tomato-pepper-cheese',
  'omelette-tomato-pepper',
  'Тот же состав без сыра: сыр в шагах не подтверждён продуктом'
)
ON CONFLICT (archived_slug) DO UPDATE
SET canonical_slug = EXCLUDED.canonical_slug,
    reason = EXCLUDED.reason;

UPDATE public.food_products
SET is_active_for_autogeneration = false,
    updated_at = (now() AT TIME ZONE 'utc')
WHERE is_verified = false
  AND is_active_for_autogeneration = true;

UPDATE public.recipes
SET is_active = false,
    updated_at = (now() AT TIME ZONE 'utc')
WHERE slug = 'omelette-tomato-pepper-cheese'
  AND is_active = true;

UPDATE public.food_products AS p
SET name = v.name,
    updated_at = (now() AT TIME ZONE 'utc')
FROM (VALUES
  ('buckwheat-dry', 'Гречка сухая'),
  ('rice-white-dry', 'Рис сухой'),
  ('oats-dry', 'Овсяные хлопья сухие'),
  ('bulgur-dry', 'Булгур сухой'),
  ('couscous-dry', 'Кускус сухой'),
  ('pearl-barley-dry', 'Перловка сухая'),
  ('lentils-dry', 'Чечевица сухая'),
  ('pasta-durum-dry', 'Макароны сухие'),
  ('potato-raw', 'Картофель сырой'),
  ('chicken-breast-raw', 'Филе куриной грудки'),
  ('beef-lean-raw', 'Говядина нежирная'),
  ('pollock-raw', 'Минтай, филе'),
  ('cod-raw', 'Треска, филе'),
  ('hake-raw', 'Хек, филе'),
  ('pink-salmon-raw', 'Горбуша, филе'),
  ('turkey-breast-raw', 'Филе индейки'),
  ('ground-turkey-raw', 'Фарш индейки'),
  ('egg-whole', 'Яйцо куриное'),
  ('egg-white-raw', 'Яичный белок'),
  ('cucumber', 'Огурец'),
  ('tomato', 'Помидор'),
  ('bell-pepper', 'Болгарский перец'),
  ('zucchini', 'Кабачок'),
  ('eggplant', 'Баклажан')
) AS v(slug, name)
WHERE p.slug = v.slug
  AND p.name IS DISTINCT FROM v.name;
