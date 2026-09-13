import { describe, expect, it } from "vitest";
import {
  isAllowedEmbedUrl,
  normalizeExerciseVideo,
  parseHttpsUrl,
  videoFromLegacyFields,
} from "@/lib/exercise-video";
import {
  freezeExercise,
  exercisesFromTrainingSnapshot,
  buildTrainingSnapshot,
} from "@/lib/published-programs/training-snapshot";
import type { Exercise, ProgramDay } from "@/lib/training";
import { contentHash } from "@/lib/published-programs/hash";

function sampleEx(over: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex1",
    slug: "squat",
    name: "Приседания",
    category: "strength_lower",
    muscle_groups: ["quads"],
    equipment: ["bodyweight"],
    difficulty: "beginner",
    tags: [],
    description: "Спина прямая",
    cues: ["Колени наружу"],
    common_mistakes: [],
    gif_url: null,
    video_url: null,
    default_sets: 3,
    default_reps: "12",
    tempo: "2-0-2",
    rest_seconds: 60,
    ...over,
  };
}

describe("exercise video links", () => {
  it("принимает YouTube youtube.com и youtu.be", () => {
    const a = normalizeExerciseVideo({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(a.provider).toBe("youtube");
    expect(a.status).toBe("ok");
    expect(a.embed_url).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(isAllowedEmbedUrl(a.embed_url)).toBe(true);

    const b = normalizeExerciseVideo({ url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(b.provider).toBe("youtube");
    expect(b.embed_url).toBe(a.embed_url);
  });

  it("принимает Rutube watch и embed", () => {
    const id = "a".repeat(32);
    const watch = normalizeExerciseVideo({ url: `https://rutube.ru/video/${id}/` });
    expect(watch.provider).toBe("rutube");
    expect(watch.embed_url).toContain(`/play/embed/${id}/`);
    expect(isAllowedEmbedUrl(watch.embed_url)).toBe(true);

    const embed = normalizeExerciseVideo({
      url: `https://rutube.ru/play/embed/${id}/?skinColor=000000`,
    });
    expect(embed.provider).toBe("rutube");
    expect(embed.status).toBe("ok");
  });

  it("отклоняет неверный URL, http и HTML", () => {
    expect(parseHttpsUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(normalizeExerciseVideo({ url: "http://youtube.com/watch?v=dQw4w9WgXcQ" }).status).toBe(
      "unavailable",
    );
    expect(normalizeExerciseVideo({ url: "javascript:alert(1)" }).status).toBe("unavailable");
    expect(normalizeExerciseVideo({ url: "not-a-url" }).status).toBe("unavailable");
    expect(
      normalizeExerciseVideo({ url: "<iframe src='https://evil.test'></iframe>" }).status,
    ).toBe("unavailable");
    const sneaky = normalizeExerciseVideo({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      video: { embed_url: "https://evil.test/embed" },
    });
    expect(sneaky.embed_url).not.toContain("evil.test");
    expect(isAllowedEmbedUrl("https://evil.test/embed")).toBe(false);
  });

  it("отсутствующее видео не ломает нормализацию", () => {
    const empty = normalizeExerciseVideo({ video_url: null });
    expect(empty.provider).toBe("none");
    expect(empty.embed_url).toBeNull();
    expect(empty.url).toBeNull();
    const withFallback = normalizeExerciseVideo({
      video_url: "",
      fallback_text: "Смотрите подсказки по технике ниже",
    });
    expect(withFallback.fallback_text).toBe("Смотрите подсказки по технике ниже");
    expect(withFallback.embed_url).toBeNull();
  });

  it("читает legacy video_url", () => {
    const video = videoFromLegacyFields({
      video_url: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(video.provider).toBe("youtube");
    expect(video.url).toContain("dQw4w9WgXcQ");
  });

  it("замораживает video в новом snapshot и читает legacy snapshot без мутации", () => {
    const live = sampleEx({
      video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      video: normalizeExerciseVideo({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Присед с тренером",
        fallback_text: "Повторите по подсказкам",
      }),
    });
    const frozen = freezeExercise(live);
    expect(frozen.video?.provider).toBe("youtube");
    expect(frozen.video_url).toContain("dQw4w9WgXcQ");

    const legacyFrozen = {
      ...frozen,
      video: undefined,
      video_url: "https://rutube.ru/video/" + "b".repeat(32) + "/",
    };
    const originalHash = contentHash(legacyFrozen);
    const day: ProgramDay = {
      week_index: 0,
      day_index: 0,
      is_rest: false,
      title: "День 1",
      focus: null,
      description: null,
      warmup: [],
      exercises: [{ exercise_id: "ex1", sets: 3, reps: "10", rest_seconds: 45, tempo: "2-0-1" }],
      cooldown: [],
      day_note: null,
    };
    const snap = buildTrainingSnapshot({
      sessions_per_week: 3,
      goal: "tone",
      level: "beginner",
      has_injuries: false,
      injuries_details: null,
      equipment: [],
      location: "home",
      notes: null,
      faq: [],
      program_weeks: 4,
      days: [day],
      exercises: [live],
    });
    expect(snap.days[0]!.exercises[0]!.exercise?.video?.provider).toBe("youtube");

    const restored = exercisesFromTrainingSnapshot({
      ...snap,
      days: [
        {
          ...snap.days[0]!,
          exercises: [
            {
              ...snap.days[0]!.exercises[0]!,
              exercise: legacyFrozen,
            },
          ],
        },
      ],
    });
    expect(restored[0]!.video?.provider).toBe("rutube");
    expect(contentHash(legacyFrozen)).toBe(originalHash);

    const catalogChanged = sampleEx({
      video_url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    });
    expect(frozen.video_url).not.toBe(catalogChanged.video_url);
  });
});
