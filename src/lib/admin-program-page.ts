import type { ClientCourse } from "@/lib/client-courses/repo";
import type { ProgramGenerationStatus } from "@/lib/client-courses/program-readiness";

export type ProgramPageKind = "nutrition" | "training";

export type ProgramPageGate =
  | { kind: "no_course" }
  | { kind: "out_of_scope" }
  | { kind: "generating" }
  | { kind: "failed"; message: string }
  | { kind: "missing_draft" }
  | { kind: "ready" };

export function selectCourse(
  courses: ClientCourse[],
  courseId?: string | null,
): ClientCourse | null {
  if (courseId) return courses.find((course) => course.id === courseId) ?? null;
  return (
    courses.find((course) => course.status === "active") ??
    courses.find((course) => course.status !== "archived") ??
    null
  );
}

export function programPageGate(
  course: ClientCourse | null,
  kind: ProgramPageKind,
): ProgramPageGate {
  if (!course) return { kind: "no_course" };
  const scope = course.program_scope ?? "both";
  if (scope !== "both" && scope !== kind) return { kind: "out_of_scope" };
  const status = (
    kind === "nutrition" ? course.nutrition_generation_status : course.training_generation_status
  ) as ProgramGenerationStatus | null | undefined;
  const error =
    kind === "nutrition" ? course.nutrition_generation_error : course.training_generation_error;
  if (status === "pending" || status === "generating") return { kind: "generating" };
  if (status === "failed") {
    return { kind: "failed", message: error?.trim() || "Генерация завершилась ошибкой" };
  }
  return { kind: "ready" };
}

export function emptyDraftGate(hasDraft: boolean): ProgramPageGate {
  return hasDraft ? { kind: "ready" } : { kind: "missing_draft" };
}

export async function finishLoading<T>(
  setLoading: (loading: boolean) => void,
  task: () => Promise<T>,
): Promise<T> {
  setLoading(true);
  try {
    return await task();
  } finally {
    setLoading(false);
  }
}

export const NO_COURSE_TEXT = "У клиента ещё нет курса. Создайте курс в карточке клиента";
export const NUTRITION_OUT_OF_SCOPE_TEXT = "Питание не входит в состав этого курса.";
export const TRAINING_OUT_OF_SCOPE_TEXT = "Тренировки не входят в состав этого курса.";
