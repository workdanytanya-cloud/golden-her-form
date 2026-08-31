import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { TrainingView } from "@/components/panel/TrainingView";
import { supabase } from "@/integrations/supabase/client";
import {
  loadExercises,
  loadProgramFor,
  loadProgramProfile,
  createOrReplaceCustomProgram,
  updateDayPatch,
  updateProgramPatch,
  lockProgramManual,
  type ProgramRow,
  type DayRow,
  type Exercise,
} from "@/lib/training-repo";
import {
  type ProgramDay,
  type ProgramGoal,
  type ProgramLevel,
  type ProgramInput,
  type FaqItem,
  GOAL_LABEL,
} from "@/lib/training";
import {
  buildCoachSheetProgramDays,
  coachProgramNotes,
  COACH_PROGRAM_WEEKS,
  missingCoachSheetExercises,
  resolveDefaultTrainingProgram,
} from "@/lib/coach-sheet-program";
import { loadPublishedTrainingFor, publishTrainingProgram } from "@/lib/published-programs/repo";

export const Route = createFileRoute("/_authenticated/admin/clients/$id/training")({
  component: AdminTrainingPage,
  validateSearch: (search: Record<string, unknown>) => ({
    course: typeof search.course === "string" ? search.course : undefined,
  }),
});

function dayKey(weekIndex: number, dayIndex: number) {
  return `${weekIndex}:${dayIndex}`;
}

