import { useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

type Notification = {
  id: string;
  type: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

export function ClientNotificationsBell() {
  const { user } = useAuth();
  const userId = user?.id;
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    void supabase
      .from("client_notifications")
      .select("id, type, message, link, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (!mounted || error || !data) return;
        setItems(data as Notification[]);
      });

    const channelName = `client_notifications_${userId}_${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "client_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => [n, ...prev].slice(0, 30));
          toast.success(n.message);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    if (unread === 0 || !userId) return;
    const ids = items.filter((n) => !n.is_read).map((n) => n.id);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase
      .from("client_notifications")
      .update({ is_read: true })
      .in("id", ids);
  };

  const removeOne = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("client_notifications").delete().eq("id", id);
  };

  if (!userId) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full border border-gold/25 p-2 text-ivory hover:bg-gold/10"
        aria-label="Уведомления"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold text-background">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-gold/20 bg-surface/95 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
            <div className="text-sm font-medium text-ivory">Уведомления</div>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="inline-flex items-center gap-1 rounded-full border border-gold/20 px-2 py-1 text-[10px] uppercase tracking-widest text-warm-gray hover:bg-gold/10 disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Прочитать все
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-warm-gray">Пока пусто</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-2 border-b border-gold/5 px-4 py-3 last:border-0 ${
                    n.is_read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ivory">
                      {n.link ? (
                        <Link
                          to={n.link}
                          onClick={() => setOpen(false)}
                          className="hover:text-gold"
                        >
                          {n.message}
                        </Link>
                      ) : (
                        n.message
                      )}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-warm-gray">
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => removeOne(n.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-warm-gray hover:text-coral" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
