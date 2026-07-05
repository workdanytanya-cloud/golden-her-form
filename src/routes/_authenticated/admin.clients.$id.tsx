import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowLeft, ClipboardList, Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ACCESS_STATUS_LABEL,
  ACCESS_STATUS_TONE,
  isAccessStatus,
  type AccessStatus,
} from "@/lib/access";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  component: ClientDetail,
});

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  height_cm: number | null;
  birth_date: string | null;
  created_at: string;
};

type Measurement = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  chest_cm: number | null;
  note: string | null;
};

const emptyForm = {
  measured_on: new Date().toISOString().slice(0, 10),
  weight_kg: "",
  waist_cm: "",
  hips_cm: "",
  chest_cm: "",
  note: "",
};

function ClientDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<{
    status: AccessStatus;
    activated_at: string | null;
    notes: string | null;
  } | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [updatingAccess, setUpdatingAccess] = useState(false);

  const load = () => {
    void supabase
      .from("profiles")
      .select("id, full_name, phone, goal, height_cm, birth_date, created_at")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));

    void supabase
      .from("measurements")
      .select("id, measured_on, weight_kg, waist_cm, hips_cm, chest_cm, note")
      .eq("user_id", id)
      .order("measured_on", { ascending: false })
      .then(({ data }) => {
        setItems((data ?? []) as Measurement[]);
        setLoading(false);
      });

    void supabase
      .from("client_access")
      .select("status, activated_at, notes")
      .eq("user_id", id)
      .maybeSingle()
      .then(({ data }) => {
        const d = data as { status?: string; activated_at?: string | null; notes?: string | null } | null;
        const status = isAccessStatus(d?.status) ? (d!.status as AccessStatus) : "pending_onboarding";
        setAccess({
          status,
          activated_at: d?.activated_at ?? null,
          notes: d?.notes ?? null,
        });
        setNotesDraft(d?.notes ?? "");
      });
  };

  useEffect(load, [id]);

  const setAccessStatus = async (next: AccessStatus) => {
    setUpdatingAccess(true);
    const payload: {
      user_id: string;
      status: AccessStatus;
      notes: string | null;
      activated_at?: string | null;
      activated_by?: string | null;
    } = {
      user_id: id,
      status: next,
      notes: notesDraft.trim() || null,
    };
    if (next === "active") {
      payload.activated_at = new Date().toISOString();
      payload.activated_by = user?.id ?? null;
    }
    const { error } = await supabase
      .from("client_access")
      .upsert(payload, { onConflict: "user_id" });
    setUpdatingAccess(false);
    if (error) return toast.error(error.message);
    toast.success(
      next === "active"
        ? "Доступ активирован"
        : next === "paused"
          ? "Сопровождение на паузе"
          : "Статус обновлён",
    );
    load();
  };

  const saveNotes = async () => {
    if (!access) return;
    setUpdatingAccess(true);
    const { error } = await supabase
      .from("client_access")
      .upsert(
        { user_id: id, status: access.status, notes: notesDraft.trim() || null },
        { onConflict: "user_id" },
      );
    setUpdatingAccess(false);
    if (error) return toast.error(error.message);
    toast.success("Заметка сохранена");
    load();
  };

  const addMeasurement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("measurements").insert({
      user_id: id,
      measured_on: form.measured_on,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      waist_cm: form.waist_cm ? Number(form.waist_cm) : null,
      hips_cm: form.hips_cm ? Number(form.hips_cm) : null,
      chest_cm: form.chest_cm ? Number(form.chest_cm) : null,
      note: form.note || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Замер добавлен");
    setForm(emptyForm);
    load();
  };

  const remove = async (mid: string) => {
    const { error } = await supabase.from("measurements").delete().eq("id", mid);
    if (error) return toast.error(error.message);
    toast.success("Удалено");
    load();
  };

  const latest = items[0];

  return (
    <div className="space-y-10">
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 text-sm text-warm-gray hover:text-ivory"
      >
        <ArrowLeft className="h-4 w-4" /> Ко всем клиентам
      </Link>

      <PanelHeader
        eyebrow="Клиент"
        title={profile?.full_name || "Без имени"}
        description={profile?.goal || "Цель не задана"}
        action={
          <Link
            to="/admin/clients/$id/onboarding"
            params={{ id }}
            className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-gold/10"
          >
            <ClipboardList className="h-4 w-4" /> Анкета онбординга
          </Link>
        }
      />

      {access && (
        <section className="rounded-3xl border border-gold/20 bg-surface/40 p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="eyebrow">Доступ клиента</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${ACCESS_STATUS_TONE[access.status]}`}
                >
                  {ACCESS_STATUS_LABEL[access.status]}
                </span>
                {access.activated_at && (
                  <span className="text-xs text-warm-gray">
                    активирован {new Date(access.activated_at).toLocaleDateString("ru-RU")}
                  </span>
                )}
              </div>
              <p className="mt-3 max-w-lg text-sm text-warm-gray">
                Пока статус не «Активен», клиент видит только анкету и экран ожидания. Активируйте
                доступ после проверки анкеты и договорённости о сопровождении.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {access.status !== "active" ? (
                <button
                  disabled={updatingAccess}
                  onClick={() => setAccessStatus("active")}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
                >
                  <Play className="h-4 w-4" /> Активировать
                </button>
              ) : (
                <button
                  disabled={updatingAccess}
                  onClick={() => setAccessStatus("paused")}
                  className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-sm text-ivory transition-colors hover:bg-coral/15 disabled:opacity-60"
                >
                  <Pause className="h-4 w-4" /> Поставить на паузу
                </button>
              )}
              {access.status === "paused" && (
                <button
                  disabled={updatingAccess}
                  onClick={() => setAccessStatus("awaiting_approval")}
                  className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-sm text-ivory transition-colors hover:bg-gold/10 disabled:opacity-60"
                >
                  К ожиданию
                </button>
              )}
            </div>
          </div>
          <div className="mt-6">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-widest text-warm-gray">
                Заметка тренера
              </span>
              <textarea
                rows={2}
                maxLength={500}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Договорённости, пакет, старт сопровождения…"
                className="w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60"
              />
            </label>
            <div className="mt-2 flex justify-end">
              <button
                disabled={updatingAccess || notesDraft === (access.notes ?? "")}
                onClick={saveNotes}
                className="text-xs uppercase tracking-widest text-gold transition-colors hover:text-ivory disabled:opacity-40"
              >
                Сохранить заметку
              </button>
            </div>
          </div>
        </section>
      )}


      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Телефон" value={profile?.phone || "—"} />
        <StatCard label="Рост" value={profile?.height_cm ? `${profile.height_cm} см` : "—"} />
        <StatCard
          label="Текущий вес"
          value={latest?.weight_kg != null ? `${latest.weight_kg} кг` : "—"}
          tone="gold"
        />
        <StatCard label="Замеров" value={String(items.length)} tone="coral" />
      </div>

      <section>
        <h2 className="font-display text-2xl">Добавить замер</h2>
        <form
          onSubmit={addMeasurement}
          className="mt-4 grid gap-4 rounded-3xl border border-gold/15 bg-surface/40 p-6 md:grid-cols-6"
        >
          <F label="Дата" span="md:col-span-2">
            <input
              type="date"
              required
              value={form.measured_on}
              onChange={(e) => setForm({ ...form, measured_on: e.target.value })}
              className={inputCls}
            />
          </F>
          <F label="Вес, кг">
            <input
              type="number"
              step="0.1"
              value={form.weight_kg}
              onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
              className={inputCls}
            />
          </F>
          <F label="Талия">
            <input
              type="number"
              step="0.1"
              value={form.waist_cm}
              onChange={(e) => setForm({ ...form, waist_cm: e.target.value })}
              className={inputCls}
            />
          </F>
          <F label="Бёдра">
            <input
              type="number"
              step="0.1"
              value={form.hips_cm}
              onChange={(e) => setForm({ ...form, hips_cm: e.target.value })}
              className={inputCls}
            />
          </F>
          <F label="Грудь">
            <input
              type="number"
              step="0.1"
              value={form.chest_cm}
              onChange={(e) => setForm({ ...form, chest_cm: e.target.value })}
              className={inputCls}
            />
          </F>
          <F label="Заметка тренера" span="md:col-span-5">
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className={inputCls}
              placeholder="Динамика, рекомендации…"
            />
          </F>
          <div className="flex items-end">
            <button
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Записать
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-display text-2xl">История замеров</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-gold/15">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface/50 text-[11px] uppercase tracking-widest text-warm-gray">
              <tr>
                <th className="px-5 py-3">Дата</th>
                <th className="px-5 py-3">Вес</th>
                <th className="px-5 py-3">Талия</th>
                <th className="px-5 py-3">Бёдра</th>
                <th className="px-5 py-3">Грудь</th>
                <th className="px-5 py-3">Заметка</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-warm-gray">
                    Загрузка…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-warm-gray">
                    Пока нет замеров
                  </td>
                </tr>
              ) : (
                items.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-ivory">
                      {new Date(m.measured_on).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="px-5 py-3 text-warm-gray">{m.weight_kg ?? "—"}</td>
                    <td className="px-5 py-3 text-warm-gray">{m.waist_cm ?? "—"}</td>
                    <td className="px-5 py-3 text-warm-gray">{m.hips_cm ?? "—"}</td>
                    <td className="px-5 py-3 text-warm-gray">{m.chest_cm ?? "—"}</td>
                    <td className="px-5 py-3 text-warm-gray">{m.note ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => remove(m.id)}
                        className="rounded-full p-2 text-warm-gray hover:bg-coral/15 hover:text-coral"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60";

function F({ label, span, children }: { label: string; span?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${span ?? ""}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-widest text-warm-gray">
        {label}
      </span>
      {children}
    </label>
  );
}
