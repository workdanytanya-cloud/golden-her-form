import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/panel/PanelShell";
import { AccessGate } from "@/components/panel/AccessGate";
import { ClientCoursePicker } from "@/components/panel/ClientCoursePicker";
import { TrainingView } from "@/components/panel/TrainingView";
import { useAuth } from "@/lib/auth";
import { useClientCourses } from "@/lib/client-course-context";
import { loadPublishedTrainingFor } from "@/lib/published-programs/repo";
import {
  type ProgramDay,
  type ProgramGoal,
  type ProgramLevel,
  type Exercise,
} from "@/lib/training";
import type { ProgramRow, DayRow } from "@/lib/training-repo";

export const Route = createFileRoute("/_authenticated/dashboard/training")({
  component: TrainingPage,
});

function TrainingPage() {
  const { selectedCourse } = useClientCourses();
  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow={selectedCourse?.title ?? "Курс"}
        title="Тренировки"
        description="Персональная программа на 4 недели. Состав меняет только тренер новой версией."
      />
      <AccessGate level="active">
        <div className="space-y-6">
          <ClientCoursePicker />
          <TrainingInner />
        </div>
      </AccessGate>
    </div>
  );
}

function TrainingInner() {
  const { effectiveUserId } = useAuth();
  const { selectedCourseId, selectedCourse } = useClientCourses();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    const published = await loadPublishedTrainingFor(effectiveUserId, selectedCourseId);
    if (published) {
      setExercises(published.exercises);
      setProgram(published.program);
      setDays(published.days);
    } else {
      setExercises([]);
      setProgram(null);
      setDays([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUserId, selectedCourseId]);

  if (loading) return <div className="py-10 text-center text-warm-gray">Загружаем программу…</div>;
  if (!program || days.length === 0)
    return (
      <div className="rounded-3xl border border-gold/15 bg-surface/30 p-8 text-center text-warm-gray">
        Программа пока не назначена. Тренер опубликует для вас фиксированный блок на 4 недели.
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
      goal={(program.goal as ProgramGoal) ?? "tone"}
      level={(program.level as ProgramLevel) ?? "beginner"}
      sessionsPerWeek={program.sessions_per_week}
      programWeeks={program.program_weeks}
      notes={program.notes}
      faq={program.faq}
      editable={false}
      userId={effectiveUserId ?? undefined}
      programId={program.id}
      enableWorkoutFeedback
    />
  );
}
