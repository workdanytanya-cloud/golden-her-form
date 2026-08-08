import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader, StatCard } from "@/components/panel/PanelShell";
import { ArrowLeft, ClipboardList, Dumbbell, Eye, KeyRound, Lock, Plus, Save, Trash2, Unlock, UserX, Utensils } from "lucide-react";
import { toast } from "sonner";
import {
  adminDeleteClient,
  adminUpdateClientPassword,
  adminUpdateClientProfile,
} from "@/lib/admin-clients.functions";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/")({
  component: ClientDetail,
});



type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  goal: string | null;
  height_cm: number | null;
  birth_date: string | null;
  gender: string | null;
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
      .select("id, full_name, phone, goal, height_cm, birth_date, gender, created_at")
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

      <ProfileEditor
        clientId={id}
        profile={profile}
        latestWeightKg={latest?.weight_kg ?? null}
        onSaved={load}
      />

      <AdminActions
        clientId={id}
        clientName={profile?.full_name}
        onDeleted={() => {
          toast.success("Клиент удалён");
          void navigate({ to: "/admin" });
        }}
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

function ProfileEditor({
  clientId,
  profile,
  latestWeightKg,
  onSaved,
}: {
  clientId: string;
  profile: Profile | null;
  latestWeightKg: number | null;
  onSaved: () => void;
}) {
  const updateProfile = useServerFn(adminUpdateClientProfile);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    goal: "",
    height_cm: "",
    weight_kg: "",
    birth_date: "",
    gender: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? "",
      phone: profile.phone ?? "",
      goal: profile.goal ?? "",
      height_cm: profile.height_cm != null ? String(profile.height_cm) : "",
      weight_kg: latestWeightKg != null ? String(latestWeightKg) : "",
      birth_date: profile.birth_date ?? "",
      gender: profile.gender ?? "",
    });
  }, [profile, latestWeightKg]);

  const saveWeight = async (weight: number) => {
    const measuredOn = new Date().toISOString().slice(0, 10);
    const { data: existingRows } = await supabase
      .from("measurements")
      .select("id")
      .eq("user_id", clientId)
      .eq("measured_on", measuredOn)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = existingRows?.[0];
    if (existing?.id) {
      const { error } = await supabase
        .from("measurements")
        .update({ weight_kg: weight })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("measurements").insert({
        user_id: clientId,
        measured_on: measuredOn,
        weight_kg: weight,
        note: "Из профиля (админ)",
      });
      if (error) throw error;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        data: {
          userId: clientId,
          full_name: form.full_name.trim() || null,
          phone: form.phone.trim() || null,
          goal: form.goal.trim() || null,
          height_cm: form.height_cm ? Number(form.height_cm) : null,
          birth_date: form.birth_date || null,
          gender: form.gender || null,
        },
      });
      const weight = form.weight_kg.trim() ? Number(form.weight_kg.replace(",", ".")) : null;
      if (weight != null && Number.isFinite(weight)) {
        if (weight < 30 || weight > 250) throw new Error("Вес должен быть от 30 до 250 кг");
        await saveWeight(weight);
      }
      toast.success("Профиль клиента обновлён");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h2 className="font-display text-2xl">Профиль клиента</h2>
      <p className="mt-1 text-sm text-warm-gray">
        Заполните за клиента, если он не может сделать это сам. При весе выше 85 кг в тренировках
        автоматически убираются прыжки и ударные нагрузки.
      </p>
      <form
        onSubmit={save}
        className="mt-4 grid gap-4 rounded-3xl border border-gold/15 bg-surface/40 p-6 md:grid-cols-6"
      >
        <F label="Имя" span="md:col-span-3">
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className={inputCls}
            maxLength={100}
          />
        </F>
        <F label="Телефон" span="md:col-span-3">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputCls}
          />
        </F>
        <F label="Дата рождения" span="md:col-span-2">
          <input
            type="date"
            value={form.birth_date}
            onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            className={inputCls}
          />
        </F>
        <F label="Рост, см" span="md:col-span-2">
          <input
            type="number"
            step="1"
            value={form.height_cm}
            onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
            className={inputCls}
          />
        </F>
        <F label="Вес, кг" span="md:col-span-2">
          <input
            type="number"
            step="0.1"
            value={form.weight_kg}
            onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
            className={inputCls}
            placeholder="например 86"
          />
        </F>
        <F label="Пол" span="md:col-span-2">
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="female">Женский</option>
            <option value="male">Мужской</option>
          </select>
        </F>
        <F label="Цель" span="md:col-span-6">
          <textarea
            value={form.goal}
            onChange={(e) => setForm({ ...form, goal: e.target.value })}
            rows={2}
            className={inputCls}
            maxLength={300}
          />
        </F>
        <div className="md:col-span-6 flex justify-end">
          <button
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> Сохранить профиль
          </button>
        </div>
      </form>
    </section>
  );
}

function AdminActions({
  clientId,
  clientName,
  onDeleted,
}: {
  clientId: string;
  clientName: string | null | undefined;
  onDeleted: () => void;
}) {
  const updatePassword = useServerFn(adminUpdateClientPassword);
  const deleteClient = useServerFn(adminDeleteClient);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [delLoading, setDelLoading] = useState(false);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Минимум 8 символов");
      return;
    }
    setPwLoading(true);
    try {
      await updatePassword({ data: { userId: clientId, password } });
      toast.success("Пароль обновлён");
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setPwLoading(false);
    }
  };

  const remove = async () => {
    const label = clientName || "этого клиента";
    if (
      !window.confirm(
        `Удалить ${label}? Все данные (замеры, программы, анкета) будут стёрты безвозвратно.`,
      )
    )
      return;
    setDelLoading(true);
    try {
      await deleteClient({ data: { userId: clientId } });
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка удаления");
      setDelLoading(false);
    }
  };

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="rounded-3xl border border-gold/15 bg-surface/40 p-6">
        <div className="flex items-center gap-2 text-ivory">
          <KeyRound className="h-4 w-4 text-gold" />
          <h3 className="font-display text-lg">Сменить пароль</h3>
        </div>
        <p className="mt-1 text-xs text-warm-gray">
          Задайте новый пароль. Сообщите его клиенту любым удобным способом.
        </p>
        <form onSubmit={submitPassword} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 8 символов"
              minLength={8}
              maxLength={72}
              className={`${inputCls} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-warm-gray hover:text-gold"
            >
              {showPassword ? "Скрыть" : "Показать"}
            </button>
          </div>
          <button
            disabled={pwLoading || password.length < 8}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4" /> Обновить
          </button>
        </form>
      </div>

      <div className="rounded-3xl border border-coral/25 bg-coral/5 p-6">
        <div className="flex items-center gap-2 text-ivory">
          <UserX className="h-4 w-4 text-coral" />
          <h3 className="font-display text-lg">Удалить клиента</h3>
        </div>
        <p className="mt-1 text-xs text-warm-gray">
          Полное удаление аккаунта и всех связанных данных. Действие необратимо.
        </p>
        <button
          type="button"
          onClick={remove}
          disabled={delLoading}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-coral/40 px-5 py-3 text-sm text-coral transition-colors hover:bg-coral/15 disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" /> {delLoading ? "Удаляем…" : "Удалить безвозвратно"}
        </button>
      </div>
    </section>
  );
}


