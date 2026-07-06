import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Dumbbell,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Play,
  Plus,
  Replace,
  StickyNote,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Exercise,
  type ExerciseCategory,
  type ExerciseSet,
  type ProgramDay,
  type FaqItem,
  CATEGORY_LABEL,
  GOAL_LABEL,
  WEEKDAY_LABELS,
  type ProgramGoal,
} from "@/lib/training";

type SectionKey = "warmup" | "exercises" | "cooldown";

type Props = {
  exercises: Exercise[];
  days: ProgramDay[];
  goal: ProgramGoal;
  level: string;
  sessionsPerWeek: number;
  notes: string | null;
  faq: FaqItem[];
  editable: boolean;
  onDayPatch?: (dayIndex: number, patch: Partial<ProgramDay>) => Promise<void>;
  onProgramPatch?: (patch: { notes?: string | null; faq?: FaqItem[] }) => Promise<void>;
  onRegenerate?: () => Promise<void>;
};

export function TrainingView({
  exercises,
  days,
  goal,
  level,
  sessionsPerWeek,
  notes,
  faq,
  editable,
  onDayPatch,
  onProgramPatch,
  onRegenerate,
}: Props) {
  const exById = useMemo(() => {
    const m: Record<string, Exercise> = {};
    for (const e of exercises) m[e.id] = e;
    return m;
  }, [exercises]);

  const [dayIndex, setDayIndex] = useState(() => {
    const first = days.find((d) => !d.is_rest);
    return first?.day_index ?? 0;
  });
  const day = days.find((d) => d.day_index === dayIndex) ?? days[0];

  const [openExercise, setOpenExercise] = useState<{
    section: SectionKey;
    index: number;
    set: ExerciseSet;
  } | null>(null);

  return (
    <div className="space-y-6">
      {/* Overview */}
      <section className="rounded-3xl border border-gold/15 bg-gradient-to-br from-gold/10 via-transparent to-coral/10 p-6">
        <p className="text-[11px] uppercase tracking-widest text-gold">Программа тренировок</p>
        <h2 className="mt-1 font-display text-2xl text-ivory md:text-3xl">
          {GOAL_LABEL[goal]} · {sessionsPerWeek} тренировки в неделю
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-warm-gray">
          Программа собрана под твою цель и уровень подготовки ({levelLabel(level)}) на основе
          анкеты. Каждая тренировка — с чёткой задачей, разминкой, силовым блоком и заминкой.
          Занятия расставлены по неделе с восстановлением между ними.
        </p>
        {notes && (
          <div className="mt-4 rounded-2xl border border-gold/25 bg-background/40 p-4 text-sm">
            <p className="text-[11px] uppercase tracking-widest text-gold">Комментарий тренера</p>
            <p className="mt-1 whitespace-pre-wrap text-ivory">{notes}</p>
          </div>
        )}
        {editable && onRegenerate && (
          <button
            type="button"
            onClick={() => void onRegenerate()}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/40 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
          >
            <Dumbbell className="h-3.5 w-3.5" /> Пересобрать программу
          </button>
        )}
      </section>

      {/* FAQ */}
      <FaqSection faq={faq} editable={editable} onSave={onProgramPatch} />

      {/* Week tabs */}
      <div className="flex flex-wrap gap-2">
        {WEEKDAY_LABELS.map((label, i) => {
          const d = days.find((x) => x.day_index === i);
          const rest = d?.is_rest;
          const active = i === dayIndex;
          return (
            <button
              key={label}
              onClick={() => setDayIndex(i)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition-colors",
                active
                  ? "border-gold/60 bg-gradient-to-r from-coral/20 to-gold/15 text-ivory"
                  : rest
                    ? "border-gold/10 text-warm-gray/60 hover:text-ivory"
                    : "border-gold/20 text-warm-gray hover:text-ivory",
              ].join(" ")}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.slice(0, 2)}</span>
              {rest && <span className="ml-1 text-[9px] opacity-70">отдых</span>}
            </button>
          );
        })}
      </div>

      {/* Day content */}
      {day && (
        <DaySection
          day={day}
          exById={exById}
          allExercises={exercises}
          editable={editable}
          onPatch={(patch) => onDayPatch?.(day.day_index, patch) ?? Promise.resolve()}
          onOpen={(section, index, set) => setOpenExercise({ section, index, set })}
        />
      )}

      {openExercise && exById[openExercise.set.exercise_id] && (
        <ExerciseDialog
          exercise={exById[openExercise.set.exercise_id]}
          set={openExercise.set}
          allExercises={exercises}
          editable={editable}
          onClose={() => setOpenExercise(null)}
          onSwap={async (newId) => {
            if (!day) return;
            const arr = [...day[openExercise.section]];
            const target = arr[openExercise.index];
            if (target) {
              const newEx = exercises.find((x) => x.id === newId);
              arr[openExercise.index] = {
                ...target,
                exercise_id: newId,
                tempo: newEx?.tempo ?? target.tempo,
              };
              await onDayPatch?.(day.day_index, {
                [openExercise.section]: arr,
              } as Partial<ProgramDay>);
            }
            setOpenExercise(null);
            toast.success("Упражнение заменено");
          }}
          onSetPatch={async (patch) => {
            if (!day) return;
            const arr = [...day[openExercise.section]];
            arr[openExercise.index] = { ...arr[openExercise.index], ...patch };
            await onDayPatch?.(day.day_index, {
              [openExercise.section]: arr,
            } as Partial<ProgramDay>);
            setOpenExercise((s) => (s ? { ...s, set: { ...s.set, ...patch } } : null));
            toast.success("Сохранено");
          }}
        />
      )}
    </div>
  );
}

