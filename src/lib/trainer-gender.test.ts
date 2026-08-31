import { describe, expect, it } from "vitest";
import {
  exerciseTrainerGender,
  filterExercisesForClientGender,
  isExerciseAllowedForClientGender,
  preferExerciseForClientGender,
  trainerGenderScore,
  type Exercise,
} from "@/lib/training";

function ex(partial: Partial<Exercise> & Pick<Exercise, "id" | "slug" | "name">): Exercise {
  return {
    category: "strength_lower",
    muscle_groups: ["ягодицы"],
    equipment: [],
    difficulty: "beginner",
    tags: [],
    description: null,
    cues: [],
    common_mistakes: [],
    gif_url: null,
    video_url: "https://example.com/v.mp4",
    default_sets: 3,
    default_reps: "10",
    tempo: null,
    rest_seconds: 45,
    ...partial,
  };
}

describe("trainer demo gender", () => {
  it("marks sheet/panova as female", () => {
    expect(
      exerciseTrainerGender(
        ex({ id: "1", slug: "sheet-squat", name: "Присед", tags: ["sheet", "panova"] }),
      ),
    ).toBe("female");
  });

  it("marks stock gif-only demos as male", () => {
    expect(
      exerciseTrainerGender(
        ex({
          id: "2",
          slug: "goblet-squat",
          name: "Goblet",
          tags: [],
          gif_url: "/__l5e/assets-v1/x/goblet-squat.mp4",
          video_url: null,
        }),
      ),
    ).toBe("male");
  });

  it("blocks male demos for female and unknown gender", () => {
    const male = ex({
      id: "m",
      slug: "pushup",
      name: "Pushup",
      tags: ["trainer_male"],
    });
    expect(isExerciseAllowedForClientGender(male, "female")).toBe(false);
    expect(isExerciseAllowedForClientGender(male, null)).toBe(false);
    expect(isExerciseAllowedForClientGender(male, "male")).toBe(true);
  });

  it("filters catalog so female clients never get male stock", () => {
    const femaleSheet = ex({
      id: "f",
      slug: "sheet-a",
      name: "A",
      tags: ["sheet"],
    });
    const maleStock = ex({
      id: "m",
      slug: "plank",
      name: "Plank",
      gif_url: "/__l5e/assets-v1/x/plank.mp4",
      video_url: null,
    });
    const out = filterExercisesForClientGender([femaleSheet, maleStock], "female");
    expect(out.map((e) => e.id)).toEqual(["f"]);
  });

  it("for male clients prefers male-only pool when available", () => {
    const femaleSheet = ex({
      id: "f",
      slug: "sheet-a",
      name: "A",
      tags: ["sheet", "trainer_female"],
    });
    const maleStock = ex({
      id: "m",
      slug: "plank",
      name: "Plank",
      tags: ["trainer_male"],
      gif_url: "/__l5e/x.mp4",
      video_url: null,
    });
    const out = filterExercisesForClientGender([femaleSheet, maleStock], "male");
    expect(out.map((e) => e.id)).toEqual(["m"]);
  });

  it("preferExercise swaps male pick for female twin", () => {
    const male = ex({
      id: "m",
      slug: "pushup",
      name: "Push",
      category: "strength_upper",
      muscle_groups: ["грудь"],
      tags: ["trainer_male"],
    });
    const female = ex({
      id: "f",
      slug: "sheet-push",
      name: "Push F",
      category: "strength_upper",
      muscle_groups: ["грудь"],
      tags: ["sheet", "trainer_female"],
    });
    const picked = preferExerciseForClientGender(male, [male, female], "female");
    expect(picked.id).toBe("f");
    expect(trainerGenderScore(female, "female")).toBeGreaterThan(
      trainerGenderScore(male, "female"),
    );
  });
});
