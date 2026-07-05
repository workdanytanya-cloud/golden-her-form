import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowRight, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminClients,
});

type Client = {
  id: string;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  created_at: string;
};

function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    void supabase
      .from("profiles")
      .select("id, full_name, phone, goal, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setClients((data ?? []) as Client[]);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(t) ||
        (c.phone ?? "").toLowerCase().includes(t) ||
        (c.goal ?? "").toLowerCase().includes(t),
    );
  }, [clients, q]);

  const newThisMonth = clients.filter((c) => {
    const d = new Date(c.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Админ-панель"
        title="Клиенты"
        description="Все зарегистрированные подопечные, их цели и контакты."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Всего клиентов" value={String(clients.length)} tone="gold" />
        <StatCard label="Новые за месяц" value={String(newThisMonth)} tone="coral" />
        <StatCard
          label="С заполненной целью"
          value={String(clients.filter((c) => c.goal && c.goal.trim()).length)}
        />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-gray" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по имени, телефону или цели"
          className="w-full rounded-full border border-gold/20 bg-surface/40 py-3 pl-11 pr-5 text-sm text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gold/15">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/50 text-[11px] uppercase tracking-widest text-warm-gray">
            <tr>
              <th className="px-5 py-3">Имя</th>
              <th className="px-5 py-3">Телефон</th>
              <th className="px-5 py-3">Цель</th>
              <th className="px-5 py-3">Регистрация</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-warm-gray">
                  Загрузка…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-warm-gray">
                  Ничего не найдено
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gold/5">
                  <td className="px-5 py-3 text-ivory">{c.full_name || "—"}</td>
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
