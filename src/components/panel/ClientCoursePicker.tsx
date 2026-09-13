import { CalendarPlus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useClientCourses, courseStatusLabel } from "@/lib/client-course-context";
import { useState } from "react";

export function ClientCoursePicker({ showRenew = true }: { showRenew?: boolean }) {
  const { courses, selectedCourseId, selectedCourse, setSelectedCourseId, renewCourse, loading } =
    useClientCourses();
  const [renewing, setRenewing] = useState(false);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gold/10 bg-surface/20 px-4 py-3 text-sm text-warm-gray">
        Загружаем курсы…
      </div>
    );
  }

  if (courses.length === 0) {
    return null;
  }

  const onRenew = async () => {
    setRenewing(true);
    try {
      await renewCourse();
      toast.success("Новый курс создан. Тренер опубликует программу — вы получите уведомление.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать курс");
    } finally {
      setRenewing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gold/15 bg-surface/30 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-warm-gray">Ваши курсы</p>
        <div className="relative mt-1">
          <select
            className="w-full appearance-none rounded-xl border border-gold/20 bg-background/80 py-2.5 pl-3 pr-10 text-sm font-medium text-foreground"
            value={selectedCourseId ?? ""}
            onChange={(e) => setSelectedCourseId(e.target.value)}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} — {courseStatusLabel(c.status)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-gray" />
        </div>
        {selectedCourse ? (
          <p className="mt-1 text-xs text-warm-gray">
            {selectedCourse.start_date} → {selectedCourse.end_date}
          </p>
        ) : null}
      </div>
      {showRenew ? (
        <button
          type="button"
          onClick={() => void onRenew()}
          disabled={renewing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
        >
          <CalendarPlus className="h-4 w-4" />
          {renewing ? "Создаём…" : "Продлить курс"}
        </button>
      ) : null}
    </div>
  );
}
