import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/panel/PanelShell";
import { MediaUpload } from "@/components/panel/MediaUpload";
import { ExerciseMedia } from "@/components/panel/ExerciseMedia";
import { Search, Save, Trash2, Plus, X, Download } from "lucide-react";
import { CATEGORY_LABEL } from "@/lib/training";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import type { ExerciseVideoProvider, ExerciseVideoStatus } from "@/lib/exercise-video";
import {
  loadRuntimeConfig,
  selfhostAdminDeleteExerciseMedia,
  selfhostAdminExercises,
  selfhostAdminRemoveExercise,
  selfhostAdminRestoreExercise,
  selfhostAdminSaveExerciseMedia,
  selfhostAdminUpsertExercise,
  selfhostUnmatchedExercises,
} from "@/lib/selfhost/client-api";
import type { AdminExerciseReport, MediaFilter } from "@/lib/selfhost/exercise-admin-types";
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
  video_title: string | null;
  video_fallback_text: string | null;
  video_provider?: ExerciseVideoProvider | string | null;
  video_status?: ExerciseVideoStatus | string | null;
  video_embed_url?: string | null;
  publishedUseCount?: number;
  needsManualCheck?: boolean;
  archived_at?: string | null;
  is_active?: boolean;
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
  video_title: null,
  video_fallback_text: null,
  video_provider: "none",
  video_status: "unchecked",
  video_embed_url: null,
  publishedUseCount: 0,
  needsManualCheck: true,
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
const MEDIA_FILTER_CHIPS: { id: MediaFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "ok", label: "Есть рабочая ссылка" },
  { id: "none", label: "Нет ссылки" },
  { id: "unchecked", label: "Не проверено" },
  { id: "unavailable", label: "Недоступно" },
  { id: "used", label: "Используется в опубликованных программах" },
];
const STATUS_LABEL: Record<string, string> = {
  ok: "рабочая",
  unchecked: "не проверено",
  unavailable: "недоступно",
};
const PROVIDER_LABEL: Record<string, string> = {
  youtube: "YouTube",
  rutube: "Rutube",
  none: "нет",
  external: "внешняя",
};