function levelLabel(level: string) {
  if (level === "advanced") return "продвинутый";
  if (level === "intermediate") return "средний";
  return "новичок";
}

// ------------- FAQ -------------

function FaqSection({
  faq,
  editable,
  onSave,
}: {
  faq: FaqItem[];
  editable: boolean;
  onSave?: (patch: { faq?: FaqItem[] }) => Promise<void>;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FaqItem[]>(faq);
  const [saving, setSaving] = useState(false);

  if (!faq.length && !editable) return null;

  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-gold" />
          <h3 className="font-display text-lg text-ivory">Частые вопросы</h3>
        </div>
        {editable && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(faq);
              setEditing(true);
            }}
            className="rounded-full border border-gold/20 px-3 py-1 text-[11px] uppercase tracking-widest text-warm-gray hover:text-ivory"
          >
            Редактировать
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-4 space-y-2">
          {faq.map((item, i) => (
            <div key={i} className="rounded-2xl border border-gold/10 bg-background/30">
              <button
                type="button"
                onClick={() =>
                  setOpen((cur) => {
                    const next = new Set(cur);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm text-ivory">{item.q}</span>
                {open.has(i) ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-warm-gray" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-warm-gray" />
                )}
              </button>
              {open.has(i) && (
                <p className="border-t border-gold/10 px-4 py-3 text-sm leading-relaxed text-warm-gray">
                  {item.a}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {draft.map((item, i) => (
            <div key={i} className="rounded-2xl border border-gold/15 bg-background/40 p-3">
              <input
                value={item.q}
                onChange={(e) =>
                  setDraft((d) => d.map((it, j) => (j === i ? { ...it, q: e.target.value } : it)))
                }
                className="w-full rounded-lg border border-gold/15 bg-background/60 px-3 py-2 text-sm text-ivory"
                placeholder="Вопрос"
              />
              <textarea
                rows={3}
                value={item.a}
                onChange={(e) =>
                  setDraft((d) => d.map((it, j) => (j === i ? { ...it, a: e.target.value } : it)))
                }
                className="mt-2 w-full rounded-lg border border-gold/15 bg-background/60 px-3 py-2 text-sm text-ivory"
                placeholder="Ответ"
              />
              <button
                type="button"
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-coral hover:underline"
              >
                <Trash2 className="h-3 w-3" /> Удалить
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft((d) => [...d, { q: "", a: "" }])}
            className="inline-flex items-center gap-2 rounded-full border border-gold/25 px-3 py-1.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
          >
            <Plus className="h-3 w-3" /> Добавить вопрос
          </button>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onSave?.({ faq: draft.filter((d) => d.q.trim() || d.a.trim()) });
                setSaving(false);
                setEditing(false);
                toast.success("FAQ сохранён");
              }}
              className="rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background disabled:opacity-50"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-gold/20 px-4 py-2 text-xs uppercase tracking-widest text-warm-gray hover:text-ivory"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------- Day section -------------

function DaySection({
  day,
  exById,
  allExercises,
  editable,
  onPatch,
  onOpen,
}: {
  day: ProgramDay;
  exById: Record<string, Exercise>;
  allExercises: Exercise[];
  editable: boolean;
  onPatch: (patch: Partial<ProgramDay>) => Promise<void>;
  onOpen: (section: SectionKey, index: number, set: ExerciseSet) => void;
}) {
  if (day.is_rest) {
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center">
        <p className="eyebrow">День отдыха</p>
        <h3 className="mt-2 font-display text-2xl text-ivory">{day.title}</h3>
        <p className="mt-3 mx-auto max-w-xl text-sm text-warm-gray">{day.description}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-3xl border border-gold/20 bg-gradient-to-br from-coral/10 via-transparent to-gold/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="eyebrow">{day.focus}</p>
            <h3 className="mt-1 font-display text-2xl text-ivory md:text-3xl">{day.title}</h3>
            {day.description && (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-warm-gray">
                {day.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <SectionBlock
        label="Разминка"
        eyebrow="Готовим тело"
        sets={day.warmup}
        exById={exById}
        allExercises={allExercises}
        editable={editable}
        onChange={(next) => onPatch({ warmup: next })}
        onOpen={(i, set) => onOpen("warmup", i, set)}
      />

      <SectionBlock
        label="Основная часть"
        eyebrow="Силовой блок"
        sets={day.exercises}
        exById={exById}
        allExercises={allExercises}
        editable={editable}
        onChange={(next) => onPatch({ exercises: next })}
        onOpen={(i, set) => onOpen("exercises", i, set)}
      />

      <SectionBlock
        label="Заминка"
        eyebrow="Восстановление"
        sets={day.cooldown}
        exById={exById}
        allExercises={allExercises}
        editable={editable}
        onChange={(next) => onPatch({ cooldown: next })}
        onOpen={(i, set) => onOpen("cooldown", i, set)}
      />

      {/* Day note */}
      <DayNote
        note={day.day_note ?? ""}
        editable={editable}
        onSave={(v) => onPatch({ day_note: v || null })}
      />
    </div>
  );
}

function SectionBlock({
  label,
  eyebrow,
  sets,
  exById,
  allExercises,
  editable,
  onChange,
  onOpen,
}: {
  label: string;
  eyebrow: string;
  sets: ExerciseSet[];
  exById: Record<string, Exercise>;
  allExercises: Exercise[];
  editable: boolean;
  onChange: (next: ExerciseSet[]) => Promise<void>;
  onOpen: (index: number, set: ExerciseSet) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-5 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-gold">{eyebrow}</p>
          <h4 className="mt-1 font-display text-lg text-ivory">{label}</h4>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gold/20 px-3 py-1 text-[11px] uppercase tracking-widest text-warm-gray hover:text-ivory"
          >
            <Plus className="h-3 w-3" /> Упражнение
          </button>
        )}
      </div>

      {sets.length === 0 ? (
        <p className="mt-4 text-sm text-warm-gray">Пока не задано.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {sets.map((s, i) => {
            const e = exById[s.exercise_id];
            if (!e) return null;
            return (
              <div
                key={i}
                className="group flex items-center gap-3 rounded-2xl border border-gold/10 bg-background/30 p-3 transition-colors hover:border-gold/30"
              >
                <button
                  type="button"
                  onClick={() => onOpen(i, s)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gold/10 text-gold">
                    {e.gif_url ? (
                      /\.(mp4|webm|mov|m4v)(\?|$)/i.test(e.gif_url) ? (
                        <video
                          src={e.gif_url}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <img
                          src={e.gif_url}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      )
                    ) : (
                      <ImageIcon className="h-5 w-5 opacity-60" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base text-ivory">{e.name}</p>
                    <p className="mt-0.5 text-[11px] text-warm-gray">
                      {CATEGORY_LABEL[e.category]} ·{" "}
                      {e.muscle_groups.slice(0, 2).join(" · ") || "—"}
                    </p>
                    {s.note && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                        <StickyNote className="h-3 w-3" /> {s.note}
                      </p>
                    )}
                  </div>
                </button>
                <div className="hidden shrink-0 items-center gap-4 pr-1 text-right text-xs sm:flex">
                  <div>
                    <p className="font-display text-lg text-ivory">
                      {s.sets}
                      <span className="text-warm-gray">×</span>
                      {s.reps}
                    </p>
                    <p className="text-[10px] uppercase tracking-widest text-warm-gray">
                      подходы×повт.
                    </p>
                  </div>
                  <div>
                    <p className="inline-flex items-center gap-1 text-warm-gray">
                      <Timer className="h-3 w-3" /> {s.rest_seconds}с
                    </p>
                    {s.tempo && s.tempo !== "iso" && (
                      <p className="text-[10px] uppercase tracking-widest text-warm-gray">
                        темп {s.tempo}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex sm:hidden shrink-0 flex-col items-end text-right">
                  <p className="font-display text-sm text-ivory">
                    {s.sets}×{s.reps}
                  </p>
                  <p className="text-[10px] text-warm-gray">{s.rest_seconds}с</p>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = sets.filter((_, j) => j !== i);
                      await onChange(next);
                      toast.success("Удалено");
                    }}
                    className="shrink-0 rounded-full p-2 text-warm-gray opacity-0 transition-opacity hover:bg-coral/15 hover:text-coral group-hover:opacity-100"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddExercise
          allExercises={allExercises}
          onAdd={async (id) => {
            const e = allExercises.find((x) => x.id === id);
            if (!e) return;
            await onChange([
              ...sets,
              {
                exercise_id: id,
                sets: e.default_sets,
                reps: e.default_reps,
                rest_seconds: e.rest_seconds,
                tempo: e.tempo,
              },
            ]);
            setAdding(false);
            toast.success("Добавлено");
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function AddExercise({
  allExercises,
  onAdd,
  onCancel,
}: {
  allExercises: Exercise[];
  onAdd: (id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ExerciseCategory | "all">("all");
  const filtered = allExercises.filter((e) => {
    if (cat !== "all" && e.category !== cat) return false;
    if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="mt-4 rounded-2xl border border-gold/20 bg-background/40 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск упражнения…"
          className="flex-1 min-w-[180px] rounded-lg border border-gold/15 bg-background/60 px-3 py-2 text-sm text-ivory"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as ExerciseCategory | "all")}
          className="rounded-lg border border-gold/15 bg-background/60 px-3 py-2 text-sm text-ivory"
        >
          <option value="all">Все категории</option>
          {(Object.keys(CATEGORY_LABEL) as ExerciseCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gold/15 px-3 py-2 text-xs uppercase tracking-widest text-warm-gray hover:text-ivory"
        >
          Отмена
        </button>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-gold/10">
        {filtered.slice(0, 40).map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => void onAdd(e.id)}
            className="flex w-full items-center justify-between gap-3 border-b border-gold/10 px-3 py-2 text-left text-sm hover:bg-gold/5"
          >
            <span className="text-ivory">{e.name}</span>
            <span className="text-[10px] uppercase tracking-widest text-warm-gray">
              {CATEGORY_LABEL[e.category]}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-warm-gray">Ничего не найдено</p>
        )}
      </div>
    </div>
  );
}

function DayNote({
  note,
  editable,
  onSave,
}: {
  note: string;
  editable: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [value, setValue] = useState(note);
  const [saving, setSaving] = useState(false);
  if (!editable && !note) return null;
  return (
    <div className="rounded-2xl border border-gold/15 bg-surface/30 p-4">
      <p className="text-[11px] uppercase tracking-widest text-warm-gray">
        Комментарий тренера к дню
      </p>
      {editable ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
            placeholder="Например: сегодня работаем на технику, вес субмаксимальный"
          />
          <button
            type="button"
            disabled={saving || value === note}
            onClick={async () => {
              setSaving(true);
              await onSave(value);
              setSaving(false);
              toast.success("Сохранено");
            }}
            className="mt-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-1.5 text-xs uppercase tracking-widest text-background disabled:opacity-50"
          >
            Сохранить
          </button>
        </>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ivory">{note}</p>
      )}
    </div>
  );
}

// ------------- Exercise dialog -------------

function ExerciseDialog({
  exercise,
  set,
  allExercises,
  editable,
  onClose,
  onSwap,
  onSetPatch,
}: {
  exercise: Exercise;
  set: ExerciseSet;
  allExercises: Exercise[];
  editable: boolean;
  onClose: () => void;
  onSwap: (id: string) => Promise<void>;
  onSetPatch: (patch: Partial<ExerciseSet>) => Promise<void>;
}) {
  const [tab, setTab] = useState<"technique" | "adjust" | "swap">("technique");
  const [sets, setSets] = useState(set.sets);
  const [reps, setReps] = useState(set.reps);
  const [rest, setRest] = useState(set.rest_seconds);
  const [note, setNote] = useState(set.note ?? "");

  const replacements = useMemo(
    () => allExercises.filter((e) => e.category === exercise.category && e.id !== exercise.id),
    [exercise, allExercises],
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-background text-ivory">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{exercise.name}</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] uppercase tracking-widest text-gold">
          {CATEGORY_LABEL[exercise.category]} · {exercise.muscle_groups.join(" · ")}
        </p>

        {/* Media */}
        <div className="grid gap-3 sm:grid-cols-2">
          <MediaCard
            label="Техника (GIF)"
            url={exercise.gif_url}
            placeholder={<ImageIcon className="h-10 w-10 opacity-40" />}
          />
          <MediaCard
            label="Видео с тренером"
            url={exercise.video_url}
            isVideo
            placeholder={<Play className="h-10 w-10 opacity-40" />}
          />
        </div>

        <div className="rounded-xl bg-surface/50 p-3 text-xs">
          <div className="grid grid-cols-3 gap-2 text-center text-warm-gray">
            <span>
              Подходы: <b className="text-ivory">{set.sets}</b>
            </span>
            <span>
              Повторы: <b className="text-ivory">{set.reps}</b>
            </span>
            <span>
              Отдых: <b className="text-ivory">{set.rest_seconds}с</b>
            </span>
          </div>
          {set.tempo && set.tempo !== "iso" && (
            <p className="mt-1 text-center text-[11px] text-warm-gray">
              Темп: <b className="text-ivory">{set.tempo}</b> (эксцентрика-пауза-концентрика)
            </p>
          )}
        </div>

        <div className="flex gap-1 border-b border-gold/15">
          <TabBtn active={tab === "technique"} onClick={() => setTab("technique")}>
            Техника
          </TabBtn>
          {editable && (
            <>
              <TabBtn active={tab === "adjust"} onClick={() => setTab("adjust")}>
                Подходы и повторы
              </TabBtn>
              <TabBtn active={tab === "swap"} onClick={() => setTab("swap")}>
                <Replace className="h-3.5 w-3.5" /> Замена
              </TabBtn>
            </>
          )}
        </div>

        {tab === "technique" && (
          <div className="space-y-4">
            {exercise.description && (
              <p className="text-sm leading-relaxed text-warm-gray">{exercise.description}</p>
            )}
            {exercise.cues.length > 0 && (
              <section>
                <h4 className="text-[11px] uppercase tracking-widest text-gold">Ключевые точки</h4>
                <ol className="mt-2 space-y-2 text-sm text-ivory">
                  {exercise.cues.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/25 text-[10px] font-bold">
                        {i + 1}
                      </span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {exercise.common_mistakes.length > 0 && (
              <section>
                <h4 className="text-[11px] uppercase tracking-widest text-coral">Частые ошибки</h4>
                <ul className="mt-2 space-y-1 text-sm text-warm-gray">
                  {exercise.common_mistakes.map((m, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {tab === "adjust" && editable && (
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label="Подходы" value={sets} onChange={setSets} min={1} max={10} />
            <TextField label="Повторы" value={reps} onChange={setReps} placeholder="10-12" />
            <NumField
              label="Отдых, сек"
              value={rest}
              onChange={setRest}
              min={0}
              max={300}
              step={5}
            />
            <div className="sm:col-span-3">
              <label className="text-[11px] uppercase tracking-widest text-warm-gray">
                Заметка клиенту
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
                placeholder="Например: работаем субмаксимально, техника важнее веса"
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() =>
                  void onSetPatch({ sets, reps, rest_seconds: rest, note: note || null })
                }
                className="rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background"
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        {tab === "swap" && editable && (
          <div className="space-y-2">
            <p className="text-xs text-warm-gray">
              Замены в той же категории. КБЖУ дня не завязано на упражнения — заменяем свободно.
            </p>
            {replacements.slice(0, 12).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => void onSwap(e.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gold/15 bg-surface/40 p-3 text-left hover:border-gold/40"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ivory">{e.name}</p>
                  <p className="text-[11px] text-warm-gray">
                    {e.muscle_groups.slice(0, 3).join(" · ")} ·{" "}
                    {e.equipment.length ? e.equipment.join(", ") : "без инвентаря"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-gradient-to-r from-coral to-gold px-3 py-1 text-[10px] uppercase tracking-widest text-background">
                  Заменить
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs uppercase tracking-widest transition-colors",
        active ? "border-gold text-ivory" : "border-transparent text-warm-gray hover:text-ivory",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function MediaCard({
  label,
  url,
  isVideo,
  placeholder,
}: {
  label: string;
  url: string | null;
  isVideo?: boolean;
  placeholder: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gold/15 bg-surface/40">
      <div className="flex aspect-video items-center justify-center bg-background/60 text-warm-gray">
        {url ? (
          isVideo ? (
            <video src={url} controls className="h-full w-full object-contain" />
          ) : /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? (
            <video
              src={url}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <img src={url} alt={label} className="h-full w-full object-contain" />
          )
        ) : (
          <div className="flex flex-col items-center gap-2 text-warm-gray">
            {placeholder}
            <span className="text-[10px] uppercase tracking-widest">будет добавлено</span>
          </div>
        )}
      </div>
      <p className="border-t border-gold/10 px-3 py-2 text-[10px] uppercase tracking-widest text-warm-gray">
        {label}
      </p>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
      />
    </label>
  );
}
