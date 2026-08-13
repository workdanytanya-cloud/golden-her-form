import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader } from "@/components/panel/PanelShell";
import { SectionHint, FieldHint } from "@/components/panel/Hints";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { isHeightCmInRange, isRuNumberInRange, parseHeightCm, parseRuNumber } from "@/lib/ru-number";
import { JOINT_CARE_WEIGHT_KG } from "@/lib/training";

export const Route = createFileRoute("/_authenticated/dashboard/profile")({
  component: ProfilePage,
});

type ProfileForm = {
  full_name: string;
  phone: string;
  goal: string;
  height_cm: string;
  weight_kg: string;
  birth_date: string;
};

const empty: ProfileForm = {
  full_name: "",
  phone: "",
  goal: "",
  height_cm: "",
  weight_kg: "",
  birth_date: "",
};

function ProfilePage() {
  const { user, effectiveUserId, impersonation } = useAuth();
  const [form, setForm] = useState<ProfileForm>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;
    void (async () => {
      const [profRes, measRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, phone, goal, height_cm, birth_date")
          .eq("id", effectiveUserId)
          .maybeSingle(),
        supabase
          .from("measurements")
          .select("weight_kg")
          .eq("user_id", effectiveUserId)
          .not("weight_kg", "is", null)
          .order("measured_on", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const data = profRes.data;
      if (data) {
        setForm({
          full_name: data.full_name ?? "",
          phone: data.phone ?? "",
          goal: data.goal ?? "",
          height_cm: data.height_cm != null ? String(data.height_cm) : "",
          weight_kg: measRes.data?.weight_kg != null ? String(measRes.data.weight_kg) : "",
          birth_date: data.birth_date ?? "",
        });
      } else {
        setForm({
          ...empty,
          weight_kg: measRes.data?.weight_kg != null ? String(measRes.data.weight_kg) : "",
        });
      }
      setLoading(false);
    })();
  }, [effectiveUserId]);

  const saveWeight = async (userId: string, weight: number) => {
    const measuredOn = new Date().toISOString().slice(0, 10);
    const { data: existingRows } = await supabase
      .from("measurements")
      .select("id")
      .eq("user_id", userId)
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
        user_id: userId,
        measured_on: measuredOn,
        weight_kg: weight,
        note: "Из профиля",
      });
      if (error) throw error;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveUserId) return;
    if (impersonation) {
      toast.error("Режим просмотра как клиент — сохранение отключено");
      return;
    }
    if (form.weight_kg.trim() && !isRuNumberInRange(form.weight_kg, 30, 250)) {
      toast.error("Укажите вес от 30 до 250 кг");
      return;
    }
    if (form.height_cm.trim() && !isHeightCmInRange(form.height_cm)) {
      toast.error("Укажите рост от 120 до 230 см (или 1,65 м)");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name || null,
          phone: form.phone || null,
          goal: form.goal || null,
          height_cm: form.height_cm ? parseHeightCm(form.height_cm) : null,
          birth_date: form.birth_date || null,
        })
        .eq("id", effectiveUserId);
      if (error) throw error;
      const weight = parseRuNumber(form.weight_kg);
      if (weight != null) await saveWeight(effectiveUserId, weight);
      toast.success("Профиль обновлён");
    } catch (err) {
      toast.error("Не удалось сохранить: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PanelHeader
        eyebrow="Профиль"
        title="Личные данные"
        description="Эта информация помогает подобрать правильную нагрузку и питание."
      />

      <SectionHint tone="tip">
        Заполните хотя бы имя, рост, вес и цель — остальное можно добавить позже. Все поля видны
        только вам и вашему тренеру.
      </SectionHint>

      {loading ? (
        <p className="text-warm-gray">Загрузка…</p>
      ) : (
        <form onSubmit={save} className="max-w-2xl space-y-5 rounded-3xl border border-gold/15 bg-surface/40 p-6">
          <Field label="Имя" htmlFor="profile-name">
            <input
              id="profile-name"
              name="full_name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className={inputCls}
              placeholder="Как к вам обращаться"
              autoComplete="name"
            />
          </Field>
          <Field label="Email" htmlFor="profile-email">
            <input
              id="profile-email"
              value={user?.email ?? ""}
              disabled
              className={inputCls + " cursor-not-allowed opacity-60"}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Телефон" htmlFor="profile-phone">
              <input
                id="profile-phone"
                name="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputCls}
                placeholder="+7 …"
                autoComplete="tel"
              />
            </Field>
            <Field label="Дата рождения" htmlFor="profile-birth">
              <input
                id="profile-birth"
                name="birth_date"
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Рост, см" htmlFor="profile-height">
              <input
                id="profile-height"
                name="height_cm"
                value={form.height_cm}
                onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
                className={inputCls}
                inputMode="decimal"
                placeholder="165"
                autoComplete="off"
              />
            </Field>
            <div>
              <Field label="Вес, кг" htmlFor="profile-weight">
                <input
                  id="profile-weight"
                  name="weight_kg"
                  value={form.weight_kg}
                  onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="68"
                  autoComplete="off"
                />
              </Field>
              <FieldHint>
                При весе выше {JOINT_CARE_WEIGHT_KG} кг в тренировках автоматически убираются прыжки и
                ударные нагрузки на суставы.
              </FieldHint>
            </div>
          </div>
          <Field label="Моя цель" htmlFor="profile-goal">
            <textarea
              id="profile-goal"
              name="goal"
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              rows={3}
              className={inputCls}
              placeholder="Например: минус 6 кг к лету и подтянутое тело"
            />
          </Field>
          <FieldHint>
            Формулируйте конкретно: «минус 6 кг к июню», «поднять 60 кг в приседе», «прийти в форму к
            отпуску». Конкретная цель проще отслеживается.
          </FieldHint>

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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label
        htmlFor={htmlFor}
        className="mb-1 block cursor-pointer text-[11px] uppercase tracking-widest text-warm-gray"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
