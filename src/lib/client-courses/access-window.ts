import {
  buildCourseTitleFromISO,
  courseEndDate,
  parseISODate,
  toISODate,
} from "@/lib/client-courses/format";

export function courseWindowForAccess(
  activatedAt: Date,
  currentStartIso: string,
): { start: string; end: string; title: string; shifted: boolean } {
  const accessDay = toISODate(activatedAt);
  const current = currentStartIso.slice(0, 10);
  if (current >= accessDay) {
    const end = toISODate(courseEndDate(parseISODate(current)));
    return {
      start: current,
      end,
      title: buildCourseTitleFromISO(current),
      shifted: false,
    };
  }
  return {
    start: accessDay,
    end: toISODate(courseEndDate(parseISODate(accessDay))),
    title: buildCourseTitleFromISO(accessDay),
    shifted: true,
  };
}
