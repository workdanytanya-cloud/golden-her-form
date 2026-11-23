import { describe, expect, it } from "vitest";
import { listedVideoUrl, resolveDisplayVideo, type ExerciseMediaBinding } from "@/lib/selfhost/media";

const binding: ExerciseMediaBinding = {
  exercise_id: "11111111-1111-4111-8111-111111111111",
  provider: "youtube",
  source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  title: "старое",
  status: "ok",
  fallback_text: null,
};

describe("snapshot video pin", () => {
  it("старая версия без отдельной ссылки остаётся на общей привязке", () => {
    const video = resolveDisplayVideo({
      exerciseId: binding.exercise_id,
      snapshotKey: "0:0:exercises:0",
      byExerciseId: new Map([[binding.exercise_id, binding]]),
      snapshotBindings: [
        {
          version_id: "v1",
          snapshot_exercise_key: "0:0:exercises:0",
          exercise_id: binding.exercise_id,
          confirmed_by_trainer: false,
          source_url: null,
        },
      ],
    });
    expect(video?.provider).toBe("youtube");
  });

  it("новая версия показывает ссылку, записанную только в эту версию", () => {
    const id = "ab".repeat(16);
    const video = resolveDisplayVideo({
      exerciseId: binding.exercise_id,
      snapshotKey: "0:0:exercises:0",
      byExerciseId: new Map([[binding.exercise_id, binding]]),
      snapshotBindings: [
        {
          version_id: "v2",
          snapshot_exercise_key: "0:0:exercises:0",
          exercise_id: binding.exercise_id,
          confirmed_by_trainer: true,
          source_url: `https://rutube.ru/video/private/${id}/?p=keep-me`,
        },
      ],
    });
    expect(video?.provider).toBe("rutube");
    expect(video?.status).toBe("unchecked");
    expect(video?.url).toContain("?p=keep-me");
    expect(video?.embed_url).toContain("/play/embed/");
    expect(video?.embed_url).toContain("p=keep-me");
  });
});

describe("видимость ссылки после замены", () => {
  it("не прячет непроверенный Rutube, если колонка каталога уже пустая", () => {
    const hidden = "https://rutube.ru/video/private/" + "e".repeat(32) + "/?p=keep-me";
    expect(listedVideoUrl(null, hidden, "unchecked")).toBe(hidden);
    expect(listedVideoUrl("https://youtu.be/dQw4w9WgXcQ", hidden, "unchecked")).toBe(hidden);
    expect(listedVideoUrl("https://youtu.be/dQw4w9WgXcQ", hidden, "unavailable")).toContain("youtu.be");
    expect(listedVideoUrl(null, null, "unchecked")).toBeNull();
  });
});
