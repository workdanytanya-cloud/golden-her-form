import { describe, expect, it } from "vitest";
import {
  exerciseVideoDedupeKey,
  planExerciseArchiveDuplicates,
} from "@/lib/selfhost/exercise-dedupe";

describe("exercise-dedupe", () => {
  it("не архивирует карточки с одинаковым названием, но разным видео", () => {
    const plan = planExerciseArchiveDuplicates([
      {
        id: "a",
        name: "Тяга амортизатора сидя на стуле",
        category: "strength_upper",
        equipment: ["band", "mat", "chair"],
        video_url: "https://youtu.be/CE1RYi-1eHc",
        archived: false,
      },
      {
        id: "b",
        name: "Тяга амортизатора сидя на стуле",
        category: "strength_upper",
        equipment: ["band", "mat", "chair"],
        video_url: "https://youtu.be/ToARC67MShM",
        archived: false,
      },
    ]);
    expect(plan.archiveIds).toEqual([]);
  });

  it("архивирует подтверждённый дубль по движению, варианту и видео", () => {
    expect(exerciseVideoDedupeKey("https://www.youtube.com/watch?v=CE1RYi-1eHc")).toBe(
      exerciseVideoDedupeKey("https://youtu.be/CE1RYi-1eHc"),
    );
    const plan = planExerciseArchiveDuplicates([
      {
        id: "keep",
        name: "Тяга амортизатора сидя на стуле",
        category: "strength_upper",
        equipment: ["chair", "band", "mat"],
        video_url: "https://youtu.be/CE1RYi-1eHc",
        archived: false,
        publishedUseCount: 2,
        description: "подробная техника",
      },
      {
        id: "drop",
        name: "Тяга амортизатора сидя на стуле",
        category: "strength_upper",
        equipment: ["band", "mat", "chair"],
        video_url: "https://www.youtube.com/watch?v=CE1RYi-1eHc",
        archived: false,
        publishedUseCount: 0,
        description: "коротко",
      },
    ]);
    expect(plan.keepIds).toEqual(["keep"]);
    expect(plan.archiveIds).toEqual(["drop"]);
  });
});