function AdminTrainingPage() {
  const { id } = Route.useParams();
  const { course: courseId } = Route.useSearch();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [profileName, setProfileName] = useState<string>("");
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [profile, setProfile] = useState<{
    sessions_per_week: 3 | 4;
    goal: ProgramGoal;
    level: ProgramLevel;
    has_injuries: boolean;
    injuries_details: string | null;
    equipment: string[];
    location: string | null;
    weight_kg: number | null;
    gender: "female" | "male" | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirtyDays, setDirtyDays] = useState<Set<string>>(() => new Set());
  const [savingDayKey, setSavingDayKey] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const [ex, p, prof, profRow, published] = await Promise.all([
      loadExercises(),
      loadProgramFor(id, courseId),
      loadProgramProfile(id),
      supabase.from("profiles").select("full_name").eq("id", id).maybeSingle(),
      loadPublishedTrainingFor(id, courseId),
    ]);
    setExercises(ex);
    setProgram(p.program);
    setDays(p.days);
    setDirtyDays(new Set());
    setPublishedVersion(published?.version?.version ?? null);
    setProfile({
      sessions_per_week: prof.sessions_per_week,
      goal: prof.goal,
      level: prof.level,
      has_injuries: prof.has_injuries,
      injuries_details: prof.injuries_details,
      equipment: prof.equipment,
      location: prof.location,
      weight_kg: prof.weight_kg,
      gender: prof.gender,
    });
    setProfileName(profRow.data?.full_name ?? "Клиент");
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleRegenerate = async (overrides?: Partial<ProgramInput>) => {
    if (!profile) return;
    const input: ProgramInput = {
      sessions_per_week: profile.sessions_per_week,
      goal: profile.goal,
      level: profile.level,
      has_injuries: profile.has_injuries,
      injuries_details: profile.injuries_details,
      equipment: profile.equipment,
      location: profile.location,
      weight_kg: profile.weight_kg,
      gender: profile.gender,
      ...overrides,
    };
    try {
      // 4 недели + прогрессия; не схлопываем в 1 неделю.
      const plan = resolveDefaultTrainingProgram(exercises, input);
      const result = await createOrReplaceCustomProgram({
        userId: id,
        input,
        days: plan.days,
        programWeeks: plan.programWeeks,
        notes: program?.notes ?? plan.coachNotes,
        preserveFaq: program?.faq ?? null,
        targetsManual: true,
      });
      await reload();
      if (result.multiWeek) {
        toast.success(
          `Черновик на ${plan.programWeeks} нед. сохранён. Клиент увидит после «Опубликовать клиенту».`,
        );
      } else {
        toast.warning(
          "Сохранена только 1-я неделя. Выполните SQL supabase/production-enable-4weeks-and-trainer-gender.sql в Supabase и пересоберите.",
          { duration: 15000 },
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handlePublishToClient = async () => {
    if (!profile || !program || days.length === 0) return;
    setPublishing(true);
    try {
      const input: ProgramInput = {
        sessions_per_week: program.sessions_per_week as 3 | 4,
        goal: (program.goal as ProgramGoal) ?? profile.goal,
        level: (program.level as ProgramLevel) ?? profile.level,
        has_injuries: program.has_injuries,
        injuries_details: program.injuries_details,
        equipment: program.equipment,
        location: program.location,
        weight_kg: profile.weight_kg,
        gender: profile.gender,
      };
      const programDays: ProgramDay[] = days.map((d) => ({
        week_index: d.week_index,
        day_index: d.day_index,
        is_rest: d.is_rest,
        title: d.title,
        focus: d.focus,
        description: d.description,
        warmup: d.warmup,
        exercises: d.exercises,
        cooldown: d.cooldown,
        day_note: d.day_note,
      }));
      const result = await publishTrainingProgram({
        userId: id,
        courseId: courseId ?? null,
        input,
        days: programDays,
        programWeeks: program.program_weeks,
        notes: program.notes,
        faq: program.faq,
        exercises,
      });
      toast.success(
        result.usedRpc
          ? "Тренировки опубликованы клиенту (неизменяемая версия)"
          : "Сохранено. Миграция версий ещё не применена — выполните SQL.",
      );
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleApplyCoachSheet = async () => {
    if (!profile) return;

    const missing = missingCoachSheetExercises(exercises);
    if (missing.length > 0) {
      toast.error(
        `В базе нет ${missing.length} упражнений из 4-недельной таблицы. Выполните seed: npm run exercises:apply-seed или SQL supabase/migrations/20260813220000_coach_exercises_panova_sheet.sql`,
        { duration: 15000 },
      );
      return;
    }

    const input: ProgramInput = {
      sessions_per_week: 3,
      goal: profile.goal,
      level: profile.level,
      has_injuries: profile.has_injuries,
      injuries_details: profile.injuries_details,
      equipment: profile.equipment,
      location: profile.location,
      weight_kg: profile.weight_kg,
      gender: profile.gender,
    };
    try {
      const customDays = buildCoachSheetProgramDays(exercises, input);
      const result = await createOrReplaceCustomProgram({
        userId: id,
        input: { ...input, sessions_per_week: 3 },
        days: customDays,
        programWeeks: COACH_PROGRAM_WEEKS,
        notes: coachProgramNotes(input),
        preserveFaq: program?.faq ?? null,
        targetsManual: true,
      });
      await reload();
      if (result.multiWeek) {
        toast.success(
          `Черновик из таблицы сохранён: ${result.days.length} дней. Опубликуйте клиенту отдельно.`,
        );
      } else {
        toast.warning(
          `Сохранена 1-я неделя (${result.days.length} дн.). Для 4 недель выполните supabase/production-setup-coach-sheet.sql в Supabase и нажмите кнопку снова.`,
          { duration: 15000 },
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDayPatchLocal = useCallback(
    async (weekIndex: number, dayIndex: number, patch: Partial<ProgramDay>) => {
      setDays((cur) =>
        cur.map((d) =>
          d.week_index === weekIndex && d.day_index === dayIndex
            ? { ...d, ...(patch as Partial<DayRow>) }
            : d,
        ),
      );
      setDirtyDays((cur) => new Set(cur).add(dayKey(weekIndex, dayIndex)));
    },
    [],
  );

  const handleSaveDay = useCallback(
    async (weekIndex: number, dayIndex: number) => {
      if (!program) return;
      const day = days.find((d) => d.week_index === weekIndex && d.day_index === dayIndex);
      if (!day) return;

      const key = dayKey(weekIndex, dayIndex);
      setSavingDayKey(key);
      try {
        await updateDayPatch(program.id, weekIndex, dayIndex, {
          title: day.title,
          focus: day.focus,
          description: day.description,
          is_rest: day.is_rest,
          warmup: day.warmup,
          exercises: day.exercises,
          cooldown: day.cooldown,
          day_note: day.day_note,
        });
        await lockProgramManual(program.id);
        setProgram((p) => (p ? { ...p, targets_manual: true } : p));
        setDirtyDays((cur) => {
          const next = new Set(cur);
          next.delete(key);
          return next;
        });
        toast.success("День сохранён — клиент увидит изменения");
      } catch (e) {
        toast.error((e as Error).message || "Не удалось сохранить день");
        throw e;
      } finally {
        setSavingDayKey(null);
      }
    },
    [program, days],
  );

  const handleDayPatch = async (
    weekIndex: number,
    dayIndex: number,
    patch: Partial<ProgramDay>,
  ) => {
    await handleDayPatchLocal(weekIndex, dayIndex, patch);
  };

  const handleProgramPatch = async (patch: { notes?: string | null; faq?: FaqItem[] }) => {
    if (!program) return;
    try {
      await updateProgramPatch(program.id, { ...patch, targets_manual: true });
      setProgram((p) =>
        p ? { ...p, ...patch, faq: patch.faq ?? p.faq, targets_manual: true } : p,
      );
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить");
      throw e;
    }
  };

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем…</div>;

  const programDays: ProgramDay[] = days.map((d) => ({
    week_index: d.week_index,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup,
    exercises: d.exercises,
    cooldown: d.cooldown,
    day_note: d.day_note,
  }));

  return (
    <div className="space-y-8">
      <Link
        to="/admin/clients/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-sm text-warm-gray hover:text-ivory"
      >
        <ArrowLeft className="h-4 w-4" /> К карточке клиента
      </Link>

      <PanelHeader
        eyebrow="Программа тренировок"
        title={profileName}
        description="Черновик правите свободно. Клиент видит только опубликованную версию — нажмите «Опубликовать клиенту»."
      />

      {publishedVersion != null && (
        <p className="rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 text-sm text-warm-gray">
          Клиент сейчас на версии v{publishedVersion}. Пересборка и правки дней не меняют её, пока
          не опубликуете новую.
        </p>
      )}

      {program && profile && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={publishing || days.length === 0}
              onClick={() => void handlePublishToClient()}
              className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory disabled:opacity-40"
            >
              {publishing
                ? "Публикуем…"
                : publishedVersion != null
                  ? "Опубликовать новую версию"
                  : "Опубликовать клиенту"}
            </button>
          </div>
          {programDays.length === 0 && (
            <div className="rounded-3xl border border-coral/30 bg-coral/10 p-5 text-sm text-warm-gray">
              <p className="font-display text-base text-ivory">Дни программы пустые</p>
              <p className="mt-2">
                Нажмите «Таблица тренера · 4 нед.» — если появится ошибка про{" "}
                <code className="text-gold">week_index</code>, выполните в Supabase SQL Editor
                миграции <code className="text-gold">20260813180000</code> и{" "}
                <code className="text-gold">20260813190000</code>, затем повторите.
              </p>
            </div>
          )}
          <ParamsEditor
            program={program}
            profile={profile}
            onApplyCoachSheet={() => void handleApplyCoachSheet()}
            onSaveTargets={async (sessions, goal, level) => {
              await handleRegenerate({ sessions_per_week: sessions, goal, level });
            }}
            onLock={async () => {
              await updateProgramPatch(program.id, { targets_manual: true });
              setProgram((p) => (p ? { ...p, targets_manual: true } : p));
              toast.success("Программа зафиксирована для клиента");
            }}
            onSaveNotes={async (notes) => {
              await handleProgramPatch({ notes });
              toast.success("Комментарий сохранён");
            }}
          />
        </>
      )}

      {!program ? (
        <div className="rounded-3xl border border-gold/15 bg-surface/40 p-8 text-center">
          <p className="text-warm-gray">У клиента ещё нет программы.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => void handleApplyCoachSheet()}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background"
            >
              <Sparkles className="h-4 w-4" /> Программа из таблицы (4 нед.)
            </button>
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
            >
              Автогенерация по анкете
            </button>
          </div>
        </div>
      ) : (
        <>
          <TrainingView
            exercises={exercises}
            days={programDays}
            goal={(program.goal ?? "maintain") as ProgramGoal}
            level={program.level as ProgramLevel}
            sessionsPerWeek={program.sessions_per_week}
            programWeeks={program.program_weeks}
            notes={program.notes}
            faq={program.faq}
            editable={true}
            manualSave
            dirtyDayKeys={dirtyDays}
            savingDayKey={savingDayKey}
            onSaveDay={handleSaveDay}
            onDayPatch={handleDayPatch}
            onProgramPatch={handleProgramPatch}
            userId={id}
            onProgramReload={() => void reload()}
          />
        </>
      )}
    </div>
  );
}

function ParamsEditor({
  program,
  profile,
  onApplyCoachSheet,
  onSaveTargets,
  onLock,
  onSaveNotes,
}: {
  program: ProgramRow;
  profile: {
    sessions_per_week: 3 | 4;
    goal: ProgramGoal;
    level: ProgramLevel;
    weight_kg?: number | null;
  };
  onApplyCoachSheet: () => void;
  onSaveTargets: (sessions: 3 | 4, goal: ProgramGoal, level: ProgramLevel) => Promise<void>;
  onLock: () => Promise<void>;
  onSaveNotes: (notes: string | null) => Promise<void>;
}) {
  const [sessions, setSessions] = useState<3 | 4>(program.sessions_per_week as 3 | 4);
  const [goal, setGoal] = useState<ProgramGoal>((program.goal ?? "maintain") as ProgramGoal);
  const [level, setLevel] = useState<ProgramLevel>(program.level as ProgramLevel);
  const [notes, setNotes] = useState(program.notes ?? "");

  return (
    <section className="rounded-3xl border border-gold/15 bg-surface/40 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">
            Параметры программы
          </p>
          <p className="mt-1 text-sm text-warm-gray">
            Из анкеты: {profile.sessions_per_week} тренировки в неделю · {GOAL_LABEL[profile.goal]}{" "}
            · {profile.level}
            {profile.weight_kg != null ? ` · вес ${profile.weight_kg} кг` : ""}
            {profile.weight_kg != null && profile.weight_kg > 85 ? " (без ударных/прыжков)" : ""}
          </p>
        </div>
        {program.targets_manual ? (
          <span className="rounded-full bg-gold/15 px-3 py-1 text-[10px] uppercase tracking-widest text-gold">
            Сохранено для клиента
          </span>
        ) : (
          <span className="rounded-full bg-warm-gray/15 px-3 py-1 text-[10px] uppercase tracking-widest text-warm-gray">
            Черновик — ещё не зафиксирован
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Тренировок в неделю
          </span>
          <select
            value={sessions}
            onChange={(e) => setSessions(Number(e.target.value) as 3 | 4)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Цель
          </span>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as ProgramGoal)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            {(Object.keys(GOAL_LABEL) as ProgramGoal[]).map((g) => (
              <option key={g} value={g}>
                {GOAL_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Уровень
          </span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ProgramLevel)}
            className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          >
            <option value="beginner">Новичок</option>
            <option value="intermediate">Средний</option>
            <option value="advanced">Продвинутый</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApplyCoachSheet}
          className="inline-flex items-center gap-2 rounded-full border border-gold/40 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
        >
          <Sparkles className="h-3.5 w-3.5" /> Программа из таблицы (4 нед.)
        </button>
        <button
          type="button"
          onClick={() => void onSaveTargets(sessions, goal, level)}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-4 py-2 text-xs uppercase tracking-widest text-background"
        >
          <Sparkles className="h-3.5 w-3.5" /> Пересобрать под эти параметры
        </button>
        {!program.targets_manual && (
          <button
            type="button"
            onClick={() => void onLock()}
            className="inline-flex items-center gap-2 rounded-full border border-gold/40 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
          >
            <Save className="h-3.5 w-3.5" /> Зафиксировать текущую без пересборки
          </button>
        )}
      </div>

      <label className="mt-6 block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
          Комментарий тренера ко всей программе
        </span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory"
          placeholder="Например: 4-ю неделю переходим к прогрессии, добавляем вес"
        />
      </label>
      <button
        type="button"
        onClick={() => void onSaveNotes(notes || null)}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10"
      >
        <Save className="h-3.5 w-3.5" /> Сохранить комментарий
      </button>
    </section>
  );
}
