import { describe, expect, it } from "vitest";
import { courseWindowForAccess } from "@/lib/client-courses/access-window";

describe("course window follows trainer access", () => {
  it("moves a course created before access onto the access date", () => {
    const window = courseWindowForAccess(new Date("2026-11-15T11:25:42.229Z"), "2026-11-13");
    expect(window.shifted).toBe(true);
    expect(window.start).toBe("2026-11-15");
    expect(window.end).toBe("2026-12-12");
    expect(window.title).toBe("Курс (15.11.2026)-(12.12.2026)");
  });

  it("keeps a course that already starts on the access date", () => {
    const window = courseWindowForAccess(new Date("2026-11-15T11:25:42.229Z"), "2026-11-15");
    expect(window.shifted).toBe(false);
    expect(window.start).toBe("2026-11-15");
  });
});
