import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowRight, Search } from "lucide-react";
import {
  ACCESS_STATUS_LABEL,
  ACCESS_STATUS_TONE,
  isAccessStatus,
  type AccessStatus,
} from "@/lib/access";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminClients,
});

type Client = {
  id: string;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  created_at: string;
  status: AccessStatus;
};

const STATUS_FILTERS: { v: "all" | AccessStatus; l: string }[] = [
  { v: "all", l: "Все" },
  { v: "awaiting_approval", l: "Ждут подтверждения" },
  { v: "active", l: "Активные" },
  { v: "pending_onboarding", l: "Без анкеты" },
  { v: "paused", l: "На паузе" },
];

function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | AccessStatus>("all");

  useEffect(() => {
    void (async () => {
      const [{ data: profiles }, { data: access }, { data: roles }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, goal, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("client_access").select("user_id, status"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const statusMap = new Map<string, AccessStatus>();
      (access ?? []).forEach((r) => {
        const s = (r as { status?: string }).status;
        if (isAccessStatus(s)) statusMap.set((r as { user_id: string }).user_id, s);
      });
      const clientIds = new Set(
        (roles ?? [])
          .filter((r) => (r as { role?: string }).role === "client")
          .map((r) => (r as { user_id: string }).user_id),
      );
      const rows: Client[] = ((profiles ?? []) as Client[])
        .filter((p) => clientIds.has(p.id))
        .map((p) => ({ ...p, status: statusMap.get(p.id) ?? "pending_onboarding" }));
      setClients(rows);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!t) return true;
      return (
        (c.full_name ?? "").toLowerCase().includes(t) ||
        (c.phone ?? "").toLowerCase().includes(t) ||
        (c.goal ?? "").toLowerCase().includes(t)
      );
    });
  }, [clients, q, filter]);

  const newThisMonth = clients.filter((c) => {
    const d = new Date(c.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const awaiting = clients.filter((c) => c.status === "awaiting_approval").length;
  const active = clients.filter((c) => c.status === "active").length;

  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Админ-панель"
        title="Клиенты"
        description="Все зарегистрированные подопечные, их цели и статусы доступа."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Всего клиентов" value={String(clients.length)} tone="gold" />
        <StatCard label="Ждут подтверждения" value={String(awaiting)} tone="coral" />
        <StatCard label="Активных" value={String(active)} />
        <StatCard label="Новые за месяц" value={String(newThisMonth)} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по имени, телефону или цели"
            className="w-full rounded-full border border-gold/20 bg-surface/40 py-3 pl-11 pr-5 text-sm text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={[
                "rounded-full border px-4 py-1.5 text-xs uppercase tracking-widest transition-colors",
                filter === f.v
                  ? "border-gold/60 bg-gold/15 text-ivory"
                  : "border-gold/20 bg-background/30 text-warm-gray hover:border-gold/40 hover:text-ivory",
              ].join(" ")}
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gold/15">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/50 text-[11px] uppercase tracking-widest text-warm-gray">
            <tr>
              <th className="px-5 py-3">Имя</th>
              <th className="px-5 py-3">Статус</th>
              <th className="px-5 py-3">Телефон</th>
              <th className="px-5 py-3">Цель</th>
              <th className="px-5 py-3">Регистрация</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-warm-gray">
                  Загрузка…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-warm-gray">
                  Ничего не найдено
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gold/5">
                  <td className="px-5 py-3 text-ivory">{c.full_name || "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-widest ${ACCESS_STATUS_TONE[c.status]}`}
                    >
                      {ACCESS_STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-warm-gray">{c.phone || "—"}</td>
                  <td className="px-5 py-3 text-warm-gray">
                    <span className="line-clamp-1">{c.goal || "—"}</span>
                  </td>
                  <td className="px-5 py-3 text-warm-gray">
                    {new Date(c.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      to="/admin/clients/$id"
                      params={{ id: c.id }}
                      className="inline-flex items-center gap-1 text-sm text-gold hover:text-ivory"
                    >
                      Открыть <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
