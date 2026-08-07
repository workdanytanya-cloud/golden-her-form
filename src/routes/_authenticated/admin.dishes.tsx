import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader } from "@/components/panel/PanelShell";
import { MediaUpload } from "@/components/panel/MediaUpload";
import { Search, Save, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { MEDICAL_DIET_TABLES } from "@/lib/medical-diet-tables";
import { MEAL_TYPE_LABEL, mealTypeLabel } from "@/lib/nutrition";

export const Route = createFileRoute("/_authenticated/admin/dishes")({
  component: AdminDishes,
});

type Dish = {
  id: string;
  slug: string;
  name: string;
  meal_type: string;
  description: string | null;
  portion_weight_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  tags: string[];
  replacements: string[];
  image_url: string | null;
  video_url: string | null;
};

const emptyDish: Omit<Dish, "id"> = {
  slug: "",
  name: "",
  meal_type: "breakfast",
  description: null,
  portion_weight_g: 250,
  calories_per_100g: 100,
  protein_per_100g: 5,
  fat_per_100g: 3,
  carbs_per_100g: 15,
  tags: [],
  replacements: [],
  image_url: null,
  video_url: null,
};

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

function formatTagLabel(tag: string): string {
  if (tag === "general") return "общая";
  const m = /^table_(\d+)$/.exec(tag);
  if (m) return `Стол №${m[1]}`;
  const m2 = /^стол_(\d+)$/.exec(tag);
  if (m2) return `Стол №${m2[1]}`;
  return tag;
}

function AdminDishes() {
  const [items, setItems] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [meal, setMeal] = useState<string>("all");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Dish | (Omit<Dish, "id"> & { id?: string }) | null>(null);

  const load = () => {
    setLoading(true);
    void supabase
      .from("dishes")
      .select(
        "id, slug, name, meal_type, description, portion_weight_g, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, tags, replacements, image_url, video_url",
      )
      .order("meal_type")
      .order("name")
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setItems((data ?? []) as Dish[]);
        setLoading(false);
      });
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((e) => {
      if (meal !== "all" && e.meal_type !== meal) return false;
      if (tableFilter === "general") {
        if (!e.tags.includes("general")) return false;
      } else if (tableFilter !== "all" && !e.tags.includes(tableFilter)) {
        return false;
      }
      if (!t) return true;
      return (
        e.name.toLowerCase().includes(t) ||
        e.slug.toLowerCase().includes(t) ||
        e.tags.some((m) => m.toLowerCase().includes(t))
      );
    });
  }, [items, q, meal, tableFilter]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.slug.trim())
      return toast.error("Название и slug обязательны");
    const payload = {
      slug: editing.slug.trim(),
      name: editing.name.trim(),
      meal_type: editing.meal_type,
      description: editing.description,
      portion_weight_g: editing.portion_weight_g,
      calories_per_100g: editing.calories_per_100g,
      protein_per_100g: editing.protein_per_100g,
      fat_per_100g: editing.fat_per_100g,
      carbs_per_100g: editing.carbs_per_100g,
      tags: editing.tags,
      replacements: editing.replacements,
      image_url: editing.image_url,
      video_url: editing.video_url,
    };
    const q = "id" in editing && editing.id
      ? supabase.from("dishes").update(payload).eq("id", editing.id)
      : supabase.from("dishes").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Сохранено");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить блюдо?")) return;
    const { error } = await supabase.from("dishes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Удалено");
    load();
  };

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Библиотека"
        title="Рационы"
        description="Общая библиотека и рационы столов Певзнера №1–15. Фото, видео-рецепты, состав и КБЖУ."
        action={
          <button
            onClick={() => setEditing({ ...emptyDish })}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background transition-transform hover:scale-[1.02]"
          >
            <Plus className="h-4 w-4" /> Новое блюдо
          </button>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию, slug или тэгу"
            className="w-full rounded-full border border-gold/20 bg-surface/40 py-3 pl-11 pr-5 text-sm text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
          />
        </div>
        <select
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          className="rounded-full border border-gold/20 bg-surface/40 px-4 py-3 text-sm text-ivory"
        >
          <option value="all">Все приёмы</option>
          {MEAL_TYPES.map((c) => (
            <option key={c} value={c}>
              {MEAL_TYPE_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="rounded-full border border-gold/20 bg-surface/40 px-4 py-3 text-sm text-ivory"
        >
          <option value="all">Все столы</option>
          <option value="general">Общая библиотека</option>
          {MEDICAL_DIET_TABLES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full py-8 text-center text-warm-gray">Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full py-8 text-center text-warm-gray">Ничего не найдено</div>
        ) : (
          filtered.map((e) => (
            <div
              key={e.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-gold/15 bg-surface/40"
            >
              <div className="aspect-video w-full overflow-hidden bg-background/40">
                {e.image_url ? (
                  <img src={e.image_url} alt={e.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest text-warm-gray/60">
                    нет фото
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg text-ivory">{e.name}</div>
                    <div className="text-[11px] uppercase tracking-widest text-warm-gray">
                      {mealTypeLabel(e.meal_type)} · {e.portion_weight_g} г
                    </div>
                  </div>
                  <button
                    onClick={() => remove(e.id)}
                    className="rounded-full p-1.5 text-warm-gray hover:bg-coral/15 hover:text-coral"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-xs text-warm-gray">
                  {Math.round(e.calories_per_100g)} ккал/100г · Б {e.protein_per_100g} · Ж{" "}
                  {e.fat_per_100g} · У {e.carbs_per_100g}
                </div>
                {e.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {e.tags.slice(0, 4).map((m) => (
                      <span
                        key={m}
                        className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-gold"
                      >
                        {formatTagLabel(m)}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setEditing(e)}
                  className="mt-auto rounded-full border border-gold/30 px-3 py-1.5 text-xs uppercase tracking-widest text-ivory transition-colors hover:bg-gold/10"
                >
                  Редактировать
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editing && (
        <EditDialog onClose={() => setEditing(null)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Название">
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className={inp}
              />
            </Field>
            <Field label="Slug">
              <input
                value={editing.slug}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                className={inp}
              />
            </Field>
            <Field label="Приём пищи">
              <select
                value={editing.meal_type}
                onChange={(e) => setEditing({ ...editing, meal_type: e.target.value })}
                className={inp}
              >
                {MEAL_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {MEAL_TYPE_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Порция, г">
              <input
                type="number"
                value={editing.portion_weight_g}
                onChange={(e) =>
                  setEditing({ ...editing, portion_weight_g: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Ккал / 100г">
              <input
                type="number"
                step="0.1"
                value={editing.calories_per_100g}
                onChange={(e) =>
                  setEditing({ ...editing, calories_per_100g: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Белки / 100г">
              <input
                type="number"
                step="0.1"
                value={editing.protein_per_100g}
                onChange={(e) =>
                  setEditing({ ...editing, protein_per_100g: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Жиры / 100г">
              <input
                type="number"
                step="0.1"
                value={editing.fat_per_100g}
                onChange={(e) =>
                  setEditing({ ...editing, fat_per_100g: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Углеводы / 100г">
              <input
                type="number"
                step="0.1"
                value={editing.carbs_per_100g}
                onChange={(e) =>
                  setEditing({ ...editing, carbs_per_100g: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Тэги (через запятую)">
              <input
                value={editing.tags.join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tags: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={inp}
              />
            </Field>
            <Field label="Замены (slug через запятую)">
              <input
                value={editing.replacements.join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    replacements: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={inp}
              />
            </Field>
            <Field label="Описание" span="md:col-span-2">
              <textarea
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
                className={`${inp} min-h-[100px]`}
              />
            </Field>
            <MediaUpload
              label="Фото блюда"
              value={editing.image_url}
              onChange={(url) => setEditing({ ...editing, image_url: url })}
              accept="image/jpeg,image/png,image/webp"
              folder="dishes/images"
              preview="image"
            />
            <MediaUpload
              label="Видео-рецепт"
              value={editing.video_url}
              onChange={(url) => setEditing({ ...editing, video_url: url })}
              accept="video/mp4,video/webm,video/quicktime"
              folder="dishes/videos"
              preview="video"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-full border border-gold/20 px-5 py-2 text-sm text-ivory hover:bg-surface/50"
            >
              Отмена
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2 text-sm font-medium text-background hover:scale-[1.02]"
            >
              <Save className="h-4 w-4" /> Сохранить
            </button>
          </div>
        </EditDialog>
      )}
    </div>
  );
}

const inp =
  "w-full rounded-xl border border-gold/20 bg-background/40 px-4 py-2.5 text-sm text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60";

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

function EditDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur">
      <div className="relative my-8 w-full max-w-3xl rounded-3xl border border-gold/20 bg-surface/95 p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-6 top-6 rounded-full p-1.5 text-warm-gray hover:bg-gold/10 hover:text-ivory"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
