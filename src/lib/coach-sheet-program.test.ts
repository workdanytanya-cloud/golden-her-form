import { describe, expect, it } from "vitest";
import {
  resolveAdaptiveTrainingProgram,
  summarizeTrainingPlan,
} from "@/lib/coach-sheet-program";
import type { Exercise, ExerciseCategory, ProgramInput } from "@/lib/training";

function mockEx(
  id: string,
  category: ExerciseCategory,
  extras: Partial<Exercise> = {},
): Exercise {
  return {
    id,
    slug: id,
    name: id,
    category,
    muscle_groups: extras.muscle_groups ?? ["ягодицы", "спина", "грудные", "плечи"],
    equipment: extras.equipment ?? ["bodyweight"],
    difficulty: extras.difficulty ?? "beginner",
    tags: extras.tags ?? ["sheet"],
    description: null,
    cues: [],
    common_mistakes: [],
    gif_url: null,
    video_url: extras.video_url ?? "https://example.com/v.mp4",
    default_sets: 3,
    default_reps: "10-12",
    tempo: null,
    rest_seconds: 60,
    ...extras,
  };
}

function catalog(): Exercise[] {
  const cats: ExerciseCategory[] = [
    "warmup",
    "mobility",
    "activation",
    "core",
    "strength_lower",
    "strength_upper",
    "strength_full",
    "cardio",
    "cooldown",
  ];
  const out: Exercise[] = [];
  for (const cat of cats) {
    for (let i = 1; i <= 6; i++) {
      out.push(
        mockEx(`${cat}-${i}`, cat, {
          muscle_groups:
            cat === "strength_lower"
              ? ["ягодицы", "квадрицепс", "задняя поверхность"]
              : cat === "strength_upper"
                ? ["грудные", "спина", "плечи", "бицепс", "трицепс"]
                : ["кор"],
        }),
      );
    }
  }
  return out;
}

const baseInput: ProgramInput = {
  sessions_per_week: 3,
  goal: "tone",
  level: "beginner",
  has_injuries: false,
  equipment: ["Ничего"],
  location: "home",
  weight_kg: 62,
  gender: "female",
};

describe("adaptive training regenerate", () => {
  const exercises = catalog();

  it("changes training weekdays when sessions go from 3 to 4", () => {
    const three = resolveAdaptiveTrainingProgram(exercises, { ...baseInput, sessions_per_week: 3 });
    const four = resolveAdaptiveTrainingProgram(exercises, { ...baseInput, sessions_per_week: 4 });
    const days3 = three.days.filter((d) => (d.week_index ?? 0) === 0 && !d.is_rest).map((d) => d.day_index);
    const days4 = four.days.filter((d) => (d.week_index ?? 0) === 0 && !d.is_rest).map((d) => d.day_index);
    expect(days3).toEqual([0, 2, 4]);
    expect(days4).toEqual([0, 1, 3, 5]);
    expect(summarizeTrainingPlan(four.days).trainingDaysPerWeek).toBe(4);
  });

  it("changes day split when goal changes", () => {
    const loss = resolveAdaptiveTrainingProgram(exercises, { ...baseInput, goal: "weight_loss" });
    const gain = resolveAdaptiveTrainingProgram(exercises, { ...baseInput, goal: "muscle_gain" });
    const lossTitles = loss.days.filter((d) => !d.is_rest).map((d) => d.title).join(" ");
    const gainTitles = gain.days.filter((d) => !d.is_rest).map((d) => d.title).join(" ");
    expect(lossTitles).toMatch(/Full Body/);
    expect(gainTitles).toMatch(/Push|Pull|Legs/);
    expect(lossTitles).not.toBe(gainTitles);
  });

  it("fills first training day with exercises", () => {
    const plan = resolveAdaptiveTrainingProgram(exercises, baseInput);
    const summary = summarizeTrainingPlan(plan.days);
    expect(summary.firstExerciseCount).toBeGreaterThanOrEqual(3);
    expect(plan.days).toHaveLength(28);
  });
});
