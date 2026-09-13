-- Будущая миграция self-hosted / локального PostgreSQL.
-- НЕ применять к production Supabase из этого репозитория автоматически.
-- Обратная совместимость: video_url и gif_url сохраняются.

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS video_provider text,
  ADD COLUMN IF NOT EXISTS video_embed_url text,
  ADD COLUMN IF NOT EXISTS video_title text,
  ADD COLUMN IF NOT EXISTS video_status text,
  ADD COLUMN IF NOT EXISTS video_fallback_text text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_video_provider_check'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_video_provider_check
      CHECK (video_provider IS NULL OR video_provider IN ('youtube', 'rutube', 'external', 'none'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_video_status_check'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_video_status_check
      CHECK (video_status IS NULL OR video_status IN ('ok', 'unavailable', 'unchecked'));
  END IF;
END $$;

COMMENT ON COLUMN public.exercises.video_url IS 'Каноническая https-ссылка (YouTube/Rutube/внешняя). Legacy-поле, не удалять.';
COMMENT ON COLUMN public.exercises.video_embed_url IS 'Разрешённый embed URL, считается на сервере. Не доверять клиенту.';
