-- Seed: продукты конструктора (USDA + placeholders для этикеток)
-- Выполнить после 20260830120000_nutrition_constructor.sql
-- Рецепты и связи: npm run nutrition:apply-seed

INSERT INTO public.food_products (slug, name, category, brand, state, measurement_basis, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, fiber_per_100g, density, source_name, is_verified, allowed_for_snack, requires_cooking, weighing_note)
VALUES
  ('buckwheat-dry', 'Гречка', 'grain', NULL, 'raw_dry', 'per_100g_dry', 343, 13.25, 3.4, 71.5, 10, NULL, 'USDA FDC 20008', true, false, true, 'Взвешивать сухой крупой.'),
  ('rice-white-dry', 'Рис', 'grain', NULL, 'raw_dry', 'per_100g_dry', 365, 7.13, 0.66, 79.95, 1.3, NULL, 'USDA FDC 20047', true, false, true, 'Взвешивать сухой крупой.'),
  ('oats-dry', 'Овсянка', 'grain', NULL, 'raw_dry', 'per_100g_dry', 389, 16.89, 6.9, 66.27, 10.6, NULL, 'USDA FDC 20038', true, false, true, 'Взвешивать сухими хлопьями.'),
  ('cucumber', 'Огурцы', 'vegetable', NULL, 'raw', 'per_100g_edible', 15, 0.65, 0.11, 3.63, 0.5, NULL, 'USDA FDC 168409', true, true, false, 'Съедобная часть, сырая.'),
  ('tomato', 'Помидоры', 'vegetable', NULL, 'raw', 'per_100g_edible', 18, 0.88, 0.2, 3.89, 1.2, NULL, 'USDA FDC 170457', true, true, false, 'Съедобная часть, сырые.'),
  ('bell-pepper', 'Перец', 'vegetable', NULL, 'raw', 'per_100g_edible', 31, 0.99, 0.3, 6.03, 2.1, NULL, 'USDA FDC 170427', true, true, false, 'Съедобная часть без семян.'),
  ('napa-cabbage', 'Пекинская капуста', 'vegetable', NULL, 'raw', 'per_100g_edible', 16, 1.2, 0.2, 3.23, 1.2, NULL, 'USDA FDC 169975', true, true, false, 'Съедобная часть, сырая.'),
  ('white-cabbage', 'Белокочанная капуста', 'vegetable', NULL, 'raw', 'per_100g_edible', 25, 1.28, 0.1, 5.8, 2.5, NULL, 'USDA FDC 169975', true, true, false, 'Съедобная часть, сырая.'),
  ('zucchini', 'Кабачки', 'vegetable', NULL, 'raw', 'per_100g_edible', 17, 1.21, 0.32, 3.11, 1, NULL, 'USDA FDC 168565', true, false, true, 'Съедобная часть, сырой.'),
  ('eggplant', 'Баклажаны', 'vegetable', NULL, 'raw', 'per_100g_edible', 25, 0.98, 0.18, 5.88, 3, NULL, 'USDA FDC 169246', true, false, true, 'Съедобная часть, сырой.'),
  ('carrot', 'Морковь', 'vegetable', NULL, 'raw', 'per_100g_edible', 41, 0.93, 0.24, 9.58, 2.8, NULL, 'USDA FDC 170393', true, true, false, 'Съедобная часть, сырая.'),
  ('avocado', 'Авокадо', 'vegetable', NULL, 'raw', 'per_100g_edible', 160, 2, 14.66, 8.53, 6.7, NULL, 'USDA FDC 171705', true, true, false, 'Мякоть без косточки.'),
  ('apple', 'Яблоко', 'fruit', NULL, 'raw', 'per_100g_edible', 52, 0.26, 0.17, 13.81, 2.4, NULL, 'USDA FDC 171688', true, true, false, 'Съедобная часть без сердцевины.'),
  ('banana', 'Банан', 'fruit', NULL, 'raw', 'per_100g_edible', 89, 1.09, 0.33, 22.84, 2.6, NULL, 'USDA FDC 173944', true, true, false, 'Мякоть без кожуры.'),
  ('cherry', 'Вишня', 'fruit', NULL, 'raw', 'per_100g_edible', 50, 1, 0.3, 12.18, 1.6, NULL, 'USDA FDC 171719', true, true, false, 'Без косточек.'),
  ('lemon', 'Лимон', 'fruit', NULL, 'raw', 'per_100g_edible', 29, 1.1, 0.3, 9.32, 2.8, NULL, 'USDA FDC 167746', true, true, false, 'Съедобная часть.'),
  ('chicken-breast-raw', 'Курица', 'meat', NULL, 'raw', 'per_100g_raw', 120, 22.5, 2.62, 0, 0, NULL, 'USDA FDC 171477', true, false, true, 'Филе, сырое, до приготовления.'),
  ('beef-lean-raw', 'Говядина', 'meat', NULL, 'raw', 'per_100g_raw', 250, 26, 15, 0, 0, NULL, 'USDA FDC 174032', true, false, true, 'Постная часть, сырая, до приготовления.'),
  ('pollock-raw', 'Минтай', 'fish', NULL, 'raw', 'per_100g_raw', 72, 15.9, 0.9, 0, 0, NULL, 'USDA FDC 175130', true, false, true, 'Филе, сырое, до приготовления.'),
  ('egg-whole', 'Яйца', 'dairy', NULL, 'raw', 'per_100g_edible', 143, 12.56, 9.51, 0.72, 0, NULL, 'USDA FDC 171287', true, false, true, 'Съедобная часть (~50 г на 1 яйцо С1).'),
  ('walnut', 'Грецкий орех', 'nut_seed', NULL, 'raw', 'per_100g_edible', 654, 15.23, 65.21, 13.71, 6.7, NULL, 'USDA FDC 170187', true, true, false, 'Очищенные ядра.'),
  ('almond', 'Миндаль', 'nut_seed', NULL, 'raw', 'per_100g_edible', 579, 21.15, 49.93, 21.55, 12.5, NULL, 'USDA FDC 170567', true, true, false, 'Очищенные ядра.'),
  ('pumpkin-seeds', 'Семечки тыквы', 'nut_seed', NULL, 'raw', 'per_100g_edible', 559, 30.23, 49.05, 10.71, 6, NULL, 'USDA FDC 170556', true, true, false, 'Очищенные семечки.'),
  ('stevia-candy', 'Конфеты со стевией', 'sweet', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'По этикетке упаковки.'),
  ('marshmallow', 'Зефир', 'sweet', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'По этикетке упаковки.'),
  ('dried-mango', 'Манго сушёное', 'sweet', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'По этикетке упаковки.'),
  ('hard-cheese', 'Сыр твёрдый', 'dairy', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'По этикетке упаковки.'),
  ('lactose-free-milk', 'Молоко без лактозы', 'dairy', 'уточнить', 'liquid', 'per_100g', 0, 0, 0, 0, 0, 1.03, 'Этикетка упаковки', false, true, false, 'В граммах или мл по плотности на этикетке.'),
  ('canned-tuna', 'Тунец', 'canned', 'уточнить', 'canned_drained', 'per_100g_drained', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, false, false, 'Без жидкости из банки.'),
  ('canned-corn', 'Кукуруза консервированная', 'canned', 'уточнить', 'canned_drained', 'per_100g_drained', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'Без жидкости из банки.'),
  ('crispbread', 'Хлебцы', 'bakery', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, true, false, 'По этикетке упаковки.'),
  ('lavash', 'Лаваш', 'bakery', 'уточнить', 'ready', 'per_100g_pack', 0, 0, 0, 0, 0, NULL, 'Этикетка упаковки', false, false, false, 'По этикетке упаковки.')
ON CONFLICT (slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';
