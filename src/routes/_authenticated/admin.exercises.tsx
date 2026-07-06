import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PanelHeader } from "@/components/panel/PanelShell";
import { MediaUpload } from "@/components/panel/MediaUpload";
import { ExerciseMedia } from "@/components/panel/ExerciseMedia";
import { Search, Save, Trash2, Plus, X } from "lucide-react";
import { CATEGORY_LABEL } from "@/lib/training";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/exercises")({
  component: AdminExercises,
});

type Exercise = {
  id: string;
  slug: string;
  name: string;
  category: string;
  difficulty: string;
  muscle_groups: string[];
  equipment: string[];
  default_sets: number;
  default_reps: string;
  rest_seconds: number;
  tempo: string | null;
  description: string | null;
  gif_url: string | null;
  video_url: string | null;
};

const emptyExercise: Omit<Exercise, "id"> = {
  slug: "",
  name: "",
  category: "strength",
  difficulty: "beginner",
  muscle_groups: [],
  equipment: [],
  default_sets: 3,
  default_reps: "10-12",
  rest_seconds: 60,
  tempo: null,
  description: null,
  gif_url: null,
  video_url: null,
};

const CATEGORIES = [
  "warmup",
  "mobility",
  "activation",
  "core",
  "strength_lower",
  "strength_upper",
  "strength_full",
  "cardio",
  "cooldown",
] as const;
const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: "Начинающий",
  intermediate: "Средний",
  advanced: "Продвинутый",
};
const DIFFICULTIES = ["beginner", "intermediate", "advanced"];

function AdminExercises() {
  const [items, setItems] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [editing, setEditing] = useState<Exercise | (Omit<Exercise, "id"> & { id?: string }) | null>(null);

  const load = () => {
    setLoading(true);
    void supabase
      .from("exercises")
      .select(
        "id, slug, name, category, difficulty, muscle_groups, equipment, default_sets, default_reps, rest_seconds, tempo, description, gif_url, video_url",
      )
      .order("category")
      .order("name")
      .then(({ data }) => {
        setItems((data ?? []) as Exercise[]);
        setLoading(false);
      });
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter(
      (e) =>
        (cat === "all" || e.category === cat) &&
        (!t ||
          e.name.toLowerCase().includes(t) ||
          e.slug.toLowerCase().includes(t) ||
          e.muscle_groups.some((m) => m.toLowerCase().includes(t))),
    );
  }, [items, q, cat]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.slug.trim())
      return toast.error("Название и slug обязательны");
    const payload = {
      slug: editing.slug.trim(),
      name: editing.name.trim(),
      category: editing.category,
      difficulty: editing.difficulty,
      muscle_groups: editing.muscle_groups,
      equipment: editing.equipment,
      default_sets: editing.default_sets,
      default_reps: editing.default_reps,
      rest_seconds: editing.rest_seconds,
      tempo: editing.tempo,
      description: editing.description,
      gif_url: editing.gif_url,
      video_url: editing.video_url,
    };
    const q = "id" in editing && editing.id
      ? supabase.from("exercises").update(payload).eq("id", editing.id)
      : supabase.from("exercises").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Сохранено");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить упражнение?")) return;
    const { error } = await supabase.from("exercises").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Удалено");
    load();
  };

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Библиотека"
        title="Упражнения"
        description="Все упражнения в базе. Загружайте GIF/видео с лицом тренера, редактируйте технику и настройки по умолчанию."
        action={
          <button
            onClick={() => setEditing({ ...emptyExercise })}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background transition-transform hover:scale-[1.02]"
          >
            <Plus className="h-4 w-4" /> Новое упражнение
          </button>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию, slug или мышце"
            className="w-full rounded-full border border-gold/20 bg-surface/40 py-3 pl-11 pr-5 text-sm text-ivory placeholder:text-warm-gray/60 outline-none focus:border-gold/60"
          />
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-full border border-gold/20 bg-surface/40 px-4 py-3 text-sm text-ivory"
        >
          <option value="all">Все категории</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
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
              className="group flex flex-col overflow-hidden rounded-2xl border border-gold/15 bg-surface/40"
            >
              <div className="aspect-video w-full overflow-hidden bg-background/40">
                {e.gif_url ? (
                  <ExerciseMedia
                    url={e.gif_url}
                    alt={e.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest text-warm-gray/60">
                    нет медиа
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg text-ivory">{e.name}</div>
                    <div className="text-[11px] uppercase tracking-widest text-warm-gray">
                      {e.category} · {e.difficulty}
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
                  {e.default_sets}×{e.default_reps} · отдых {e.rest_seconds}с
                </div>
                {e.muscle_groups.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {e.muscle_groups.slice(0, 4).map((m) => (
                      <span
                        key={m}
                        className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-gold"
                      >
                        {m}
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
            <Field label="Категория">
              <select
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                className={inp}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сложность">
              <select
                value={editing.difficulty}
                onChange={(e) => setEditing({ ...editing, difficulty: e.target.value })}
                className={inp}
              >
                {DIFFICULTIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Мышечные группы (через запятую)">
              <input
                value={editing.muscle_groups.join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    muscle_groups: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={inp}
              />
            </Field>
            <Field label="Инвентарь (через запятую)">
              <input
                value={editing.equipment.join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    equipment: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={inp}
              />
            </Field>
            <Field label="Подходы">
              <input
                type="number"
                value={editing.default_sets}
                onChange={(e) =>
                  setEditing({ ...editing, default_sets: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Повторения">
              <input
                value={editing.default_reps}
                onChange={(e) => setEditing({ ...editing, default_reps: e.target.value })}
                className={inp}
              />
            </Field>
            <Field label="Отдых (сек)">
              <input
                type="number"
                value={editing.rest_seconds}
                onChange={(e) =>
                  setEditing({ ...editing, rest_seconds: Number(e.target.value) || 0 })
                }
                className={inp}
              />
            </Field>
            <Field label="Темп">
              <input
                value={editing.tempo ?? ""}
                onChange={(e) => setEditing({ ...editing, tempo: e.target.value || null })}
                className={inp}
              />
            </Field>
            <Field label="Описание / техника" span="md:col-span-2">
              <textarea
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
                className={`${inp} min-h-[100px]`}
              />
            </Field>
            <MediaUpload
              label="GIF с техникой"
              value={editing.gif_url}
              onChange={(url) => setEditing({ ...editing, gif_url: url })}
              accept="image/gif,image/webp,image/jpeg,image/png"
              folder="exercises/gifs"
              preview="image"
            />
            <MediaUpload
              label="Видео с лицом тренера"
              value={editing.video_url}
              onChange={(url) => setEditing({ ...editing, video_url: url })}
              accept="video/mp4,video/webm,video/quicktime"
              folder="exercises/videos"
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
