
-- Add media columns to dishes
ALTER TABLE public.dishes 
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS video_url text;

-- Storage policies for 'media' bucket
CREATE POLICY "media authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'media');

CREATE POLICY "media admin insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "media admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'media' AND private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'media' AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "media admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'media' AND private.has_role(auth.uid(), 'admin'::app_role));
