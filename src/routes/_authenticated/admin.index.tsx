import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowRight, Clock, Download, Search } from "lucide-react";
import { adminExportContacts } from "@/lib/admin-clients.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminClients,
});


type AccessStatus = "pending_onboarding" | "awaiting_approval" | "active" | "paused" | null;

type Client = {
  id: string;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  created_at: string;
  access_status: AccessStatus;
  onboarding_completed_at: string | null;
};

const STATUS_ORDER: Record<string, number> = {
  awaiting_approval: 0,
  pending_onboarding: 2,
  active: 3,
  paused: 4,
};

function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, phone, goal, created_at")
        .order("created_at", { ascending: false });
      const ids = (profiles ?? []).map((p) => p.id);
      const [accessRes, onbRes] = await Promise.all([
        supabase.from("client_access").select("user_id, status").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("onboarding_responses").select("user_id, completed_at").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ]);
      const accessMap = new Map<string, AccessStatus>(
        (accessRes.data ?? []).map((r) => [r.user_id, r.status as AccessStatus]),
      );
      const onbMap = new Map<string, string | null>(
        (onbRes.data ?? []).map((r) => [r.user_id, r.completed_at]),
      );
      const merged: Client[] = (profiles ?? []).map((p) => ({
        ...p,
        access_status: accessMap.get(p.id) ?? null,
        onboarding_completed_at: onbMap.get(p.id) ?? null,
      })) as Client[];
      setClients(merged);
      setLoading(false);
    })();
  }, []);

  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      const sa = STATUS_ORDER[a.access_status ?? "pending_onboarding"] ?? 5;
      const sb = STATUS_ORDER[b.access_status ?? "pending_onboarding"] ?? 5;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [clients]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return sorted;
    return sorted.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(t) ||
        (c.phone ?? "").toLowerCase().includes(t) ||
        (c.goal ?? "").toLowerCase().includes(t),
    );
  }, [sorted, q]);

  const awaiting = clients.filter((c) => c.access_status === "awaiting_approval");
  const active = clients.filter((c) => c.access_status === "active").length;
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
        description="Новые анкеты вверху. Проверьте, при желании отредактируйте черновики и откройте клиенту доступ."
        action={<ExportContactsButton />}
      />


      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Всего клиентов" value={String(clients.length)} tone="gold" />
        <StatCard label="Ждут проверки" value={String(awaiting.length)} tone="coral" />
        <StatCard label="Активные" value={String(active)} />
        <StatCard label="Новые за месяц" value={String(newThisMonth)} />
      </div>

      {awaiting.length > 0 && (
        <div className="rounded-3xl border border-coral/40 bg-gradient-to-br from-coral/10 to-gold/5 p-6">
          <div className="flex items-center gap-2 font-display text-xl text-ivory">
            <Clock className="h-5 w-5 text-coral" /> Новые анкеты — требуется проверка ({awaiting.length})
          </div>
          <p className="mt-1 text-sm text-warm-gray">
            Черновики программы и питания уже собраны на основе анкеты. Откройте карточку клиента, при необходимости отредактируйте, затем откройте доступ.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {awaiting.map((c) => (
              <li key={c.id}>
                <Link
                  to="/admin/clients/$id"
                  params={{ id: c.id }}
                  className="flex items-center justify-between rounded-2xl border border-gold/20 bg-background/40 px-4 py-3 hover:border-coral/50"
                >
                  <div>
                    <div className="font-display text-ivory">{c.full_name || "Клиент"}</div>
                    <div className="text-[11px] uppercase tracking-widest text-warm-gray">
                      Анкета:{" "}
                      {c.onboarding_completed_at
                        ? new Date(c.onboarding_completed_at).toLocaleDateString("ru-RU")
                        : "—"}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gold" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                    <StatusBadge status={c.access_status} />
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

function StatusBadge({ status }: { status: AccessStatus }) {
  const map: Record<string, { label: string; cls: string }> = {
    awaiting_approval: {
      label: "Ждёт проверки",
      cls: "border-coral/50 bg-coral/15 text-coral",
    },
    pending_onboarding: {
      label: "Анкета не заполнена",
      cls: "border-warm-gray/40 bg-warm-gray/10 text-warm-gray",
    },
    active: {
      label: "Активен",
      cls: "border-gold/40 bg-gold/10 text-gold",
    },
    paused: {
      label: "Приостановлен",
      cls: "border-warm-gray/40 bg-warm-gray/10 text-warm-gray",
    },
  };
  const s = map[status ?? "pending_onboarding"] ?? map.pending_onboarding;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] uppercase tracking-widest ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function ExportContactsButton() {
  const [busy, setBusy] = useState(false);
  const fetchContacts = useServerFn(adminExportContacts);

  const handleExport = async () => {
    setBusy(true);
    try {
      const { rows } = await fetchContacts();
      if (!rows.length) {
        toast.info("Нет данных для экспорта");
        return;
      }
      const escape = (v: string) => {
        const s = String(v ?? "");
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["Имя", "Телефон", "Email", "Дата регистрации"];
      const lines = [header.join(",")];
      for (const r of rows) {
        lines.push(
          [
            escape(r.full_name),
            escape(r.phone),
            escape(r.email),
            escape(new Date(r.created_at).toLocaleDateString("ru-RU")),
          ].join(","),
        );
      }
      // BOM for Excel UTF-8 compatibility
      const csv = "\ufeff" + lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `contacts_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Выгружено контактов: ${rows.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выгрузить контакты");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-background/40 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
    >
      <Download className="h-4 w-4 text-gold" />
      {busy ? "Готовим..." : "Выгрузить номера и почты"}
    </button>
  );
}
