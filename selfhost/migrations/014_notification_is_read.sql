-- Align selfhost notification tables with Supabase schema (is_read).
-- 012 created tables without is_read; dashboard overview queries require it.

ALTER TABLE public.client_notifications
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

ALTER TABLE public.admin_notifications
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS client_notifications_user_unread_idx
  ON public.client_notifications (user_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON public.admin_notifications (is_read)
  WHERE is_read = false;
