-- CHECK grams > 0 for new meal_plan_item_ingredients rows.
-- Do NOT apply this file automatically. Do not run against production from this task.
--
-- Existing zero-gram rows (if any) are intentionally left in place.
-- This constraint is added as NOT VALID so historical rows are not rejected.
-- Cleanup of grams <= 0 is a separate explicit review step and is not included here.

ALTER TABLE public.meal_plan_item_ingredients
  DROP CONSTRAINT IF EXISTS meal_plan_item_ingredients_grams_positive;

ALTER TABLE public.meal_plan_item_ingredients
  ADD CONSTRAINT meal_plan_item_ingredients_grams_positive
  CHECK (grams > 0) NOT VALID;
