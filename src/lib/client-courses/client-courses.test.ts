import { describe, expect, it } from "vitest";
import {
  buildCourseTitleFromISO,
  courseEndDate,
  formatCourseTitle,
  parseISODate,
  toISODate,
} from "@/lib/client-courses/format";

describe("client course title", () => {
  it("formats 28-day period", () => {
    const start = parseISODate("2026-08-31");
    const end = courseEndDate(start);
    expect(toISODate(end)).toBe("2026-09-27");
    expect(formatCourseTitle(start, end)).toBe("Курс (31.08.2026)-(27.09.2026)");
  });

  it("builds title from ISO start", () => {
    expect(buildCourseTitleFromISO("2026-01-01")).toBe("Курс (01.01.2026)-(28.01.2026)");
  });
});
