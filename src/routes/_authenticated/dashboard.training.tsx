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
  updateDayPatch,
  updateProgramPatch,
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

    // Auto-generate on first visit
    if (!currentProgram) {
      try {
        setBusy(true);
        const input: ProgramInput = {
          sessions_per_week: prof.sessions_per_week,
          goal: prof.goal,
          level: prof.level,
          has_injuries: prof.has_injuries,
          injuries_details: prof.injuries_details,
          equipment: prof.equipment,
          location: prof.location,
        };
        const res = await createOrReplaceProgram({ userId: effectiveUserId, input, exercises: ex });
        currentProgram = res.program;
        currentDays = res.days;
        toast.success("Программа собрана под твою анкету");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    } else if (!currentProgram.targets_manual) {
      // Auto-refresh: если анкета изменилась и параметры не зафиксированы — регенерируем
      const changed =
        currentProgram.sessions_per_week !== prof.sessions_per_week ||
        currentProgram.goal !== prof.goal ||
        currentProgram.level !== prof.level ||
        currentProgram.has_injuries !== prof.has_injuries;
      if (changed) {
        try {
          const input: ProgramInput = {
            sessions_per_week: prof.sessions_per_week,
            goal: prof.goal,
            level: prof.level,
            has_injuries: prof.has_injuries,
            injuries_details: prof.injuries_details,
            equipment: prof.equipment,
            location: prof.location,
          };
          const res = await createOrReplaceProgram({
            userId: effectiveUserId,
            input,
            exercises: ex,
            preserveNotes: currentProgram.notes,
            preserveFaq: currentProgram.faq,
          });
          currentProgram = res.program;
          currentDays = res.days;
          toast.success("Программа обновлена под изменения анкеты");
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
        Программа пока не создана. Заполни анкету и открой доступ — программа соберётся автоматически.
      </div>
    );

  const programDays: ProgramDay[] = days.map((d) => ({
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
      notes={program.notes}
      faq={program.faq}
      editable={false}
    />
  );
}
