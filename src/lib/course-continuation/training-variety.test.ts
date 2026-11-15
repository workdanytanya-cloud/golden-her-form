import { describe, expect, it } from "vitest";
import { assessTrainingVariety } from "./training-variety";
import type { ProgramDay } from "@/lib/training";

function day(week: number, index: number, ids: string[]): ProgramDay {
  return {
    week_index: week,
    day_index: index,
    is_rest: false,
    title: "День",
    focus: null,
    description: null,
    warmup: [],
    exercises: ids.map((exercise_id) => ({
      exercise_id,
      sets: 3,
      reps: "10-12",
      rest_seconds: 60,
    })),
    cooldown: [],
    day_note: null,
  };
}

describe("training variety", () => {
  it("rejects a copied week and a rearranged copy of the same exercises", () => {
    const previous = [day(0, 0, ["a", "b"]), day(0, 2, ["c", "d"])];
    const copied = [day(0, 0, ["a", "b"]), day(0, 2, ["c", "d"])];
    const rearranged = [day(0, 0, ["b", "a"]), day(0, 2, ["d", "c"])];
    expect(assessTrainingVariety(copied, previous).ok).toBe(false);
    expect(assessTrainingVariety(rearranged, previous).novelRatio).toBe(0);
  });

  it("allows the same exercises in a later week when the load progresses", () => {
    const days = [day(0, 0, ["a", "b"]), day(1, 0, ["b", "a"])];
    expect(assessTrainingVariety(days, null).duplicateDays).toBe(false);
    expect(assessTrainingVariety(days, null).ok).toBe(true);
  });

  it("rejects two identical training days", () => {
    const days = [day(0, 0, ["a", "b"]), day(0, 2, ["b", "a"])];
    expect(assessTrainingVariety(days, null).duplicateDays).toBe(true);
  });

  it("accepts a program where at least 70 percent of exercises are new", () => {
    const previous = [day(0, 0, ["a", "b", "c", "d"])];
    const next = [day(0, 0, ["a", "e", "f", "g"]), day(0, 2, ["h", "i"])];
    const result = assessTrainingVariety(next, previous);
    expect(result.novelRatio).toBeGreaterThanOrEqual(0.7);
    expect(result.ok).toBe(true);
  });
});
