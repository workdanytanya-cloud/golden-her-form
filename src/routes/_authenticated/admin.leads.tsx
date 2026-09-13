import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { adminUpdateLeadStatus } from "@/lib/leads.functions";
import { toast } from "sonner";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  component: AdminLeadsPage,
});

type Lead = {
  id: string;
  created_at: string;
  full_name: string;
  age: number;
  phone: string;
  email: string;
  messenger: string;
  source: string;
  program_title: string | null;
  status: string;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  new: "Новая",
  contacted: "На связи",
  converted: "Стала клиентом",
  archived: "В архиве",
};

const MESSENGER_LABEL: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  any: "Любой",
};

function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "new" | "contacted" | "converted" | "archived">("all");
  const updateStatus = useServerFn(adminUpdateLeadStatus);

  const load = async () => {
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, created_at, full_name, age, phone, email, messenger, source, program_title, status, notes",
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setLeads((data as Lead[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return leads;
    return leads.filter((l) => l.status === filter);
  }, [leads, filter]);

  const newCount = leads.filter((l) => l.status === "new").length;

  const setStatus = async (id: string, status: Lead["status"]) => {
    try {
      await updateStatus({ data: { id, status } });
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
      toast.success("Статус обновлён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Админ-панель"
        title="Заявки"
        description="Заявки с сайта — отдельно от зарегистрированных клиентов. После оплаты/доступа отметьте «Стала клиентом»."
        action={
          <Link
            to="/admin"
            className="rounded-full border border-gold/30 px-4 py-2 text-sm text-ivory hover:border-gold"
          >
            К клиентам →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Всего заявок" value={String(leads.length)} tone="gold" />
        <StatCard label="Новые" value={String(newCount)} tone="coral" />
        <StatCard
          label="Конверсия"
          value={
            leads.length
              ? `${Math.round((leads.filter((l) => l.status === "converted").length / leads.length) * 100)}%`
              : "—"
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Все"],
            ["new", "Новые"],
            ["contacted", "На связи"],
            ["converted", "Клиенты"],
            ["archived", "Архив"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={[
              "rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors",
              filter === k
                ? "bg-coral text-white"
                : "border border-gold/20 text-warm-gray hover:text-ivory",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-warm-gray">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-gold/15 bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-gold/50" />
          <p className="mt-4 text-warm-gray">Заявок пока нет.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-gold/15">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-gold/15 bg-surface/60 text-[11px] uppercase tracking-wider text-warm-gray">
              <tr>
                <th className="px-4 py-3 font-medium">Дата</th>
                <th className="px-4 py-3 font-medium">Имя / возраст</th>
                <th className="px-4 py-3 font-medium">Контакты</th>
                <th className="px-4 py-3 font-medium">Программа</th>
                <th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {filtered.map((l) => (
                <tr key={l.id} className="bg-background/20 hover:bg-surface/40">
                  <td className="whitespace-nowrap px-4 py-3 text-warm-gray">
                    {new Date(l.created_at).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ivory">{l.full_name}</div>
                    <div className="text-xs text-warm-gray">{l.age} лет</div>
                  </td>
                  <td className="px-4 py-3">
                    <a href={`tel:${l.phone}`} className="block text-ivory hover:text-gold">
                      {l.phone}
                    </a>
                    <a href={`mailto:${l.email}`} className="block text-xs text-warm-gray hover:text-gold">
                      {l.email}
                    </a>
                    <div className="mt-0.5 text-[11px] text-coral">
                      {MESSENGER_LABEL[l.messenger] ?? l.messenger}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-warm-gray">
                    {l.program_title || (l.source === "question" ? "Вопрос" : "Общая заявка")}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={l.status}
                      onChange={(e) => void setStatus(l.id, e.target.value)}
                      className="rounded-lg border border-gold/25 bg-background/50 px-2 py-1.5 text-xs text-ivory outline-none"
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
