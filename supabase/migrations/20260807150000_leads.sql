-- Lead / application requests (заявки), separate from registered clients
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  age integer NOT NULL CHECK (age >= 14 AND age <= 100),
  phone text NOT NULL,
  email text NOT NULL,
  messenger text NOT NULL DEFAULT 'any'
    CHECK (messenger IN ('telegram', 'max', 'whatsapp', 'any')),
  source text NOT NULL DEFAULT 'general',
  program_slug text,
  program_title text,
  message text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'converted', 'archived')),
  notes text
);

CREATE INDEX IF NOT EXISTS leads_created_idx ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads (status);

GRANT SELECT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view leads"
  ON public.leads FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update leads"
  ON public.leads FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete leads"
  ON public.leads FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- No public INSERT: only server (service_role) via submitLead

CREATE OR REPLACE FUNCTION public.set_leads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_leads_updated_at();
