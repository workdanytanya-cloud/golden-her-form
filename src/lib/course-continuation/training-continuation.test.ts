import { describe, expect, it } from "vitest";
import {
  advanceLevelForContinuation,
  applyContinuationProgression,
  buildContinuationTrainingProgram,
  peakSetsByExerciseId,
} from "@/lib/course-continuation/training-continuation";
import type { ProgramDay } from "@/lib/training";

const baseInput = {
  sessions_per_week: 3 as const,
  goal: "tone" as const,
  level: "beginner" as const,
  has_injuries: false,
  gender: "female" as const,
};

function trainingDay(
  week: number,
  day: number,
  exerciseId: string,
  sets: number,
): ProgramDay {
  return {
    week_index: week,
    day_index: day,
    is_rest: false,
    title: "Training",
    focus: null,
    description: null,
    warmup: [],
    exercises: [{ exercise_id: exerciseId, sets, reps: "10-12", rest_seconds: 60 }],
    cooldown: [],
    day_note: null,
  };
}

describe("training continuation", () => {
  it("advances level after second course", () => {
    expect(advanceLevelForContinuation("beginner", 2)).toBe("intermediate");
    expect(advanceLevelForContinuation("beginner", 1)).toBe("beginner");
  });

  it("extracts peak sets from last week", () => {
    const days = [
      trainingDay(0, 0, "ex-1", 3),
      trainingDay(3, 0, "ex-1", 4),
      trainingDay(3, 2, "ex-2", 5),
    ];
    const peak = peakSetsByExerciseId(days);
    expect(peak.get("ex-1")?.sets).toBe(4);
    expect(peak.get("ex-2")?.sets).toBe(5);
  });

  it("increases load through continuation weeks", () => {
    const previous = [trainingDay(3, 0, "ex-1", 4)];
    const base = [trainingDay(0, 0, "ex-1", 3), trainingDay(3, 0, "ex-1", 3)];
    const next = applyContinuationProgression(base, previous);
    expect(next[0]!.exercises[0]!.sets).toBeLessThan(4);
    expect(next[1]!.exercises[0]!.sets).toBeGreaterThan(4);
  });

  it("builds program without previous context", () => {
    const plan = buildContinuationTrainingProgram(
      [{ id: "1", slug: "x", name: "X", category: "core", muscle_groups: [], equipment: [], difficulty: "beginner", tags: ["sheet"], description: null, cues: [], common_mistakes: [], gif_url: null, video_url: null, default_sets: 3, default_reps: "10", tempo: null, rest_seconds: 60 }] as import("@/lib/training").Exercise[],
      baseInput,
      null,
    );
    expect(plan.programWeeks).toBe(4);
  });
});
