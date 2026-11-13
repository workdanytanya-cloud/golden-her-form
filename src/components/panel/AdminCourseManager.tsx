import { Link } from "@tanstack/react-router";
import { CalendarPlus, CheckCircle2, Play, Trash2, Archive } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import {
  activateClientCourse,
  archiveClientCourse,
  deleteClientCourseDraft,
  isClientCoursesAvailable,
  listClientCourses,
  updateClientCourseScope,
  courseStatusLabel,
  type ClientCourse,
} from "@/lib/client-courses";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/error-message";
import type { CourseProvisionResult } from "@/lib/selfhost/client-api";

const PROVISION_WAIT_MS = 100_000;

export type CourseNotice = {
  created: boolean;
  nutrition?: string | null;
  training?: string | null;
  error?: string | null;
  retryCourseId?: string | null;
  retryKind?: "nutrition" | "training";
};

export type AdminCourseManagerHandle = {
  createAndActivate: () => Promise<void>;
};

export const AdminCourseManager = forwardRef<
  AdminCourseManagerHandle,
  {
    clientId: string;
    selectedCourseId: string | null;
    onSelectCourse: (id: string | null) => void;
    onChanged: () => void;
    onCoursesChange?: (courses: ClientCourse[]) => void;
    onBusyChange?: (busy: boolean) => void;
  }
