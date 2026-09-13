import { buildContinuationTrainingProgram } from "@/lib/course-continuation/training-continuation";
import type { PreviousTrainingContext } from "@/lib/course-continuation/training-continuation";
import type { DefaultProgramPlan } from "@/lib/coach-sheet-program";
import { getClientCourse, listClientCourses } from "@/lib/client-courses/repo";
import { loadPublishedTrainingFor } from "@/lib/published-programs/repo";
import type { Exercise, ProgramDay, ProgramInput } from "@/lib/training";
import { loadProgramFor } from "@/lib/training-repo";

function toProgramDays(
  rows: Array<{
    week_index: number;
    day_index: number;
    is_rest: boolean;
    title: string;
    focus: string | null;
    description: string | null;
    warmup: ProgramDay["warmup"];
    exercises: ProgramDay["exercises"];
    cooldown: ProgramDay["cooldown"];
    day_note: string | null;
  }>,
): ProgramDay[] {
  return rows.map((d) => ({
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
}

function buildProgramInput(profile: Awaited<ReturnType<typeof import("@/lib/training-repo").loadProgramProfile>>): ProgramInput {
  return {
    sessions_per_week: profile.sessions_per_week,
    goal: profile.goal,
    level: profile.level,
    has_injuries: profile.has_injuries,
    injuries_details: profile.injuries_details,
    equipment: profile.equipment,
    location: profile.location,
    weight_kg: profile.weight_kg,
    gender: profile.gender,
  };
}

async function loadPreviousTrainingContext(
  clientId: string,
  currentCourseId?: string | null,
  preferredSourceCourseId?: string | null,
): Promise<PreviousTrainingContext | null> {
  const courses = await listClientCourses(clientId);
  const sorted = [...courses].sort((a, b) => a.start_date.localeCompare(b.start_date));

  let sourceCourse =
    (preferredSourceCourseId
      ? sorted.find((c) => c.id === preferredSourceCourseId)
      : null) ??
    (currentCourseId
      ? [...sorted].reverse().find((c) => c.id !== currentCourseId && c.status !== "draft")
      : null);

  if (!sourceCourse) return null;

  const [published, draft, sourceMeta] = await Promise.all([
    loadPublishedTrainingFor(clientId, sourceCourse.id),
    loadProgramFor(clientId, sourceCourse.id),
    getClientCourse(sourceCourse.id),
  ]);

  const previousDays = published?.days?.length
    ? toProgramDays(published.days)
    : toProgramDays(draft.days);
  const previousProgram = published?.program ?? draft.program;
  if (previousDays.length === 0 || !previousProgram) {
    return null;
  }

  const priorBlocks = courses.filter(
    (c) => c.id !== currentCourseId && c.status !== "draft",
  ).length;

  return {
    days: previousDays,
    goal: (previousProgram.goal as ProgramInput["goal"]) ?? "maintain",
    level: (previousProgram.level as ProgramInput["level"]) ?? "beginner",
    sessions_per_week: (previousProgram.sessions_per_week as 3 | 4) ?? 3,
    courseNumber: Math.max(2, priorBlocks + 1),
    sourceCourseTitle: sourceMeta?.title ?? sourceCourse.title,
  };
}

/** План тренировок: анкета + продолжение прошлого курса (если есть). */
export async function resolveTrainingPlanForCourse(params: {
  clientId: string;
  courseId?: string | null;
  exercises: Exercise[];
  input: ProgramInput;
  sourceCourseId?: string | null;
}): Promise<DefaultProgramPlan> {
  const previous = await loadPreviousTrainingContext(
    params.clientId,
    params.courseId,
    params.sourceCourseId,
  );
  return buildContinuationTrainingProgram(params.exercises, params.input, previous);
}

/**
 * Сгенерировать тренировочный блок нового курса на основе анкеты и прошлого курса.
 */
export async function seedTrainingContinuationForCourse(params: {
  clientId: string;
  sourceCourseId: string;
  targetCourseId: string;
}): Promise<void> {
  const { clientId, sourceCourseId, targetCourseId } = params;

  const { loadExercises, loadProgramProfile, createOrReplaceCustomProgram } = await import(
    "@/lib/training-repo"
  );

  const [exercises, profile] = await Promise.all([
    loadExercises(),
    loadProgramProfile(clientId),
  ]);

  const input = buildProgramInput(profile);
  const plan = await resolveTrainingPlanForCourse({
    clientId,
    courseId: targetCourseId,
    sourceCourseId,
    exercises,
    input,
  });

  await createOrReplaceCustomProgram({
    userId: clientId,
    courseId: targetCourseId,
    input,
    days: plan.days,
    programWeeks: plan.programWeeks,
    notes: plan.coachNotes,
    targetsManual: true,
  });
}
