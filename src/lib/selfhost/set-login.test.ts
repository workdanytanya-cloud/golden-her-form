import { describe, expect, it } from "vitest";
import { assertLoginEmail, maskEmail } from "@/lib/selfhost/set-login";

describe("selfhost set-login helpers", () => {
  it("маскирует email без полного адреса", () => {
    expect(maskEmail("alpha@example.test")).toBe("a***a@e***e.test");
    expect(maskEmail("ab@x.y")).toBe("a*@x*.y");
  });

  it("принимает обычный email и отклоняет пустые значения", () => {
    expect(assertLoginEmail("  User@Example.test ")).toBe("user@example.test");
    expect(() => assertLoginEmail("not-an-email")).toThrow(/формат/);
    expect(() => assertLoginEmail("user@localhost")).toThrow(/формат/);
  });
});
