import { describe, expect, it, vi } from "vitest";
import { emptyDraftGate, finishLoading, programPageGate, selectCourse } from "./admin-program-page";
import type { ClientCourse } from "@/lib/client-courses/repo";

function course(patch: Partial<ClientCourse> = {}): ClientCourse {
  return {
    id: "course-1",
    client_id: "client-1",
    title: "Курс",
    start_date: "2026-11-13",
    end_date: "2026-12-10",
    status: "active",
    created_at: "2026-11-13T00:00:00.000Z",
    created_by: null,
    notes: null,
    program_scope: "both",
    ...patch,
  };
}

describe("admin program page states", () => {
  it("shows a normal empty state when the client has no course", () => {
    expect(selectCourse([], null)).toBeNull();
    expect(programPageGate(null, "nutrition").kind).toBe("no_course");
    expect(programPageGate(null, "training").kind).toBe("no_course");
  });

  it("covers nutrition, training and both scopes", () => {
    expect(programPageGate(course({ program_scope: "training" }), "nutrition").kind).toBe(
      "out_of_scope",
    );
    expect(programPageGate(course({ program_scope: "nutrition" }), "training").kind).toBe(
      "out_of_scope",
    );
    expect(programPageGate(course({ program_scope: "both" }), "nutrition").kind).toBe("ready");
    expect(programPageGate(course({ program_scope: "nutrition" }), "nutrition").kind).toBe("ready");
    expect(programPageGate(course({ program_scope: "training" }), "training").kind).toBe("ready");
  });

  it("keeps generation and failure visible without treating them as a missing course", () => {
    expect(
      programPageGate(
        course({ nutrition_generation_status: "generating" }),
        "nutrition",
      ).kind,
    ).toBe("generating");
    const failed = programPageGate(
      course({
        training_generation_status: "failed",
        training_generation_error: "Нет упражнений",
      }),
      "training",
    );
    expect(failed).toEqual({ kind: "failed", message: "Нет упражнений" });
    expect(emptyDraftGate(false).kind).toBe("missing_draft");
    expect(emptyDraftGate(true).kind).toBe("ready");
  });

  it("finishes loading after an API error", async () => {
    const setLoading = vi.fn();
    await expect(
      finishLoading(setLoading, async () => {
        throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
      }),
    ).rejects.toThrow("Курс не найден");
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
  });
});
