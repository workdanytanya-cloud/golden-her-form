import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader } from "@/components/panel/PanelShell";
import { SectionHint, FieldHint } from "@/components/panel/Hints";
import { toast } from "sonner";
import { Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfilePage,
});

type ProfileForm = {
  full_name: string;
  phone: string;
  goal: string;
  height_cm: string;
  birth_date: string;
};

const empty: ProfileForm = {
  full_name: "",
  phone: "",
  goal: "",
  height_cm: "",
  birth_date: "",
};

function ProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState<ProfileForm>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("full_name, phone, goal, height_cm, birth_date")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            full_name: data.full_name ?? "",
            phone: data.phone ?? "",
            goal: data.goal ?? "",
            height_cm: data.height_cm != null ? String(data.height_cm) : "",
            birth_date: data.birth_date ?? "",
          });
        }
        setLoading(false);
      });
  }, [user]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name || null,
        phone: form.phone || null,
        goal: form.goal || null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        birth_date: form.birth_date || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error("Не удалось сохранить: " + error.message);
    toast.success("Профиль обновлён");
  };

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Профиль"
        title="Личные данные"
        description="Эта информация помогает подобрать правильную нагрузку и питание."
      />

      <SectionHint tone="tip">
        Заполните хотя бы имя, рост и цель — остальное можно добавить позже. Все поля видны только
        вам и вашему тренеру.
      </SectionHint>

      {loading ? (
        <p className="text-warm-gray">Загрузка…</p>
      ) : (
        <form onSubmit={save} className="max-w-2xl space-y-5 rounded-3xl border border-gold/15 bg-surface/40 p-6">

          <Field label="Имя">
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className={inputCls}
              placeholder="Как к вам обращаться"
            />
          </Field>
          <Field label="Email">
            <input value={user?.email ?? ""} disabled className={inputCls + " opacity-60"} />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Телефон">
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputCls}
                placeholder="+7 …"
              />
            </Field>
            <Field label="Дата рождения">
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Рост, см">
              <input
                type="number"
                value={form.height_cm}
                onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Моя цель">
            <textarea
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              rows={3}
              className={inputCls}
              placeholder="Например: минус 6 кг к лету и подтянутое тело"
            />
          </Field>
          <button
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> Сохранить
          </button>
        </form>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-widest text-warm-gray">
        {label}
      </span>
      {children}
    </label>
  );
}