async function downloadMedia(url: string, slug: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = (url.split("?")[0].split(".").pop() || "bin").toLowerCase();
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = `${slug}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function matchesMedia(e: Exercise, media: MediaFilter): boolean {
  const provider = e.video_provider ?? "none";
  const status = e.video_status ?? (e.video_url ? "ok" : "unchecked");
  const hasWorking =
    status === "ok" && (provider === "youtube" || provider === "rutube" || Boolean(e.video_url));
  switch (media) {
    case "ok":
      return hasWorking;
    case "none":
      return !e.video_url;
    case "unchecked":
      return Boolean(e.video_url) && status === "unchecked";
    case "unavailable":
      return status === "unavailable";
    case "used":
      return (e.publishedUseCount ?? 0) > 0;
    default:
      return true;
  }
}

function AdminExercises() {
  const [items, setItems] = useState<Exercise[]>([]);
  const [report, setReport] = useState<AdminExerciseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [media, setMedia] = useState<MediaFilter>("all");
  const [localCircuit, setLocalCircuit] = useState(false);
  const [localLinks, setLocalLinks] = useState(false);
  const [unmatched, setUnmatched] = useState<
    Array<{ original_exercise_id: string; source_url: string | null; title: string | null }>
  >([]);
  const [editing, setEditing] = useState<
    Exercise | (Omit<Exercise, "id"> & { id?: string }) | null
  >(null);

  const load = () => {
    setLoading(true);
    void (async () => {
      try {
        const runtime = await loadRuntimeConfig();
        const local = runtime.authBackend === "local" && runtime.dataBackend === "postgres";
        setLocalCircuit(local);
        setLocalLinks(local && runtime.mediaBackend === "local-links");
        if (local) {
          const result = await selfhostAdminExercises();
          setItems(result.items);
          setReport(result.report);
          const pending = await selfhostUnmatchedExercises();
          setUnmatched(pending.items);
          setLoading(false);
          return;
        }
        const { supabase } = await import("@/integrations/supabase/client");
        const pageSize = 1000;
        const all: Exercise[] = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("exercises")
            .select(
              "id, slug, name, category, difficulty, muscle_groups, equipment, default_sets, default_reps, rest_seconds, tempo, description, gif_url, video_url, video_title, video_fallback_text",
            )
            .order("category")
            .order("name")
            .range(from, from + pageSize - 1);
          if (
            error &&
            /video_title|video_fallback_text|PGRST204|schema cache/i.test(error.message)
          ) {
            const retry = await supabase
              .from("exercises")
              .select(
                "id, slug, name, category, difficulty, muscle_groups, equipment, default_sets, default_reps, rest_seconds, tempo, description, gif_url, video_url",
              )
              .order("category")
              .order("name")
              .range(from, from + pageSize - 1);
            if (retry.error) {
              toast.error(retry.error.message);
              break;
            }
            all.push(
              ...((retry.data ?? []) as Exercise[]).map((row) => ({
                ...row,
                video_title: row.video_title ?? null,
                video_fallback_text: row.video_fallback_text ?? null,
              })),
            );
            if (!retry.data || retry.data.length < pageSize) break;
            continue;
          }
          if (error) {
            toast.error(error.message);
            break;
          }
          all.push(
            ...((data ?? []) as Record<string, unknown>[]).map((row) => ({
              ...(row as unknown as Exercise),
              video_title: (row.video_title as string | null) ?? null,
              video_fallback_text: (row.video_fallback_text as string | null) ?? null,
            })),
          );
          if (!data || data.length < pageSize) break;
        }
        setItems(all);
        setReport(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось загрузить упражнения");
      } finally {
        setLoading(false);
      }
    })();
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter(
      (e) =>
        (cat === "all" || e.category === cat) &&
        matchesMedia(e, media) &&
        (!t ||
          e.name.toLowerCase().includes(t) ||
          e.slug.toLowerCase().includes(t) ||
          e.muscle_groups.some((m) => m.toLowerCase().includes(t))),
    );
  }, [items, q, cat, media]);

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
      video_title: editing.video_title,
      video_fallback_text: editing.video_fallback_text,
      video_status: editing.video_status ?? null,
      ...("id" in editing && editing.id ? { id: editing.id } : {}),
    };
    try {
      if (localCircuit) {
        await selfhostAdminUpsertExercise(payload);
      } else {
        const { adminUpsertExerciseFn } = await import("@/lib/exercise.functions");
        await adminUpsertExerciseFn({ data: payload });
      }
      toast.success("Сохранено");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    }
  };

  const saveVideo = async () => {
    if (!editing || !("id" in editing) || !editing.id) {
      return toast.error("Сначала сохраните упражнение");
    }
    try {
      if (localCircuit) {
        await selfhostAdminSaveExerciseMedia({
          exercise_id: editing.id,
          video_url: editing.video_url,
          video_title: editing.video_title,
          video_fallback_text: editing.video_fallback_text,
          video_status: editing.video_status ?? null,
        });
      } else {
        await save();
        return;
      }
      toast.success("Видео сохранено");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить видео");
    }
  };

  const clearVideo = async () => {
    if (!editing) return;
    setEditing({ ...editing, video_url: null, video_embed_url: null, video_provider: "none" });
    if (localCircuit && "id" in editing && editing.id) {
      try {
        await selfhostAdminDeleteExerciseMedia(editing.id);
        toast.success("Ссылка удалена");
        load();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось удалить ссылку");
      }
    }
  };

  const restore = async (id: string) => {
    try {
      if (localCircuit) await selfhostAdminRestoreExercise(id);
      toast.success("Упражнение восстановлено");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось восстановить");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Убрать упражнение из каталога? Оно останется в опубликованных программах."))
      return;
    try {
      if (localCircuit) {
        await selfhostAdminRemoveExercise(id);
      } else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("exercises").delete().eq("id", id);
        if (error) return toast.error(error.message);
      }
      toast.success("Удалено");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить");
    }
  };

  const countFor = (id: MediaFilter) => {
    if (report) return report[id];
    return items.filter((e) => matchesMedia(e, id)).length;
  };

  const previewVideo = editing ? normalizeExerciseVideo(editing) : null;

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Библиотека"
        title="Упражнения"
        description={`В базе ${items.length || "…"} упражнений из вашей таблицы (с видео). Можно добавить или отредактировать вручную.`}
        action={
          <button
            onClick={() => setEditing({ ...emptyExercise })}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background transition-transform hover:scale-[1.02]"
          >
            <Plus className="h-4 w-4" /> Новое упражнение
          </button>
        }
      />

      {unmatched.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-ivory">
          <p className="font-medium">Требует сопоставления: {unmatched.length}</p>
          <p className="mt-1 text-warm-gray">
            Видео привязано к неизвестному UUID упражнения. Snapshot не изменён. Подтвердите
            сопоставление вручную.
          </p>
        </div>
      ) : null}

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
              {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {MEDIA_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setMedia(chip.id)}
            className={`rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-widest ${
              media === chip.id
                ? "border-gold bg-gold/15 text-gold"
                : "border-gold/20 text-warm-gray hover:border-gold/50 hover:text-ivory"
            }`}
          >
            {chip.label}
            <span className="ml-1 text-ivory/70">
              {chip.id === "all" ? (report?.all ?? items.length) : countFor(chip.id)}
            </span>
          </button>
        ))}
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
                {e.gif_url || e.video_url ? (
                  <ExerciseMedia
                    url={e.gif_url || e.video_url}
                    video={normalizeExerciseVideo(e)}
                    alt={e.name}
                    fallbackText={e.video_fallback_text}
                    className="h-full w-full object-contain"
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
                      {CATEGORY_LABEL[e.category as keyof typeof CATEGORY_LABEL] ?? e.category} ·{" "}
                      {DIFFICULTY_LABEL[e.difficulty] ?? e.difficulty}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(e.gif_url || e.video_url) && (
                      <button
                        onClick={() => downloadMedia(e.gif_url ?? e.video_url!, e.slug)}
                        className="rounded-full p-1.5 text-warm-gray hover:bg-gold/15 hover:text-gold"
                        aria-label="Скачать медиа"
                        title="Скачать медиа"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    {e.archived_at ? (
                      <button
                        onClick={() => void restore(e.id)}
                        className="rounded-full p-1.5 text-warm-gray hover:bg-gold/15 hover:text-gold"
                        aria-label="Восстановить"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => remove(e.id)}
                        className="rounded-full p-1.5 text-warm-gray hover:bg-coral/15 hover:text-coral"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-warm-gray">
                  {e.default_sets}×{e.default_reps} · отдых {e.rest_seconds}с
                </div>
                <div className="text-[11px] text-warm-gray">
                  {PROVIDER_LABEL[String(e.video_provider ?? "none")] ?? e.video_provider} ·{" "}
                  {STATUS_LABEL[String(e.video_status ?? "unchecked")] ?? e.video_status} · в
                  опубликованных: {e.publishedUseCount ?? 0}
                  {e.archived_at ? " · в архиве" : ""}
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
                    {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
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
                    {DIFFICULTY_LABEL[c] ?? c}
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
              disableStorage={localLinks}
            />
            <div className="md:col-span-2 space-y-4 rounded-2xl border border-gold/15 p-4">
              <div className="text-[11px] uppercase tracking-widest text-gold">
                Видео упражнения
              </div>
              <Field label="Ссылка на видео (YouTube, Rutube или https)">
                <div className="flex gap-2">
                  <input
                    value={editing.video_url ?? ""}
                    onChange={(e) => setEditing({ ...editing, video_url: e.target.value || null })}
                    placeholder="https://youtu.be/… или https://rutube.ru/video/…"
                    className={inp}
                  />
                  <button
                    type="button"
                    onClick={() => void clearVideo()}
                    className="rounded-xl border border-gold/20 px-3 text-xs uppercase tracking-widest text-warm-gray hover:text-ivory"
                  >
                    Удалить ссылку
                  </button>
                </div>
                {editing.video_url ? (
                  <p className="mt-1 text-[11px] text-warm-gray">
                    Провайдер после сохранения:{" "}
                    {normalizeExerciseVideo({ url: editing.video_url }).provider}
                  </p>
                ) : null}
              </Field>
              <Field label="Название">
                <input
                  value={editing.video_title ?? ""}
                  onChange={(e) => setEditing({ ...editing, video_title: e.target.value || null })}
                  className={inp}
                />
              </Field>
              <Field label="Fallback-текст">
                <textarea
                  value={editing.video_fallback_text ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, video_fallback_text: e.target.value || null })
                  }
                  className={`${inp} min-h-[80px]`}
                />
              </Field>
              <Field label="Статус">
                <select
                  value={editing.video_status ?? "unchecked"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      video_status: e.target.value as ExerciseVideoStatus,
                    })
                  }
                  className={inp}
                >
                  <option value="ok">Рабочая ссылка</option>
                  <option value="unchecked">Не проверено</option>
                  <option value="unavailable">Недоступно</option>
                </select>
              </Field>
              {previewVideo?.url || editing.gif_url ? (
                <div className="overflow-hidden rounded-xl border border-gold/20 bg-background/40">
                  <ExerciseMedia
                    url={editing.gif_url || editing.video_url}
                    video={previewVideo ?? undefined}
                    alt={editing.name}
                    fallbackText={editing.video_fallback_text}
                    className="aspect-video w-full object-contain"
                  />
                </div>
              ) : (
                <p className="text-xs text-warm-gray">
                  Предпросмотр появится после ссылки. Сохранение упражнения без видео разрешено.
                </p>
              )}
              <button
                type="button"
                onClick={() => void saveVideo()}
                className="rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
              >
                Сохранить
              </button>
            </div>
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
