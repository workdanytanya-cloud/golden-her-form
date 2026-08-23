import { useMemo, useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Play,
  Plus,
  Replace,
  Save,
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
import { WEEK_PROGRESS_LABELS } from "@/lib/coach-sheet-program";
import { getVideoEmbedUrl, isDirectVideoFile } from "@/lib/video-embed";
import { WorkoutFeedbackDialog } from "@/components/panel/WorkoutFeedbackDialog";
import { SubstituteSuggestions } from "@/components/panel/SubstituteSuggestions";

type SectionKey = "warmup" | "exercises" | "cooldown";

type OpenExerciseRef = {
  section: SectionKey;
  index: number;
  set: ExerciseSet;
};

function buildDayExerciseSequence(
  day: ProgramDay,
  exById: Record<string, Exercise>,
): OpenExerciseRef[] {
  const sections: SectionKey[] = ["warmup", "exercises", "cooldown"];
  const result: OpenExerciseRef[] = [];
  for (const section of sections) {
    for (let index = 0; index < day[section].length; index++) {
      const set = day[section][index];
      if (exById[set.exercise_id]) result.push({ section, index, set });
    }
  }
  return result;
}

type Props = {
  exercises: Exercise[];
  days: ProgramDay[];
  goal: ProgramGoal;
  level: string;
  sessionsPerWeek: number;
  programWeeks?: number;
  notes: string | null;
  faq: FaqItem[];
  editable: boolean;
  /** В админке: правки в черновик, сохранение по кнопке */
  manualSave?: boolean;
  dirtyDayKeys?: Set<string>;
  savingDayKey?: string | null;
  onSaveDay?: (weekIndex: number, dayIndex: number) => Promise<void>;
  onDayPatch?: (weekIndex: number, dayIndex: number, patch: Partial<ProgramDay>) => Promise<void>;
  onProgramPatch?: (patch: { notes?: string | null; faq?: FaqItem[] }) => Promise<void>;
  onRegenerate?: () => Promise<void>;
  onProgramReload?: () => void;
  /** Клиентский режим: feedback после завершения тренировки */
  userId?: string;
  programId?: string;
  enableWorkoutFeedback?: boolean;
};

export function TrainingView({
  exercises,
  days,
  goal,
  level,
  sessionsPerWeek,
  programWeeks = 1,
  notes,
  faq,
  editable,
  manualSave = false,
  dirtyDayKeys,
  savingDayKey = null,
  onSaveDay,
  onDayPatch,
  onProgramPatch,
  onRegenerate,
  onProgramReload,
  userId,
  programId,
  enableWorkoutFeedback = false,
}: Props) {
  const exById = useMemo(() => {
    const m: Record<string, Exercise> = {};
    for (const e of exercises) m[e.id] = e;
    return m;
  }, [exercises]);

  const normalizedDays = useMemo(
    () =>
      days.map((d) => ({
        ...d,
        week_index: Number(d.week_index ?? 0),
      })),
    [days],
  );

  const multiWeek =
    programWeeks > 1 && normalizedDays.some((d) => d.week_index > 0);

  const maxWeek = multiWeek
    ? Math.max(...normalizedDays.map((d) => d.week_index))
    : 0;

  const [weekIndex, setWeekIndex] = useState(0);
  const weekDays = useMemo(() => {
    if (!multiWeek) return normalizedDays;
    return normalizedDays.filter((d) => d.week_index === weekIndex);
  }, [normalizedDays, weekIndex, multiWeek]);

  const [dayIndex, setDayIndex] = useState(() => {
    const first = weekDays.find((d) => !d.is_rest);
    return first?.day_index ?? 0;
  });

  // Только при смене недели — не сбрасывать день после правок упражнений
  useEffect(() => {
    setDayIndex((current) => {
      if (weekDays.some((d) => d.day_index === current)) return current;
      const first = weekDays.find((d) => !d.is_rest);
      return first?.day_index ?? 0;
    });
  }, [weekIndex]);

  const day =
    weekDays.find((d) => d.day_index === dayIndex) ??
    weekDays.find((d) => !d.is_rest) ??
    weekDays[0];

  const currentDayKey = day ? `${weekIndex}:${day.day_index}` : "";
  const isDayDirty = Boolean(manualSave && dirtyDayKeys?.has(currentDayKey));
  const isSavingDay = savingDayKey === currentDayKey;

  const patchDay = (patch: Partial<ProgramDay>) =>
    day ? onDayPatch?.(weekIndex, day.day_index, patch) ?? Promise.resolve() : Promise.resolve();

  const editToast = (msg: string) => {
    if (manualSave) toast.message(msg, { description: "Нажмите «Сохранить» для этого дня" });
    else toast.success(msg);
  };

  const [openExercise, setOpenExercise] = useState<OpenExerciseRef | null>(null);
  const [workoutFeedbackOpen, setWorkoutFeedbackOpen] = useState(false);

  const exerciseSequence = useMemo(
    () => (day ? buildDayExerciseSequence(day, exById) : []),
    [day, exById],
  );

  const openExerciseIndex = openExercise
    ? exerciseSequence.findIndex(
        (item) => item.section === openExercise.section && item.index === openExercise.index,
      )
    : -1;
  const prevExercise =
    openExerciseIndex > 0 ? exerciseSequence[openExerciseIndex - 1] : null;
  const nextExercise =
    openExerciseIndex >= 0 && openExerciseIndex < exerciseSequence.length - 1
      ? exerciseSequence[openExerciseIndex + 1]
      : null;

  const workoutExerciseOptions = useMemo(
    () =>
      exerciseSequence.map((item) => {
        const ex = exById[item.set.exercise_id];
        return {
          id: item.set.exercise_id,
          name: ex?.name ?? "Упражнение",
          section: item.section,
          setIndex: item.index,
        };
      }),
    [exerciseSequence, exById],
  );

  const openApplyContext = openExercise
    ? {
        weekIndex,
        dayIndex,
        section: openExercise.section,
        setIndex: openExercise.index,
      }
    : undefined;

  const handleWorkoutComplete = () => {
    setOpenExercise(null);
    if (enableWorkoutFeedback && userId && day && !day.is_rest) {
      setWorkoutFeedbackOpen(true);
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-6">
      {/* Overview */}
      <section className="rounded-3xl border border-gold/15 bg-gradient-to-br from-gold/10 via-transparent to-coral/10 p-6">
        <p className="text-[11px] uppercase tracking-widest text-gold">Программа тренировок</p>
        <h2 className="mt-1 font-display text-2xl text-ivory md:text-3xl">
          {GOAL_LABEL[goal]} · {sessionsPerWeek} тренировки в неделю
          {maxWeek > 0 && (
            <span className="text-warm-gray"> · цикл {maxWeek + 1} нед.</span>
          )}
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

      {/* Week cycle tabs — только если в базе реально несколько недель */}
      {multiWeek && maxWeek > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: maxWeek + 1 }, (_, w) => {
              const label = WEEK_PROGRESS_LABELS[w];
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeekIndex(w)}
                  className={[
                    "rounded-full border px-4 py-2 text-xs uppercase tracking-widest transition-colors",
                    weekIndex === w
                      ? "border-gold/60 bg-gold/15 text-ivory"
                      : "border-gold/20 text-warm-gray hover:border-gold/40 hover:text-ivory",
                  ].join(" ")}
                >
                  {label?.short ?? `Неделя ${w + 1}`}
                  {label?.title ? (
                    <span className="ml-1.5 hidden font-normal normal-case tracking-normal opacity-70 sm:inline">
                      · {label.title}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {WEEK_PROGRESS_LABELS[weekIndex] && (
            <p className="text-xs text-warm-gray">{WEEK_PROGRESS_LABELS[weekIndex].focus}</p>
          )}
        </div>
      )}

      {/* Week tabs + save (admin) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
        {WEEKDAY_LABELS.map((label, i) => {
          const d = weekDays.find((x) => x.day_index === i);
          const rest = d?.is_rest;
          const active = i === dayIndex;
          const tabKey = d ? `${weekIndex}:${d.day_index}` : "";
          const tabDirty = manualSave && dirtyDayKeys?.has(tabKey);
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
                tabDirty ? "border-coral/50" : "",
              ].join(" ")}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.slice(0, 2)}</span>
              {rest && <span className="ml-1 text-[9px] opacity-70">отдых</span>}
              {tabDirty && <span className="ml-1 text-[9px] text-coral">•</span>}
            </button>
          );
        })}
        </div>
        {editable && manualSave && day && onSaveDay && (
          <button
            type="button"
            disabled={!isDayDirty || isSavingDay}
            onClick={() => void onSaveDay(weekIndex, day.day_index)}
            className={[
              "inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              isDayDirty
                ? "bg-gradient-to-r from-coral to-gold text-background"
                : "border border-gold/25 text-warm-gray",
            ].join(" ")}
          >
            <Save className="h-3.5 w-3.5" />
            {isSavingDay ? "Сохраняем…" : "Сохранить"}
          </button>
        )}
      </div>

      {editable && manualSave && isDayDirty && (
        <p className="text-xs text-coral">Есть несохранённые изменения на этом дне</p>
      )}

      {/* Day content */}
      {day ? (
        <DaySection
          day={day}
          exById={exById}
          allExercises={exercises}
          editable={editable}
          manualSave={manualSave}
          onPatch={patchDay}
          onEditToast={editToast}
          onOpen={(section, index, set) => setOpenExercise({ section, index, set })}
        />
      ) : (
        <div className="rounded-3xl border border-coral/30 bg-coral/10 p-8 text-center">
          <p className="font-display text-lg text-ivory">Тренировки на этот день не загружены</p>
          <p className="mt-3 text-sm text-warm-gray">
            {editable
              ? days.length === 0
                ? "В базе нет дней программы — примените программу в блоке «Параметры программы» выше."
                : "Выберите другую неделю или день. Если проблема повторяется — пересохраните программу."
              : days.length === 0
                ? "Тренер ещё не назначил тренировки. Напишите в чат или дождитесь уведомления."
                : "Выберите другой день недели."}
          </p>
        </div>
      )}

      {openExercise && exById[openExercise.set.exercise_id] && (
        <ExerciseDialog
          exercise={exById[openExercise.set.exercise_id]}
          set={openExercise.set}
          allExercises={exercises}
          editable={editable}
          sequenceLabel={
            exerciseSequence.length > 1
              ? `${openExerciseIndex + 1} из ${exerciseSequence.length}`
              : undefined
          }
          nextExerciseName={
            nextExercise ? exById[nextExercise.set.exercise_id]?.name : undefined
          }
          onPrev={prevExercise ? () => setOpenExercise(prevExercise) : undefined}
          onNext={nextExercise ? () => setOpenExercise(nextExercise) : undefined}
          onWorkoutComplete={
            !nextExercise && enableWorkoutFeedback ? handleWorkoutComplete : undefined
          }
          onClose={() => setOpenExercise(null)}
          substituteUserId={userId}
          substituteApplyContext={openApplyContext}
          onSubstituteApplied={onProgramReload}
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
              await patchDay({
                [openExercise.section]: arr,
              } as Partial<ProgramDay>);
            }
            setOpenExercise(null);
            editToast("Упражнение заменено");
          }}
          onSetPatch={async (patch) => {
            if (!day) return;
            const arr = [...day[openExercise.section]];
            arr[openExercise.index] = { ...arr[openExercise.index], ...patch };
            await patchDay({
              [openExercise.section]: arr,
            } as Partial<ProgramDay>);
            setOpenExercise((s) => (s ? { ...s, set: { ...s.set, ...patch } } : null));
            editToast("Параметры обновлены");
          }}
        />
      )}

      {workoutFeedbackOpen && userId && day && (
        <WorkoutFeedbackDialog
          open={workoutFeedbackOpen}
          onClose={() => setWorkoutFeedbackOpen(false)}
          userId={userId}
          programId={programId}
          weekIndex={weekIndex}
          dayIndex={day.day_index}
          dayTitle={day.title}
          exercises={workoutExerciseOptions}
          onSubstituteApplied={onProgramReload}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
  manualSave = false,
  onPatch,
  onEditToast,
  onOpen,
}: {
  day: ProgramDay;
  exById: Record<string, Exercise>;
  allExercises: Exercise[];
  editable: boolean;
  manualSave?: boolean;
  onPatch: (patch: Partial<ProgramDay>) => Promise<void>;
  onEditToast: (msg: string) => void;
  onOpen: (section: SectionKey, index: number, set: ExerciseSet) => void;
}) {
  if (day.is_rest) {
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center">
        <p className="eyebrow">День отдыха</p>
        <h3 className="mt-2 font-display text-2xl text-ivory">{day.title}</h3>
        <p className="mt-3 mx-auto max-w-xl text-sm text-warm-gray">{day.description}</p>
        {editable && (
          <button
            type="button"
            onClick={() =>
              void onPatch({
                is_rest: false,
                title: "Тренировка",
                focus: "Силовая",
                description: "Добавьте упражнения в разминку, основную часть и заминку.",
                warmup: [],
                exercises: [],
                cooldown: [],
              }).then(() => onEditToast("День стал тренировочным"))
            }
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background"
          >
            <Dumbbell className="h-3.5 w-3.5" /> Сделать тренировочным днём
          </button>
        )}
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
          {editable && (
            <button
              type="button"
              onClick={() =>
                void onPatch({
                  is_rest: true,
                  title: "Отдых",
                  focus: "Восстановление",
                  description: "День восстановления. Лёгкая прогулка и сон.",
                  warmup: [],
                  exercises: [],
                  cooldown: [],
                }).then(() => onEditToast("День отмечен как отдых"))
              }
              className="shrink-0 rounded-full border border-gold/30 px-3 py-1.5 text-[10px] uppercase tracking-widest text-warm-gray hover:border-coral/40 hover:text-coral"
            >
              Сделать днём отдыха
            </button>
          )}
        </div>
      </div>

      <SectionBlock
        label="Разминка"
        eyebrow="Готовим тело"
        sets={day.warmup}
        exById={exById}
        allExercises={allExercises}
        editable={editable}
        onEditToast={onEditToast}
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
        onEditToast={onEditToast}
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
        onEditToast={onEditToast}
        onChange={(next) => onPatch({ cooldown: next })}
        onOpen={(i, set) => onOpen("cooldown", i, set)}
      />

      {/* Day note */}
      <DayNote
        note={day.day_note ?? ""}
        editable={editable}
        manualSave={manualSave}
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
  onEditToast,
  onChange,
  onOpen,
}: {
  label: string;
  eyebrow: string;
  sets: ExerciseSet[];
  exById: Record<string, Exercise>;
  allExercises: Exercise[];
  editable: boolean;
  onEditToast: (msg: string) => void;
  onChange: (next: ExerciseSet[]) => Promise<void>;
  onOpen: (index: number, set: ExerciseSet) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-gold/15 bg-surface/40 p-4 sm:p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-gold">{eyebrow}</p>
          <h4 className="mt-1 font-display text-base text-ivory md:text-lg">{label}</h4>
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
                className="group flex w-full min-w-0 max-w-full items-start gap-2 overflow-hidden rounded-2xl border border-gold/10 bg-background/30 p-2.5 transition-colors hover:border-gold/30 md:items-center md:gap-3 md:p-3"
              >
                <button
                  type="button"
                  onClick={() => onOpen(i, s)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex min-w-0 items-start gap-2.5 md:gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gold/10 text-gold md:h-12 md:w-12 md:rounded-xl lg:h-14 lg:w-14">
                    {e.gif_url ? (
                      isDirectVideoFile(e.gif_url) ? (
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
                      <ImageIcon className="h-4 w-4 opacity-60 md:h-5 md:w-5" />
                    )}
                  </div>
                  <div className="w-0 min-w-0 flex-1 overflow-hidden">
                    <p className="break-words text-xs font-medium leading-tight text-ivory md:text-sm lg:font-display lg:text-base lg:leading-snug [overflow-wrap:anywhere]">
                      {e.name}
                    </p>
                    <p className="mt-0.5 break-words text-[10px] leading-relaxed text-warm-gray md:text-[11px]">
                      {CATEGORY_LABEL[e.category]} ·{" "}
                      {e.muscle_groups.slice(0, 2).join(" · ") || "—"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 md:hidden">
                      <span className="text-[11px] font-medium tabular-nums text-ivory">
                        {s.sets}×{s.reps}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-warm-gray">
                        <Timer className="h-2.5 w-2.5 shrink-0" /> {s.rest_seconds}с
                      </span>
                      {s.tempo && s.tempo !== "iso" && (
                        <span className="text-[9px] uppercase tracking-widest text-warm-gray">
                          темп {s.tempo}
                        </span>
                      )}
                    </div>
                    {s.note && (
                      <p className="mt-1 inline-flex max-w-full items-start gap-1 rounded-md bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                        <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />{" "}
                        <span className="break-words">{s.note}</span>
                      </p>
                    )}
                  </div>
                  </div>
                </button>
                <div className="hidden min-w-0 max-w-[9.5rem] shrink-0 items-start gap-2 pr-1 text-right md:flex">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium tabular-nums leading-snug text-ivory">
                      {s.sets}
                      <span className="text-warm-gray">×</span>
                      {s.reps}
                    </p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-widest text-warm-gray">
                      подходы×повт.
                    </p>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <p className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-warm-gray">
                      <Timer className="h-2.5 w-2.5 shrink-0" /> {s.rest_seconds}с
                    </p>
                    {s.tempo && s.tempo !== "iso" && (
                      <p className="text-[10px] uppercase tracking-widest text-warm-gray">
                        темп {s.tempo}
                      </p>
                    )}
                  </div>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = sets.filter((_, j) => j !== i);
                      await onChange(next);
                      onEditToast("Удалено");
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
            onEditToast("Добавлено");
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
          className="min-w-0 flex-1 basis-full rounded-lg border border-gold/15 bg-background/60 px-3 py-2 text-sm text-ivory sm:min-w-[180px] sm:basis-auto"
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
            className="flex w-full min-w-0 items-center justify-between gap-3 border-b border-gold/10 px-3 py-2 text-left text-sm hover:bg-gold/5"
          >
            <span className="min-w-0 flex-1 break-words text-ivory">{e.name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-widest text-warm-gray">
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
  manualSave = false,
  onSave,
}: {
  note: string;
  editable: boolean;
  manualSave?: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [value, setValue] = useState(note);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(note);
  }, [note]);

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
            onChange={(e) => {
              setValue(e.target.value);
              if (manualSave) void onSave(e.target.value);
            }}
            rows={2}
            className="mt-2 w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
            placeholder="Например: сегодня работаем на технику, вес субмаксимальный"
          />
          {!manualSave && (
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
          )}
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
  sequenceLabel,
  nextExerciseName,
  onPrev,
  onNext,
  onWorkoutComplete,
  onClose,
  substituteUserId,
  substituteApplyContext,
  onSubstituteApplied,
  onSwap,
  onSetPatch,
}: {
  exercise: Exercise;
  set: ExerciseSet;
  allExercises: Exercise[];
  editable: boolean;
  sequenceLabel?: string;
  nextExerciseName?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onWorkoutComplete?: () => void;
  onClose: () => void;
  substituteUserId?: string;
  substituteApplyContext?: {
    weekIndex: number;
    dayIndex: number;
    section: "warmup" | "exercises" | "cooldown";
    setIndex: number;
  };
  onSubstituteApplied?: () => void;
  onSwap: (id: string) => Promise<void>;
  onSetPatch: (patch: Partial<ExerciseSet>) => Promise<void>;
}) {
  const [tab, setTab] = useState<"technique" | "adjust" | "swap">("technique");
  const [sets, setSets] = useState(set.sets);
  const [reps, setReps] = useState(set.reps);
  const [rest, setRest] = useState(set.rest_seconds);
  const [note, setNote] = useState(set.note ?? "");
  const contentRef = useRef<HTMLDivElement>(null);

  const replacements = useMemo(
    () => allExercises.filter((e) => e.category === exercise.category && e.id !== exercise.id),
    [exercise, allExercises],
  );

  useEffect(() => {
    setTab("technique");
    setSets(set.sets);
    setReps(set.reps);
    setRest(set.rest_seconds);
    setNote(set.note ?? "");
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [exercise.id, set]);

  const showNav = Boolean(sequenceLabel || onPrev || onNext);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        ref={contentRef}
        className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col overflow-y-auto bg-background p-0 text-ivory"
      >
        <div className="space-y-4 p-6 pb-0">
        <DialogHeader>
          <DialogTitle className="break-words font-display text-xl sm:text-2xl">{exercise.name}</DialogTitle>
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
            <span className="min-w-0 break-words">
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

        <div className="flex flex-wrap gap-1 border-b border-gold/15">
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
          <div className="space-y-3">
            {substituteUserId && (
              <SubstituteSuggestions
                userId={substituteUserId}
                exerciseId={exercise.id}
                exerciseName={exercise.name}
                reason="preference"
                applyContext={substituteApplyContext}
                onApplied={onSubstituteApplied}
              />
            )}
            <p className="text-xs text-warm-gray">
              Замены в той же категории. КБЖУ дня не завязано на упражнения — заменяем свободно.
            </p>
            {replacements.slice(0, 12).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => void onSwap(e.id)}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-gold/15 bg-surface/40 p-3 text-left hover:border-gold/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-ivory">{e.name}</p>
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
        </div>

        {showNav && (
          <div className="sticky bottom-0 mt-4 border-t border-gold/15 bg-background/95 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              {onPrev ? (
                <button
                  type="button"
                  onClick={onPrev}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/25 px-3 py-2 text-[11px] uppercase tracking-widest text-warm-gray transition-colors hover:border-gold/40 hover:text-ivory"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Назад
                </button>
              ) : (
                <div className="w-[88px] shrink-0" />
              )}

              {sequenceLabel && (
                <p className="flex-1 text-center text-[11px] uppercase tracking-widest text-warm-gray">
                  {sequenceLabel}
                </p>
              )}

              {onNext ? (
                <button
                  type="button"
                  onClick={onNext}
                  className="inline-flex min-w-0 max-w-[52%] shrink-0 flex-col items-end rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-right transition-opacity hover:opacity-90"
                >
                  <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-background">
                    Дальше
                    <ChevronRight className="h-4 w-4" />
                  </span>
                  {nextExerciseName && (
                    <span className="mt-0.5 max-w-full truncate text-[10px] normal-case tracking-normal text-background/85">
                      {nextExerciseName}
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onWorkoutComplete ?? onClose}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-[11px] uppercase tracking-widest text-background transition-opacity hover:opacity-90"
                >
                  Готово
                </button>
              )}
            </div>
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
  const [zoom, setZoom] = useState(false);
  const [failed, setFailed] = useState(false);
  const embedUrl = url && !isDirectVideoFile(url) ? getVideoEmbedUrl(url) : null;
  const isFile = url ? isDirectVideoFile(url) : false;

  useEffect(() => {
    setFailed(false);
  }, [url]);

  // Если iframe/файл «висит» — через 20с показываем ссылку открыть снаружи
  useEffect(() => {
    if (!url || failed || isFile) return;
    const t = window.setTimeout(() => setFailed(true), 20000);
    return () => window.clearTimeout(t);
  }, [url, failed, isFile]);

  const fallbackLink = url ? (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
      {placeholder}
      <p className="text-xs text-warm-gray">Видео не загрузилось в плеере</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-gold hover:bg-gold/20"
      >
        Открыть видео
      </a>
    </div>
  ) : null;

  const media = (() => {
    if (!url) return null;
    if (failed) return fallbackLink;
    // Свои mp4 всегда приоритетнее внешних embed (YouTube/Rutube)
    if (isFile) {
      return (
        <video
          src={url}
          autoPlay={!isVideo}
          loop={!isVideo}
          muted={!isVideo}
          playsInline
          controls={!!isVideo}
          preload="metadata"
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
          onLoadedData={() => setFailed(false)}
        />
      );
    }
    if (embedUrl) {
      return (
        <iframe
          src={embedUrl}
          title={label}
          className="h-full w-full border-0"
          allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; web-share;"
          allowFullScreen
          onLoad={() => setFailed(false)}
        />
      );
    }
    if (isVideo) return fallbackLink;
    return <img src={url} alt={label} className="h-full w-full object-contain" />;
  })();

  const zoomMedia = (() => {
    if (!url) return null;
    if (failed) return fallbackLink;
    if (isFile) {
      return (
        <video
          src={url}
          autoPlay
          loop={!isVideo}
          muted={!isVideo}
          playsInline
          controls
          preload="metadata"
          className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
          onError={() => setFailed(true)}
        />
      );
    }
    if (embedUrl) {
      return (
        <iframe
          src={embedUrl}
          title={label}
          className="aspect-video w-full max-h-[90vh] rounded-2xl border-0"
          allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; web-share;"
          allowFullScreen
        />
      );
    }
    return (
      <img
        src={url}
        alt={label}
        className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
      />
    );
  })();

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-gold/15 bg-surface/40">
        <div className="relative flex aspect-video items-center justify-center bg-background/60 text-warm-gray">
          {url ? (
            <>
              {media}
              <button
                type="button"
                onClick={() => setZoom(true)}
                aria-label="Открыть на весь экран"
                className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-gold/30 bg-background/70 px-2.5 py-1 text-[10px] uppercase tracking-widest text-ivory backdrop-blur transition-colors hover:bg-gold/20"
              >
                <Maximize2 className="h-3 w-3" /> На весь экран
              </button>
            </>
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

      {zoom && url && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setZoom(false)}
            aria-label="Закрыть"
            className="absolute right-3 top-3 z-10 rounded-full border border-gold/30 bg-surface/70 p-2 text-ivory hover:bg-gold/20 sm:right-5 sm:top-5"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-full w-full max-w-5xl items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {zoomMedia}
          </div>
        </div>
      )}
    </>
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
