-- Catalog metadata for variety-aware nutrition generation.
-- Idempotent: only ADD COLUMN IF NOT EXISTS / indexes. Does not touch published snapshots.

ALTER TABLE public.food_products
  ADD COLUMN IF NOT EXISTS lactose_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gluten_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vegetarian boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_tags text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS meal_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS variant_group text,
  ADD COLUMN IF NOT EXISTS ingredient_signature text,
  ADD COLUMN IF NOT EXISTS primary_protein text,
  ADD COLUMN IF NOT EXISTS primary_carb text,
  ADD COLUMN IF NOT EXISTS cooking_method text,
  ADD COLUMN IF NOT EXISTS storage_notes text,
  ADD COLUMN IF NOT EXISTS dietary_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS min_servings int,
  ADD COLUMN IF NOT EXISTS max_servings int;

CREATE INDEX IF NOT EXISTS recipes_variant_group_idx
  ON public.recipes (variant_group)
  WHERE variant_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS recipes_ingredient_signature_idx
  ON public.recipes (ingredient_signature)
  WHERE ingredient_signature IS NOT NULL;
