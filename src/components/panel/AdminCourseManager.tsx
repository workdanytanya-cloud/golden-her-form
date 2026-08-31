import { Link } from "@tanstack/react-router";
import { CalendarPlus, CheckCircle2, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  activateClientCourse,
  createClientCourse,
  deleteClientCourseDraft,
  isClientCoursesAvailable,
  listClientCourses,
  courseStatusLabel,
  type ClientCourse,
} from "@/lib/client-courses";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/error-message";

export function AdminCourseManager({
  clientId,
  selectedCourseId,
  onSelectCourse,
  onChanged,
}: {
  clientId: string;
  selectedCourseId: string | null;
  onSelectCourse: (id: string | null) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [courses, setCourses] = useState<ClientCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);

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
    if (!selectedCourseId && list[0]) onSelectCourse(list[0].id);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const createNew = async (activate: boolean) => {
    setBusy(true);
    try {
      const created = await createClientCourse({
        clientId,
        createdBy: user?.id ?? null,
        cloneFromCourseId: selectedCourseId,
        activate,
      });
      toast.success(activate ? "Новый курс активирован" : "Черновик готов");
      onSelectCourse(created.id);
      await load();
      onChanged();
    } catch (e) {
      const partial =
        typeof e === "object" &&
        e !== null &&
        "partial" in e &&
        (e as { partial?: boolean }).partial === true;
      const course = partial ? (e as { course?: { id: string } }).course : undefined;
      if (course?.id) {
        onSelectCourse(course.id);
        await load();
        onChanged();
      }
      toast.error(errorMessage(e, "Ошибка создания курса"), { duration: partial ? 8000 : 4000 });
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
          <code className="rounded bg-background/60 px-1 py-0.5 text-xs">client_courses</code>. Откройте
          SQL Editor проекта и выполните файл{" "}
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void createNew(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/25 px-3 py-1.5 text-sm hover:bg-gold/10 disabled:opacity-50"
          >
            <CalendarPlus className="h-4 w-4" />
            Новый курс
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createNew(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-background hover:bg-gold/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Новый + активировать
          </button>
        </div>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-warm-gray">
          Курсов пока нет. Создайте первый — контент скопируется из текущих программ.
        </p>
      ) : (
        <>
          {courses.filter((c) => c.status === "draft").length > 1 ? (
            <p className="text-xs leading-relaxed text-warm-gray">
              Несколько черновиков на одну дату — это следствие прошлых ошибок при создании. Оставьте
              один и удалите лишние кнопкой «Удалить».
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
}
