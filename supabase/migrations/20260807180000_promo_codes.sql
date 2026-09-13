-- One-time promo codes (cash payment access)
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  code text NOT NULL,
  label text,
  program_slug text,
  program_title text,
  status text NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'used', 'revoked')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  expires_at timestamptz,
  notes text,
  CONSTRAINT promo_codes_code_unique UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS promo_codes_status_idx ON public.promo_codes (status);
CREATE INDEX IF NOT EXISTS promo_codes_created_idx ON public.promo_codes (created_at DESC);

-- Normalize code to uppercase without spaces
CREATE OR REPLACE FUNCTION public.normalize_promo_code(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(trim(raw), '\s+', '', 'g'));
$$;

GRANT SELECT ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view promo codes"
  ON public.promo_codes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert promo codes"
  ON public.promo_codes FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update promo codes"
  ON public.promo_codes FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Client may see only their own used code (optional, for profile)
CREATE POLICY "Users view own redeemed promo"
  ON public.promo_codes FOR SELECT TO authenticated
  USING (used_by = auth.uid());
