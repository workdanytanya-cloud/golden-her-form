import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import {
  adminCreatePromoCodes,
  adminListPromoCodes,
  adminRevokePromoCode,
} from "@/lib/promo.functions";
import { programs } from "@/lib/programs-data";
import { toast } from "sonner";
import { Ticket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/promos")({
  component: AdminPromosPage,
});

type Promo = {
  id: string;
  created_at: string;
  code: string;
  label: string | null;
  program_slug: string | null;
  program_title: string | null;
  status: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  unused: "Свободен",
  used: "Использован",
  revoked: "Отозван",
};

function AdminPromosPage() {
  const listFn = useServerFn(adminListPromoCodes);
  const createFn = useServerFn(adminCreatePromoCodes);
  const revokeFn = useServerFn(adminRevokePromoCode);

  const [items, setItems] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unused" | "used" | "revoked">("all");
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState("");
  const [programSlug, setProgramSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await listFn();
      setItems((res.items as Promo[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((p) => p.status === filter);
  }, [items, filter]);

  const unusedCount = items.filter((p) => p.status === "unused").length;

  const create = async () => {
    setCreating(true);
    try {
      const program = programs.find((p) => p.slug === programSlug);
      const res = await createFn({
        data: {
          count,
          label: label.trim() || null,
          program_slug: program?.slug ?? null,
          program_title: program?.title ?? null,
        },
      });
      const codes = (res.codes ?? []).map((c: { code: string }) => c.code);
      setLastCreated(codes);
      toast.success(
        codes.length === 1
          ? `Промокод создан: ${codes[0]}`
          : `Создано кодов: ${codes.length}`,
      );
      setLabel("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeFn({ data: { id } });
      toast.success("Промокод отозван");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Админ-панель"
        title="Промокоды"
        description="Одноразовые коды для клиентов, оплативших наличными. Клиент вводит код при входе — доступ в кабинет открывается сразу."
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
        <StatCard label="Всего" value={String(items.length)} tone="gold" />
        <StatCard label="Свободные" value={String(unusedCount)} tone="coral" />
        <StatCard
          label="Использованы"
          value={String(items.filter((p) => p.status === "used").length)}
        />
      </div>

      <div className="glass rounded-2xl p-5 sm:p-6">
        <h2 className="font-display text-xl text-ivory">Создать промокод</h2>
        <p className="mt-1 text-sm text-warm-gray">
          Выдайте код клиенту после оплаты наличными. Формат: PP-XXXXXX.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
              Количество
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
              className="w-full rounded-xl border border-gold/20 bg-background/50 px-3 py-2.5 text-ivory outline-none focus:border-gold/60"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
              Программа (необязательно)
            </label>
            <select
              value={programSlug}
              onChange={(e) => setProgramSlug(e.target.value)}
              className="w-full rounded-xl border border-gold/20 bg-background/50 px-3 py-2.5 text-ivory outline-none focus:border-gold/60"
            >
              <option value="">Без привязки</option>
              {programs.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-warm-gray">
              Пометка для себя
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: Мария, наличные 7.04"
              maxLength={120}
              className="w-full rounded-xl border border-gold/20 bg-background/50 px-3 py-2.5 text-ivory outline-none focus:border-gold/60"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void create()}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-background disabled:opacity-60"
        >
          <Ticket className="h-4 w-4" />
          {creating ? "Создаём…" : "Создать"}
        </button>

        {lastCreated.length > 0 && (
          <div className="mt-4 rounded-xl border border-gold/30 bg-gold/10 p-4">
            <p className="text-xs uppercase tracking-wider text-gold">Только что созданы</p>
            <ul className="mt-2 space-y-1 font-mono text-sm text-ivory">
              {lastCreated.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2">
                  <span>{c}</span>
                  <button
                    type="button"
                    onClick={() => void copy(c)}
                    className="text-xs text-gold hover:underline"
                  >
                    Копировать
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Все"],
            ["unused", "Свободные"],
            ["used", "Использованы"],
            ["revoked", "Отозваны"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              filter === id
                ? "bg-gold text-background"
                : "border border-gold/25 text-warm-gray hover:border-gold/50"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-warm-gray">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-warm-gray">Пока нет промокодов.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gold/15">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-gold/15 text-xs uppercase tracking-wider text-warm-gray">
              <tr>
                <th className="px-4 py-3">Код</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Программа</th>
                <th className="px-4 py-3">Пометка</th>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-gold/10">
                  <td className="px-4 py-3 font-mono text-ivory">
                    <button
                      type="button"
                      onClick={() => void copy(p.code)}
                      className="hover:text-gold"
                      title="Копировать"
                    >
                      {p.code}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-warm-gray">
                    {STATUS_LABEL[p.status] ?? p.status}
                    {p.used_at && (
                      <span className="mt-0.5 block text-[11px]">
                        {new Date(p.used_at).toLocaleString("ru-RU")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-warm-gray">
                    {p.program_title || "—"}
                  </td>
                  <td className="px-4 py-3 text-warm-gray">{p.label || "—"}</td>
                  <td className="px-4 py-3 text-warm-gray">
                    {new Date(p.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === "unused" && (
                      <button
                        type="button"
                        onClick={() => void revoke(p.id)}
                        className="text-xs text-coral hover:underline"
                      >
                        Отозвать
                      </button>
                    )}
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
