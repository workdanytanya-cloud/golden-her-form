import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowLeft, ClipboardList, Dumbbell, Eye, Lock, Plus, Trash2, Unlock, Utensils } from "lucide-react";
import { toast } from "sonner";

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

type Access = { status: string; activated_at: string | null; notes: string | null };

function ClientDetail() {
  const { id } = Route.useParams();
  const { user, startImpersonation } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(false);
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
      .then(({ data }) => setAccess((data ?? null) as Access | null));

    void supabase
      .from("onboarding_responses")
      .select("completed_at")
      .eq("user_id", id)
      .maybeSingle()
      .then(({ data }) =>
        setOnboardingCompleted(Boolean((data as { completed_at?: string } | null)?.completed_at)),
      );
  };

  useEffect(load, [id]);

  const grantAccess = async () => {
    if (!user) return;
    setUpdatingAccess(true);
    const { error } = await supabase
      .from("client_access")
      .upsert(
        {
          user_id: id,
          status: "active",
          activated_at: new Date().toISOString(),
          activated_by: user.id,
        },
        { onConflict: "user_id" },
      );
    setUpdatingAccess(false);
    if (error) return toast.error(error.message);
    toast.success("Доступ к курсу открыт");
    load();
  };

  const revokeAccess = async () => {
    setUpdatingAccess(true);
    const { error } = await supabase
      .from("client_access")
      .update({ status: "suspended" })
      .eq("user_id", id);
    setUpdatingAccess(false);
    if (error) return toast.error(error.message);
    toast.success("Доступ приостановлен");
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                startImpersonation(id, profile?.full_name || "Клиент");
                toast.success("Открываем кабинет клиента");
                void navigate({ to: "/dashboard" });
              }}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background transition-transform hover:scale-[1.02]"
            >
              <Eye className="h-4 w-4" /> Просмотр как клиент
            </button>
            <Link
              to="/admin/clients/$id/nutrition"
              params={{ id }}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-gold/10"
            >
              <Utensils className="h-4 w-4" /> Меню питания
            </Link>
            <Link
              to="/admin/clients/$id/training"
              params={{ id }}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-gold/10"
            >
              <Dumbbell className="h-4 w-4" /> Программа тренировок
            </Link>
            <Link
              to="/admin/clients/$id/onboarding"
              params={{ id }}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-gold/10"
            >
              <ClipboardList className="h-4 w-4" /> Анкета онбординга
            </Link>
          </div>
        }
      />


      <AccessManager
        status={access?.status ?? null}
        activatedAt={access?.activated_at ?? null}
        onboardingCompleted={onboardingCompleted}
        onGrant={grantAccess}
        onRevoke={revokeAccess}
        loading={updatingAccess}
      />

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

function AccessManager({
  status,
  activatedAt,
  onboardingCompleted,
  onGrant,
  onRevoke,
  loading,
}: {
  status: string | null;
  activatedAt: string | null;
  onboardingCompleted: boolean;
  onGrant: () => void;
  onRevoke: () => void;
  loading: boolean;
}) {
  const isActive = status === "active";
  const isAwaiting = status === "awaiting_approval";
  const isPending = status === "pending_onboarding" || status === null;
  const isSuspended = status === "suspended";

  const label = isActive
    ? "Курс открыт"
    : isAwaiting
      ? "Ожидает подтверждения тренера"
      : isSuspended
        ? "Доступ приостановлен"
        : "Анкета не заполнена";

  const tone = isActive
    ? "from-emerald-500/20 to-transparent ring-emerald-500/40 text-emerald-200"
    : isAwaiting
      ? "from-gold/20 to-transparent ring-gold/40 text-gold"
      : isSuspended
        ? "from-coral/20 to-transparent ring-coral/40 text-coral"
        : "from-surface/60 to-transparent ring-gold/15 text-warm-gray";

  return (
    <section
      className={`flex flex-col gap-4 rounded-3xl bg-gradient-to-br ${tone} p-6 ring-1 backdrop-blur md:flex-row md:items-center md:justify-between`}
    >
      <div>
        <p className="text-[11px] uppercase tracking-widest opacity-80">Доступ к курсу</p>
        <p className="mt-1 font-display text-xl text-ivory">{label}</p>
        {isActive && activatedAt && (
          <p className="mt-1 text-xs text-warm-gray">
            Открыт {new Date(activatedAt).toLocaleDateString("ru-RU")}
          </p>
        )}
        {isPending && (
          <p className="mt-1 text-xs text-warm-gray">
            Клиент увидит только раздел анкеты, пока не отправит её
          </p>
        )}
        {isAwaiting && (
          <p className="mt-1 text-xs text-warm-gray">
            Проверьте ответы клиента и откройте доступ к курсу и трекингу прогресса
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {!isActive && (
          <button
            onClick={onGrant}
            disabled={loading || (!onboardingCompleted && !isSuspended)}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
            title={!onboardingCompleted && !isSuspended ? "Дождитесь заполнения анкеты" : undefined}
          >
            <Unlock className="h-4 w-4" />
            {isSuspended ? "Возобновить доступ" : "Открыть курс"}
          </button>
        )}
        {isActive && (
          <button
            onClick={onRevoke}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-coral/40 px-5 py-2.5 text-sm text-ivory transition-colors hover:bg-coral/15 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> Приостановить
          </button>
        )}
      </div>
    </section>
  );
}

