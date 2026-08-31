/** 4 недели = 28 календарных дней (включая день старта). */
export const COURSE_DURATION_DAYS = 28;

export type ClientCourseStatus = "draft" | "active" | "completed" | "archived";

export function formatRuDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function courseEndDate(start: Date): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + COURSE_DURATION_DAYS - 1);
  return end;
}

export function formatCourseTitle(start: Date, end: Date): string {
  return `Курс (${formatRuDate(start)})-(${formatRuDate(end)})`;
}

export function buildCourseTitleFromISO(startIso: string): string {
  const start = parseISODate(startIso);
  return formatCourseTitle(start, courseEndDate(start));
}

export function courseStatusLabel(status: ClientCourseStatus): string {
  switch (status) {
    case "draft":
      return "Черновик";
    case "active":
      return "Активный";
    case "completed":
      return "Завершён";
    case "archived":
      return "В архиве";
  }
}
