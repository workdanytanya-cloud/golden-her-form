import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { TrainingView } from "@/components/panel/TrainingView";
import { useAuth } from "@/lib/auth";
import {
  loadExercises,
  loadProgramFor,
  loadProgramProfile,
  createOrReplaceProgram,
  isImpactOrJumpExercise,
  needsJointCare,
  type ProgramRow,
  type DayRow,
  type Exercise,
} from "@/lib/training-repo";
import {
  type ProgramDay,
  type ProgramGoal,
  type ProgramLevel,
  type ProgramInput,
} from "@/lib/training";

export const Route = createFileRoute("/_authenticated/dashboard/training")({
  component: TrainingPage,
});

function programInputFromProfile(prof: Awaited<ReturnType<typeof loadProgramProfile>>): ProgramInput {
  return {
    sessions_per_week: prof.sessions_per_week,
    goal: prof.goal,
    level: prof.level,
    has_injuries: prof.has_injuries,
    injuries_details: prof.injuries_details,
    equipment: prof.equipment,
    location: prof.location,
    weight_kg: prof.weight_kg,
  };
}

function programHasImpactMoves(days: DayRow[], exercises: Exercise[]): boolean {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  for (const day of days) {
    for (const block of [day.warmup, day.exercises, day.cooldown]) {
      for (const set of block) {
        const ex = byId.get(set.exercise_id);
        if (ex && isImpactOrJumpExercise(ex)) return true;
      }
    }
  }
  return false;
}

function TrainingPage() {
  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Курс"
        title="Тренировки"
        description="Персональная программа под твою цель. Разминка, силовой блок и заминка на каждый день — с техникой и рекомендациями."
      />
      <AccessGate level="active">
        <TrainingInner />
      </AccessGate>
    </div>
  );
}

function TrainingInner() {
  const { effectiveUserId } = useAuth();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const [ex, p, prof] = await Promise.all([
      loadExercises(),
      loadProgramFor(effectiveUserId),
      loadProgramProfile(effectiveUserId),
    ]);

    let currentProgram = p.program;
    let currentDays = p.days;
    const input = programInputFromProfile(prof);

    // Программа есть, но дни пропали — восстановить автогенерацией (кроме ручных правок тренера)
    if (currentProgram && currentDays.length === 0 && !currentProgram.targets_manual) {
      try {
        setBusy(true);
        const res = await createOrReplaceProgram({
          userId: effectiveUserId,
          input,
          exercises: ex,
          preserveNotes: currentProgram.notes,
          preserveFaq: currentProgram.faq,
        });
        currentProgram = res.program;
        currentDays = res.days;
        toast.success("Программа восстановлена");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    } else if (!currentProgram) {
      try {
        setBusy(true);
        const res = await createOrReplaceProgram({
          userId: effectiveUserId,
          input,
          exercises: ex,
        });
        currentProgram = res.program;
        currentDays = res.days;
        toast.success("Программа собрана под твою анкету");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    } else if (!currentProgram.targets_manual) {
      // Auto-refresh: анкета изменилась ИЛИ вес >85, а в программе ещё есть ударные/прыжки
      const changed =
        currentProgram.sessions_per_week !== prof.sessions_per_week ||
        currentProgram.goal !== prof.goal ||
        currentProgram.level !== prof.level ||
        currentProgram.has_injuries !== prof.has_injuries;
      const jointCareRefresh =
        needsJointCare(input) && programHasImpactMoves(currentDays, ex);
      if (changed || jointCareRefresh) {
        try {
          const res = await createOrReplaceProgram({
            userId: effectiveUserId,
            input,
            exercises: ex,
            preserveNotes: currentProgram.notes,
            preserveFaq: currentProgram.faq,
          });
          currentProgram = res.program;
          currentDays = res.days;
          toast.success(
            jointCareRefresh && !changed
              ? "Программа обновлена: убраны ударные и прыжковые нагрузки"
              : "Программа обновлена под изменения анкеты",
          );
        } catch (e) {
          console.error(e);
        }
      }
    }

    setExercises(ex);
    setProgram(currentProgram);
    setDays(currentDays);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId]);

  if (loading || busy)
    return <div className="py-10 text-center text-warm-gray">Собираем программу…</div>;
  if (!program)
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center text-warm-gray">
        Программа пока не создана. Заполни анкету и открой доступ — программа соберётся
        автоматически.
      </div>
    );

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
    <TrainingView
      exercises={exercises}
      days={programDays}
      goal={(program.goal ?? "maintain") as ProgramGoal}
      level={program.level as ProgramLevel}
      sessionsPerWeek={program.sessions_per_week}
      programWeeks={program.program_weeks}
      notes={program.notes}
      faq={program.faq}
      editable={false}
      userId={effectiveUserId ?? undefined}
      programId={program.id}
      enableWorkoutFeedback
      onProgramReload={() => void reload()}
    />
  );
}
