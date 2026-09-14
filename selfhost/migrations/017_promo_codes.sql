-- One-time promo codes (cash payment → enrollment / questionnaire).
-- Semantics mirror cloud: unused | used | revoked; optional expires_at.

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  code text NOT NULL,
  label text,
  program_slug text,
  program_title text,
  status text NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'used', 'revoked')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  expires_at timestamptz,
  notes text,
  CONSTRAINT promo_codes_code_unique UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS promo_codes_status_idx ON public.promo_codes (status);
CREATE INDEX IF NOT EXISTS promo_codes_created_idx ON public.promo_codes (created_at DESC);

CREATE OR REPLACE FUNCTION public.normalize_promo_code(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(trim(raw), '\s+', '', 'g'));
$$;
