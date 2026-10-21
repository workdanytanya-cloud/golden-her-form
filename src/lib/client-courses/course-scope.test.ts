import { describe, expect, it } from "vitest";

function migratedScope(kinds: Array<"nutrition" | "training">): "nutrition" | "training" | "both" {
  const nutrition = kinds.includes("nutrition");
  const training = kinds.includes("training");
  return nutrition && !training ? "nutrition" : training && !nutrition ? "training" : "both";
}

describe("program_scope migration rule", () => {
  it.each([
    [["nutrition"] as const, "nutrition"],
    [["training"] as const, "training"],
    [["nutrition", "training"] as const, "both"],
    [[] as const, "both"],
  ])("maps published assignments %j to %s", (kinds, expected) => {
    expect(migratedScope([...kinds])).toBe(expected);
  });
});
