import { describe, expect, it } from "vitest";
import {
  generateMultiWeekProgram,
  TrainingPoolGapError,
  type Exercise,
  type ProgramInput,
  type ReadyTrainingBlock,
} from "@/lib/training";

function exercise(partial: Partial<Exercise> & Pick<Exercise, "id" | "category">): Exercise {
  return {
    slug: partial.id,
    name: partial.id,
    muscle_groups: [],
    equipment: [],
    difficulty: "beginner",
    tags: [],
    description: null,
    cues: [],
    common_mistakes: [],
    gif_url: null,
    video_url: "https://rutube.ru/video/private/" + "a".repeat(32) + "/?p=test",
    default_sets: 3,
    default_reps: "10-12",
    tempo: null,
    rest_seconds: 60,
    ...partial,
  };
}

const input: ProgramInput = {
  sessions_per_week: 3,
  goal: "muscle_gain",
  level: "beginner",
  has_injuries: false,
  equipment: ["Ничего"],
  location: "home",
  gender: "female",
};

describe("strict training pool", () => {
  it("не сохраняет программу, если нет мобильности, и называет пробел", () => {
    const pool = [
      exercise({ id: "warm", category: "warmup" }),
      exercise({ id: "act", category: "activation" }),
      exercise({ id: "lower", category: "strength_lower" }),
      exercise({ id: "upper", category: "strength_upper" }),
      exercise({ id: "core", category: "core" }),
      exercise({ id: "cool", category: "cooldown" }),
    ];
    expect(() => generateMultiWeekProgram(pool, input, 1, { strict: true })).toThrow(
      TrainingPoolGapError,
    );
    try {
      generateMultiWeekProgram(pool, input, 1, { strict: true });
    } catch (error) {
      expect(error).toBeInstanceOf(TrainingPoolGapError);
      expect((error as TrainingPoolGapError).message).toContain("мобильность");
      expect((error as TrainingPoolGapError).message).toContain("Черновик не сохранён");
    }
  });

  it("собирает программу только из переданного пула", () => {
    const pool = [
      exercise({ id: "warm", category: "warmup" }),
      exercise({ id: "mob", category: "mobility" }),
      exercise({ id: "act", category: "activation" }),
      exercise({ id: "lower", category: "strength_lower" }),
      exercise({ id: "upper", category: "strength_upper" }),
      exercise({ id: "core", category: "core" }),
      exercise({ id: "cool", category: "cooldown" }),
    ];
    const days = generateMultiWeekProgram(pool, input, 1, { strict: true });
    const ids = new Set(pool.map((item) => item.id));
    for (const day of days.filter((item) => !item.is_rest)) {
      expect(day.warmup.length).toBeGreaterThan(0);
      expect(day.exercises.length).toBeGreaterThan(0);
      expect(day.cooldown.length).toBeGreaterThan(0);
      for (const set of [...day.warmup, ...day.exercises, ...day.cooldown]) {
        expect(ids.has(set.exercise_id)).toBe(true);
      }
    }
  });

  it("для похудения берёт strength_full вместо отсутствующего cardio и не берёт male-демо", () => {
    const pool = [
      exercise({ id: "warm", category: "warmup", tags: ["trainer_female"] }),
      exercise({ id: "mob", category: "mobility", tags: ["trainer_female"] }),
      exercise({ id: "act", category: "activation", tags: ["trainer_female"] }),
      exercise({ id: "lower", category: "strength_lower", tags: ["trainer_female"] }),
      exercise({ id: "upper", category: "strength_upper", tags: ["trainer_female"] }),
      exercise({ id: "core", category: "core", tags: ["trainer_female"] }),
      exercise({ id: "full", category: "strength_full", tags: ["trainer_female"] }),
      exercise({ id: "cool", category: "cooldown", tags: ["trainer_female"] }),
      exercise({ id: "male-upper", category: "strength_upper", tags: ["trainer_male"] }),
    ];
    const days = generateMultiWeekProgram(
      pool,
      { ...input, goal: "weight_loss", gender: "female" },
      1,
      { strict: true },
    );
    const used = days
      .filter((day) => !day.is_rest)
      .flatMap((day) => [...day.warmup, ...day.exercises, ...day.cooldown])
      .map((set) => set.exercise_id);
    expect(used).toContain("full");
    expect(used).not.toContain("male-upper");
  });

  it("берёт разминку с мобильностью и активацией одним блоком и не подменяет ею кардио", () => {
    const full = block("warm-full", "warmup", true, true);
    const mobilityOnly = block("warm-mobility", "warmup", true, false);
    const coolA = block("cool-a", "cooldown", false, false);
    const coolB = block("cool-b", "cooldown", false, false);
    const pool = [
      exercise({ id: "lower", category: "strength_lower" }),
      exercise({ id: "upper", category: "strength_upper" }),
      exercise({ id: "core", category: "core" }),
    ];
    const days = generateMultiWeekProgram(pool, input, 1, {
      strict: true,
      blocks: [mobilityOnly, full, coolA, coolB],
    });
    const training = days.filter((day) => !day.is_rest);
    for (const day of training) {
      expect(day.warmup.map((item) => item.exercise_id)).toEqual(["warm-full"]);
      expect(day.exercises.some((item) => item.exercise_id.startsWith("warm"))).toBe(false);
    }
    expect(training[0]?.cooldown[0]?.exercise_id).toBe("cool-a");
    expect(training[1]?.cooldown[0]?.exercise_id).toBe("cool-b");
    expect(() =>
      generateMultiWeekProgram(pool, { ...input, goal: "weight_loss" }, 1, {
        strict: true,
        blocks: [full, coolA],
      }),
    ).toThrow(/кардио/);
  });

  it("чередует две полные разминки и оставляет неполную, если активации в пуле нет", () => {
    const first = block("warm-1", "warmup", true, true);
    const second = block("warm-2", "warmup", true, true);
    const mobilityOnly = block("warm-mobility", "warmup", true, false);
    const pool = [
      exercise({ id: "lower", category: "strength_lower" }),
      exercise({ id: "upper", category: "strength_upper" }),
      exercise({ id: "core", category: "core" }),
      exercise({ id: "cool", category: "cooldown" }),
    ];
    const days = generateMultiWeekProgram(pool, input, 1, {
      strict: true,
      blocks: [first, second, mobilityOnly],
    });
    const warmups = days
      .filter((day) => !day.is_rest)
      .map((day) => day.warmup[0]?.exercise_id);
    expect(warmups).toEqual(["warm-1", "warm-2", "warm-1"]);
  });
});

function block(
  id: string,
  kind: ReadyTrainingBlock["kind"],
  coversMobility: boolean,
  coversActivation: boolean,
): ReadyTrainingBlock {
  return {
    id,
    kind,
    label: id,
    coversMobility,
    coversActivation,
    equipment: ["mat"],
  };
}
