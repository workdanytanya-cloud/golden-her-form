import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  emitSelfhostNotificationsChanged,
  SELFHOST_NOTIFICATIONS_EVENT,
  type SelfhostNotificationsChangedDetail,
} from "@/lib/selfhost/notifications-sync";

type Notification = {
  id: string;
  type: string;
  client_id: string;
  measurement_id: string | null;
  message: string;
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

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastFetchAt = useRef(0);

  const loadLocal = useCallback(async () => {
    const { selfhostAdminNotifications } = await import("@/lib/selfhost/client-api");
    const res = await selfhostAdminNotifications();
    setItems(
      (res.items as Notification[]).map((n) => ({
        ...n,
        client_id: n.client_id ?? "",
      })),
    );
    lastFetchAt.current = Date.now();
  }, []);

  const loadSupabase = useCallback(async () => {
    const { data, error } = await supabase
      .from("admin_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error && data) setItems(data as Notification[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { usesLocalPostgresCircuit } = await import("@/lib/selfhost/client-api");
      if (await usesLocalPostgresCircuit()) {
        if (cancelled) return;
        setLocalMode(true);
        try {
          await loadLocal();
        } catch (e) {
          if (!cancelled) toast.error(e instanceof Error ? e.message : "Не удалось загрузить уведомления");
        }
        return;
      }
      if (cancelled) return;
      setLocalMode(false);
      await loadSupabase();
      if (cancelled) return;
      const channelName = `admin_notifications_changes_${
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Date.now()
      }`;
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "admin_notifications" },
          (payload) => {
            const n = payload.new as Notification;
            setItems((prev) => [n, ...prev].slice(0, 30));
            toast.info("Новый замер клиента", { description: n.message });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadLocal, loadSupabase]);

  useEffect(() => {
    if (!localMode) return;
    const onFocusOrVisible = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAt.current < 15_000) return;
      void loadLocal().catch(() => undefined);
    };
    const onSync = (ev: Event) => {
      const detail = (ev as CustomEvent<SelfhostNotificationsChangedDetail>).detail;
      if (detail?.scope === "admin") void loadLocal().catch(() => undefined);
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    window.addEventListener(SELFHOST_NOTIFICATIONS_EVENT, onSync);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.removeEventListener(SELFHOST_NOTIFICATIONS_EVENT, onSync);
    };
  }, [localMode, loadLocal]);

  useEffect(() => {
    if (!open || !localMode) return;
    void loadLocal().catch(() => undefined);
  }, [open, localMode, loadLocal]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = items.filter((i) => !i.is_read).length;

  const markAllRead = async () => {
    if (unread === 0) return;
    try {
      if (localMode) {
        const { selfhostAdminMarkAllNotificationsRead } = await import("@/lib/selfhost/client-api");
        await selfhostAdminMarkAllNotificationsRead();
        setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
        emitSelfhostNotificationsChanged("admin");
        return;
      }
      const ids = items.filter((i) => !i.is_read).map((i) => i.id);
      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .in("id", ids);
      if (error) throw new Error(error.message);
      setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить");
    }
  };

  const markRead = async (id: string) => {
    try {
      if (localMode) {
        const { selfhostAdminMarkNotificationRead } = await import("@/lib/selfhost/client-api");
        await selfhostAdminMarkNotificationRead(id);
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
        emitSelfhostNotificationsChanged("admin");
        return;
      }
      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw new Error(error.message);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить");
    }
  };

  const remove = async (id: string) => {
    const prev = items;
    try {
      if (localMode) {
        const { selfhostAdminDeleteNotification } = await import("@/lib/selfhost/client-api");
        await selfhostAdminDeleteNotification(id);
        setItems((p) => p.filter((i) => i.id !== id));
        emitSelfhostNotificationsChanged("admin");
        return;
      }
      const { error } = await supabase.from("admin_notifications").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setItems((p) => p.filter((i) => i.id !== id));
    } catch (e) {
      setItems(prev);
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-gold/25 bg-background/40 text-ivory transition-colors hover:bg-gold/10"
        aria-label="Уведомления"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold text-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-gold/20 bg-surface/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
            <p className="font-display text-sm text-ivory">Уведомления</p>
            <button
              onClick={() => void markAllRead()}
              disabled={unread === 0}
              className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-gold transition-colors hover:text-ivory disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Прочитать все
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-warm-gray">Пока нет уведомлений</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={[
                    "group flex items-start gap-3 border-b border-gold/5 px-4 py-3 text-sm last:border-b-0",
                    n.is_read ? "opacity-60" : "bg-gold/[0.04]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      n.is_read ? "bg-warm-gray/40" : "bg-coral",
                    ].join(" ")}
                  />
                  <div className="min-w-0 flex-1">
                    {n.client_id ? (
                      <Link
                        to="/admin/clients/$id"
                        params={{ id: n.client_id }}
                        onClick={() => {
                          void markRead(n.id);
                          setOpen(false);
                        }}
                        className="block text-ivory hover:text-gold"
                      >
                        {n.message}
                      </Link>
                    ) : (
                      <p className="text-ivory">{n.message}</p>
                    )}
                    <p className="mt-1 text-[11px] text-warm-gray">{timeAgo(n.created_at)}</p>
                  </div>
                  <button
                    onClick={() => void remove(n.id)}
                    className="opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
