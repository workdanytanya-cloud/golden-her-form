import { describe, expect, it } from "vitest";
import { manualReplacementDay } from "@/lib/selfhost/rutube-manual";
import {
  clientAllowsMaleWorkouts,
  isManualWorkoutCollection,
} from "@/lib/selfhost/rutube-manual-shared";

describe("male workout folder", () => {
  it("разрешает мужские тренировки только при gender=male", () => {
    expect(clientAllowsMaleWorkouts("male")).toBe(true);
    expect(clientAllowsMaleWorkouts("female")).toBe(false);
    expect(clientAllowsMaleWorkouts(null)).toBe(false);
    expect(clientAllowsMaleWorkouts(undefined)).toBe(false);
  });

  it("считает workout_male папкой целых тренировок", () => {
    expect(isManualWorkoutCollection("workout")).toBe(true);
    expect(isManualWorkoutCollection("workout_male")).toBe(true);
    expect(isManualWorkoutCollection("piece")).toBe(false);
  });
});

const day = {
  title: "Силовая",
  focus: "Ноги",
  description: "Исходный день",
  is_rest: false,
  warmup: [{ exercise_id: "warm-old", sets: 1, reps: "5" }],
  exercises: [
    { exercise_id: "main-a", sets: 3, reps: "12" },
    { exercise_id: "main-b", sets: 4, reps: "8" },
  ],
  cooldown: [{ exercise_id: "cool-old", sets: 1, reps: "30 сек" }],
  day_note: "заметка",
};

describe("manual rutube replacement", () => {
  it("replaces one exercise and keeps its sets", () => {
    const next = manualReplacementDay(day, {
      scope: "set",
      exerciseId: "piece-1",
      label: "Планка",
      section: "exercises",
      setIndex: 1,
    });
    expect(next.exercises[1]).toMatchObject({ exercise_id: "piece-1", sets: 4, reps: "8" });
    expect(next.exercises[0].exercise_id).toBe("main-a");
    expect(next.warmup).toEqual(day.warmup);
    expect(next.day_note).toBe("заметка");
  });

  it("replaces a whole block with one confirmed item", () => {
    const next = manualReplacementDay(day, {
      scope: "section",
      exerciseId: "warm-1",
      label: "Разминка — версия 1",
      section: "warmup",
    });
    expect(next.warmup).toEqual([
      { exercise_id: "warm-1", sets: 1, reps: "блок", rest_seconds: 0, tempo: null, note: null },
    ]);
    expect(next.exercises).toEqual(day.exercises);
  });

  it("replaces the whole workout and leaves the day note", () => {
    const next = manualReplacementDay(day, {
      scope: "workout",
      exerciseId: "session-1",
      label: "Тренировка 1",
    });
    expect(next.title).toBe("Тренировка 1");
    expect(next.warmup).toEqual([]);
    expect(next.cooldown).toEqual([]);
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].exercise_id).toBe("session-1");
    expect(next.day_note).toBe("заметка");
  });
});