>(function AdminCourseManager(
  { clientId, selectedCourseId, onSelectCourse, onChanged, onCoursesChange, onBusyChange },
  ref,
) {
  const { user } = useAuth();
  const [courses, setCourses] = useState<ClientCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [newProgramScope, setNewProgramScope] = useState<ClientCourse["program_scope"]>("both");
  const [notice, setNotice] = useState<CourseNotice | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const load = async () => {
    setLoading(true);
    const ready = await isClientCoursesAvailable();
    setSchemaReady(ready);
    if (!ready) {
      setCourses([]);
      setLoading(false);
      return;
    }
    const list = await listClientCourses(clientId);
    setCourses(list);
    onCoursesChange?.(list);
    const stillValid = Boolean(selectedCourseId && list.some((c) => c.id === selectedCourseId));
    if (!stillValid) {
      const active = list.find((c) => c.status === "active");
      onSelectCourse(active?.id ?? list[0]?.id ?? null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const applyResult = async (result: CourseProvisionResult) => {
    const nutrition = result.stages?.nutrition;
    const training = result.stages?.training;
    const failedKind =
      nutrition?.status === "failed"
        ? "nutrition"
        : training?.status === "failed"
          ? "training"
          : undefined;
    const failedMessage =
      (failedKind === "nutrition" ? nutrition?.error : training?.error) ||
      (nutrition?.status === "failed" ? nutrition.error : null) ||
      (training?.status === "failed" ? training.error : null);
    setNotice({
      created: true,
      nutrition:
        nutrition?.status === "ready"
          ? "Питание готово к проверке"
          : nutrition?.status === "failed"
            ? nutrition.error
            : null,
      training:
        training?.status === "ready"
          ? "Тренировки готовы к проверке"
          : training?.status === "failed"
            ? training.error
            : null,
      error: failedMessage,
      retryCourseId: failedKind ? result.course.id : null,
      retryKind: failedKind,
    });
    toast.success("Курс создан");
    if (nutrition?.status === "ready") toast.success("Питание готово к проверке");
    if (training?.status === "ready") toast.success("Тренировки готовы к проверке");
    if (failedMessage) toast.error(failedMessage);
    onSelectCourse(result.course.id);
    await load();
    onChanged();
  };

  const pollProvision = async (activate: boolean) => {
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const list = await listClientCourses(clientId);
      const today = new Date().toISOString().slice(0, 10);
      const match = list.find(
        (course) =>
          course.program_scope === newProgramScope &&
          course.start_date === today &&
          (activate ? course.status === "active" || course.status === "draft" : true),
      );
      if (!match) continue;
      const pending = [match.nutrition_generation_status, match.training_generation_status].some(
        (status) => status === "pending" || status === "generating",
      );
      if (!pending) {
        await applyResult({
          course: match,
          stages: {
            nutrition: {
              status: match.nutrition_generation_status ?? null,
              error: match.nutrition_generation_error ?? null,
            },
            training: {
              status: match.training_generation_status ?? null,
              error: match.training_generation_error ?? null,
            },
          },
        });
        return true;
      }
    }
    return false;
  };

  const createNew = async (activate: boolean) => {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVISION_WAIT_MS);
    try {
      const { selfhostAdminProvisionCourse } = await import("@/lib/selfhost/client-api");
      const result = await selfhostAdminProvisionCourse(
        clientId,
        {
          activate,
          programScope: newProgramScope,
          createdBy: user?.id ?? null,
        },
        controller.signal,
      );
      await applyResult(result);
    } catch (e) {
      const aborted = controller.signal.aborted || (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        const settled = await pollProvision(activate);
        if (!settled) {
          setNotice({
            created: false,
            error: "Превышено время генерации. Повторите этап.",
          });
          toast.error("Превышено время генерации. Повторите этап.");
        }
      } else {
        const message = errorMessage(e, "Ошибка создания курса");
        setNotice({ created: false, error: message });
        toast.error(message, { duration: message.includes("не хватает") ? 8000 : 4000 });
      }
    } finally {
      clearTimeout(timer);
      lock.current = false;
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    if (!notice?.retryCourseId || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { selfhostAdminRetryCourseGeneration } = await import("@/lib/selfhost/client-api");
      const result = await selfhostAdminRetryCourseGeneration(
        clientId,
        notice.retryCourseId,
        notice.retryKind,
      );
      await applyResult(result);
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось повторить генерацию"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    createAndActivate: () => createNew(true),
  }));

  const changeScope = async (course: ClientCourse, programScope: ClientCourse["program_scope"]) => {
    setBusy(true);
    try {
      await updateClientCourseScope(course.id, clientId, programScope);
      toast.success("Состав курса обновлён");
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось изменить состав курса"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (courseId: string) => {
    setBusy(true);
    try {
      await activateClientCourse(courseId, clientId);
      toast.success("Курс активирован");
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Ошибка активации"));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (courseId: string) => {
    if (!window.confirm("Архивировать курс? Опубликованные программы не удаляются.")) return;
    setBusy(true);
    try {
      await archiveClientCourse(courseId, clientId);
      toast.success("Курс в архиве");
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось архивировать"));
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async (courseId: string) => {
    if (!window.confirm("Удалить этот черновик? Действие необратимо.")) return;
    setBusy(true);
    try {
      await deleteClientCourseDraft(courseId, clientId);
      if (selectedCourseId === courseId) onSelectCourse(null);
      toast.success("Черновик удалён");
      await load();
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Не удалось удалить черновик"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-warm-gray">Загружаем курсы клиента…</p>;
  }

  if (!schemaReady) {
    return (
      <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <h3 className="font-display text-lg text-foreground">Курсы (4 недели)</h3>
        <p className="text-sm leading-relaxed text-warm-gray">
          Раздел пока не активен: в Supabase не применена миграция{" "}
          <code className="rounded bg-background/60 px-1 py-0.5 text-xs">client_courses</code>.
          Откройте SQL Editor проекта и выполните файл{" "}
          <code className="rounded bg-background/60 px-1 py-0.5 text-xs">
            supabase/migrations/20260831120000_client_courses.sql
          </code>
          , затем обновите страницу.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-gold/15 bg-surface/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg text-foreground">Курсы (4 недели)</h3>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm text-warm-gray">
            Состав нового курса
            <select
              value={newProgramScope}
              disabled={busy}
              onChange={(event) =>
                setNewProgramScope(event.target.value as ClientCourse["program_scope"])
              }
              className="rounded-lg border border-gold/25 bg-background px-3 py-1.5 text-foreground"
            >
              <option value="nutrition">Только питание</option>
              <option value="training">Только тренировки</option>
              <option value="both">Питание + тренировки</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createNew(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/25 px-3 py-1.5 text-sm hover:bg-gold/10 disabled:opacity-50"
          >
            <CalendarPlus className="h-4 w-4" />
            {busy ? "Создаём курс…" : "Новый курс"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createNew(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-background hover:bg-gold/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {busy ? "Создаём курс…" : "Новый + активировать"}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="space-y-2 rounded-xl border border-gold/20 bg-background/40 p-3 text-sm">
          {notice.created ? <p className="text-foreground">Курс создан</p> : null}
          {notice.nutrition === "Питание готово к проверке" ? (
            <p className="text-foreground">Питание готово к проверке</p>
          ) : null}
          {notice.training === "Тренировки готовы к проверке" ? (
            <p className="text-foreground">Тренировки готовы к проверке</p>
          ) : null}
          {notice.error ? <p className="text-coral">{notice.error}</p> : null}
          {notice.error?.includes("не хватает") ? (
            <Link
              to="/admin/clients/$id/onboarding"
              params={{ id: clientId }}
              className="inline-flex text-xs uppercase tracking-widest text-gold hover:underline"
            >
              Открыть анкету
            </Link>
          ) : null}
          {notice.retryCourseId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void retryFailed()}
              className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs hover:bg-gold/10 disabled:opacity-50"
            >
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}

      {courses.length === 0 ? (
        <p className="text-sm text-warm-gray">
          Курсов пока нет. Создайте первый — программа соберётся по анкете клиента.
        </p>
      ) : (
        <>
          {courses.filter((c) => c.status === "draft").length > 1 ? (
            <p className="text-xs leading-relaxed text-warm-gray">
              Несколько черновиков на одну дату — это следствие прошлых ошибок при создании.
              Оставьте один и удалите лишние кнопкой «Удалить».
            </p>
          ) : null}
          <ul className="space-y-2">
            {courses.map((c) => {
              const selected = c.id === selectedCourseId;
              return (
                <li
                  key={c.id}
                  className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                    selected ? "border-gold/40 bg-gold/5" : "border-gold/10"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => onSelectCourse(c.id)}
                  >
                    <p className="font-medium text-foreground">{c.title}</p>
                    <p className="text-xs text-warm-gray">
                      {courseStatusLabel(c.status)} · {c.start_date} — {c.end_date}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Состав курса"
                      value={c.program_scope ?? "both"}
                      disabled={busy}
                      onChange={(event) =>
                        void changeScope(c, event.target.value as ClientCourse["program_scope"])
                      }
                      className="rounded-lg border border-gold/25 bg-background px-2.5 py-1 text-xs text-foreground"
                    >
                      <option value="nutrition">Только питание</option>
                      <option value="training">Только тренировки</option>
                      <option value="both">Питание + тренировки</option>
                    </select>
                    {c.status !== "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void activate(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gold/25 px-2.5 py-1 text-xs hover:bg-gold/10"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Активировать
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Активный
                      </span>
                    )}
                    {c.status === "draft" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeDraft(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-coral/30 px-2.5 py-1 text-xs text-coral hover:bg-coral/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить
                      </button>
                    ) : c.status !== "archived" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void archive(c.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gold/25 px-2.5 py-1 text-xs hover:bg-gold/10"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Архив
                      </button>
                    ) : null}
                    <Link
                      to="/admin/clients/$id/training"
                      params={{ id: clientId }}
                      search={{ course: c.id }}
                      className="rounded-lg border border-gold/25 px-2.5 py-1 text-xs hover:bg-gold/10"
                    >
                      Тренировки
                    </Link>
                    <Link
                      to="/admin/clients/$id/nutrition"
                      params={{ id: clientId }}
                      search={{ course: c.id }}
                      className="rounded-lg border border-gold/25 px-2.5 py-1 text-xs hover:bg-gold/10"
                    >
                      Питание
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
});
