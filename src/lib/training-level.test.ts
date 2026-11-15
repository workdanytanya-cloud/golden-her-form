import { describe, expect, it } from "vitest";
import { levelTrainingLoad } from "@/lib/training";

describe("training level", () => {
  it("changes volume and rest, and contraindications keep the beginner load", () => {
    const beginner = levelTrainingLoad("beginner", 4, 60, false);
    const advanced = levelTrainingLoad("advanced", 4, 60, false);
    const capped = levelTrainingLoad("advanced", 4, 60, true);
    expect(beginner.sets).toBeLessThan(advanced.sets);
    expect(beginner.rest).toBeGreaterThan(advanced.rest);
    expect(beginner.tempo).not.toBe(advanced.tempo);
    expect(capped).toEqual(beginner);
  });
});
