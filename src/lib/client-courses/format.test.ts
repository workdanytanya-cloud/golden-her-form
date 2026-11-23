import { describe, expect, it } from "vitest";
import { clientFacingCourseStatusLabel, courseStatusLabel } from "@/lib/client-courses/format";

describe("clientFacingCourseStatusLabel", () => {
  it("never shows Черновик to the client", () => {
    expect(courseStatusLabel("draft")).toBe("Черновик");
    expect(clientFacingCourseStatusLabel({ status: "draft" })).toBe("В подготовке");
    expect(
      clientFacingCourseStatusLabel({ status: "draft", nutrition_published: true }),
    ).toBe("Активный");
    expect(clientFacingCourseStatusLabel({ status: "active" })).toBe("Активный");
  });
});
