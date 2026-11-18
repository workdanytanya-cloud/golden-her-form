import { describe, expect, it } from "vitest";
import {
  acceptMediaSource,
  selectExercisePlayback,
  YOUTUBE_NETWORK_WARNING,
  type ExerciseVideo,
} from "@/lib/exercise-video";

const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const rutube = `https://rutube.ru/video/${"a".repeat(32)}/`;

function video(partial: Partial<ExerciseVideo>): ExerciseVideo {
  return {
    provider: "none",
    url: null,
    embed_url: null,
    title: null,
    status: "unchecked",
    fallback_text: null,
    ...partial,
  };
}

describe("exercise playback sources", () => {
  it("предпочитает подтверждённый Rutube и не встраивает YouTube", () => {
    const playback = selectExercisePlayback(
      video({
        provider: "youtube",
        url: youtube,
        embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        status: "ok",
      }),
      [
        acceptMediaSource({ url: rutube, provider: "rutube", status: "ok" })!,
        acceptMediaSource({ url: youtube, provider: "youtube", status: "ok" })!,
      ],
    );
    expect(playback.active).toBe("rutube");
    expect(playback.embedUrl).toContain("rutube.ru/play/embed/");
    expect(playback.youtube?.url).toContain("youtube.com");
    expect(playback.embedUrl).not.toContain("youtube.com");
  });

  it("для одного YouTube не возвращает iframe", () => {
    const playback = selectExercisePlayback(
      video({
        provider: "youtube",
        url: youtube,
        embed_url: "https://evil.test/embed",
        status: "ok",
      }),
    );
    expect(playback.active).toBe("youtube");
    expect(playback.embedUrl).toBeNull();
    expect(playback.message).toBe(YOUTUBE_NETWORK_WARNING);
    expect(playback.openUrl).toContain("youtube.com/watch");
  });

  it("игнорирует чужой embed и supabase", () => {
    expect(
      acceptMediaSource({
        url: "https://oezxswsw.supabase.co/storage/v1/object/public/media/a.mp4",
        provider: "external",
      }),
    ).toBeNull();
    const source = acceptMediaSource({
      url: rutube,
      provider: "rutube",
      status: "ok",
    });
    expect(source?.embed_url).toContain("rutube.ru/play/embed/");
    expect(source?.embed_url).not.toContain("evil.test");
  });
});
