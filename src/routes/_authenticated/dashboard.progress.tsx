import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PanelHeader } from "@/components/panel/PanelShell";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/progress")({
  component: ProgressPage,
});

type Measurement = {
  id: string;
  measured_on: string;
  weight_kg: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  chest_cm: number | null;
  note: string | null;
};

const empty = {
  measured_on: new Date().toISOString().slice(0, 10),
  weight_kg: "",
  waist_cm: "",
  hips_cm: "",
  chest_cm: "",
  note: "",
};

function ProgressPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!user) return;
    void supabase
      .from("measurements")
      .select("id, measured_on, weight_kg, waist_cm, hips_cm, chest_cm, note")
      .eq("user_id", user.id)
      .order("measured_on", { ascending: false })
      .then(({ data }) => {
        setItems((data ?? []) as Measurement[]);
        setLoading(false);
      });
  };

  useEffect(load, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      measured_on: form.measured_on,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      waist_cm: form.waist_cm ? Number(form.waist_cm) : null,
      hips_cm: form.hips_cm ? Number(form.hips_cm) : null,
      chest_cm: form.chest_cm ? Number(form.chest_cm) : null,
      note: form.note || null,
    };
    const { error } = await supabase.from("measurements").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Не удалось сохранить: " + error.message);
      return;
    }
    toast.success("Замер добавлен");
    setForm(empty);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("measurements").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Удалено");
    load();
  };

  return (
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Прогресс"
        title="Мои замеры"
        description="Регулярно записывайте цифры — так виден настоящий результат."
      />

      <form
        onSubmit={submit}
        className="grid gap-4 rounded-3xl border border-gold/15 bg-surface/40 p-6 md:grid-cols-6"
      >
        <Field label="Дата" span="md:col-span-2">
          <input
            type="date"
            required
            value={form.measured_on}
            onChange={(e) => setForm({ ...form, measured_on: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Вес, кг">
          <input
            type="number"
            step="0.1"
            value={form.weight_kg}
            onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Талия, см">
          <input
            type="number"
            step="0.1"
            value={form.waist_cm}
            onChange={(e) => setForm({ ...form, waist_cm: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Бёдра, см">
          <input
            type="number"
            step="0.1"
            value={form.hips_cm}
            onChange={(e) => setForm({ ...form, hips_cm: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Грудь, см">
          <input
            type="number"
            step="0.1"
            value={form.chest_cm}
            onChange={(e) => setForm({ ...form, chest_cm: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Заметка" span="md:col-span-5">
          <input
            type="text"
            placeholder="Самочувствие, тренировки, питание…"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className={inputCls}
          />
        </Field>
        <div className="flex items-end">
          <button
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-3 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Добавить
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-gold/15">
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
                  Ещё нет ни одного замера
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
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-3 text-sm text-ivory placeholder:text-warm-gray/60 outline-none transition-colors focus:border-gold/60";

function Field({
  label,
  span,
  children,
}: {
  label: string;
  span?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${span ?? ""}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-widest text-warm-gray">
        {label}
      </span>
      {children}
    </label>
  );
}
