-- Public read for exercise videos in media bucket (playback without auth cookie).
-- Signed URLs still work; public URLs are more reliable in <video>.

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "media public read exercises videos" ON storage.objects;
CREATE POLICY "media public read exercises videos"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'media'
    AND (name LIKE 'exercises/videos/%' OR name LIKE 'exercises/gifs/%')
  );
