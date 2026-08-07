-- Enrollment unlock: registration/onboarding only after promo (or future payment)
ALTER TABLE public.client_access
  ADD COLUMN IF NOT EXISTS unlock_source text
  CHECK (unlock_source IS NULL OR unlock_source IN ('promo', 'payment'));

COMMENT ON COLUMN public.client_access.unlock_source IS
  'How the client unlocked registration/onboarding: promo | payment. Full course access still requires trainer grant (status=active).';

-- Existing clients who already progressed past onboarding are treated as unlocked by status.
-- Optionally backfill unlock for anyone who already redeemed a promo:
UPDATE public.client_access ca
SET unlock_source = 'promo'
FROM public.promo_codes pc
WHERE pc.used_by = ca.user_id
  AND pc.status = 'used'
  AND ca.unlock_source IS NULL;
