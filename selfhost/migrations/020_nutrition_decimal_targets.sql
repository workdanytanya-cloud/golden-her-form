-- Decimal KBJU targets (e.g. fat 49.5 / carbs 221.2). Integer truncation broke publish validation.
ALTER TABLE public.nutrition_plans
  ALTER COLUMN target_kcal TYPE numeric(10,2) USING target_kcal::numeric,
  ALTER COLUMN target_protein_g TYPE numeric(10,2) USING target_protein_g::numeric,
  ALTER COLUMN target_fat_g TYPE numeric(10,2) USING target_fat_g::numeric,
  ALTER COLUMN target_carbs_g TYPE numeric(10,2) USING target_carbs_g::numeric;
