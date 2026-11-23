import { describe, expect, it } from "vitest";
import { programVideoBindingKeys } from "@/lib/selfhost/program-video";
import type { TrainingSnapshot } from "@/lib/published-programs/types";

const exerciseId = "11111111-1111-4111-8111-111111111111";

function snapshot(): TrainingSnapshot {
  return {
    name: "Проверка",
    sessions_per_week: 3,
    goal: "tone",
    level: "beginner",
    has_injuries: false,
    injuries_details: null,
    equipment: [],
    location: "home",
    notes: null,
    faq: [],
    program_weeks: 1,
    days: [
      {
        week_index: 0,
        day_index: 0,
        is_rest: false,
        title: "День",
        focus: null,
        description: null,
        warmup: [],
        exercises: [
          {
            exercise_id: exerciseId,
            sets: 1,
            reps: "10",
            rest_seconds: 30,
            tempo: null,
            note: null,
            exercise: {
              id: exerciseId,
              slug: "plank",
              name: "Планка",
              category: "core",
              muscle_groups: [],
              equipment: [],
              difficulty: "beginner",
              tags: [],
              description: null,
              cues: [],
              common_mistakes: [],
              gif_url: null,
              video_url: null,
              default_sets: 1,
              default_reps: "10",
              tempo: null,
              rest_seconds: 30,
            },
          },
        ],
        cooldown: [],
        day_note: null,
      },
    ],
  };
}

describe("привязка видео к программе", () => {
  it("привязывает ссылку по id упражнения внутри версии", () => {
    expect(programVideoBindingKeys(snapshot(), exerciseId)).toEqual({ keys: ["0:0:exercises:0"] });
  });

  it("не предлагает общий каталог, если упражнения в программе нет", () => {
    const result = programVideoBindingKeys(snapshot(), "22222222-2222-4222-8222-222222222222");
    expect("error" in result).toBe(true);
  });
});
