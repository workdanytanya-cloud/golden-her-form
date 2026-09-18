/** Нормализация и валидация ссылок на видео упражнений. Без пользовательского HTML. */

export const EXERCISE_VIDEO_PROVIDERS = ["youtube", "rutube", "external", "none"] as const;
export type ExerciseVideoProvider = (typeof EXERCISE_VIDEO_PROVIDERS)[number];

export const EXERCISE_VIDEO_STATUSES = ["ok", "unavailable", "unchecked"] as const;
export type ExerciseVideoStatus = (typeof EXERCISE_VIDEO_STATUSES)[number];

export type ExerciseVideo = {
  provider: ExerciseVideoProvider;
  url: string | null;
  embed_url: string | null;
  title: string | null;
  status: ExerciseVideoStatus;
  fallback_text: string | null;
};

export const EMPTY_EXERCISE_VIDEO: ExerciseVideo = {
  provider: "none",
  url: null,
  embed_url: null,
  title: null,
  status: "unchecked",
  fallback_text: null,
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

const YOUTUBE_EMBED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

const RUTUBE_HOSTS = new Set(["rutube.ru", "www.rutube.ru", "rutube.com", "www.rutube.com"]);

const MAX_TITLE = 200;
const MAX_FALLBACK = 500;
const MAX_URL = 2000;

export function stripUnsafeText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const withoutTags = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/gi, " ")
    .replace(/&gt;/gi, " ")
    .replace(/javascript:/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutTags) return null;
  return withoutTags.slice(0, max);
}

export function parseHttpsUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL) return null;
  if (/[\s<>]/.test(trimmed) || /javascript:/i.test(trimmed) || /data:/i.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) && !YOUTUBE_HOSTS.has(host)) return null;
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const embed = url.pathname.match(/\/embed\/([\w-]{11})/);
  if (embed) return embed[1];
  const shorts = url.pathname.match(/\/shorts\/([\w-]{11})/);
  if (shorts) return shorts[1];
  return null;
}

export function rutubeVideoId(url: URL): string | null {
  const host = hostOf(url);
  if (host !== "rutube.ru" && host !== "rutube.com") return null;
  const fromPath =
    url.pathname.match(/\/video\/(?:private\/)?([a-f0-9]{32})\/?/i) ??
    url.pathname.match(/\/play\/embed\/([a-f0-9]{32})\/?/i);
  return fromPath?.[1]?.toLowerCase() ?? null;
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

export function rutubeEmbedUrl(id: string, privateParam?: string | null): string {
  const embed = new URL(`https://rutube.ru/play/embed/${id}/`);
  if (privateParam) embed.searchParams.set("p", privateParam);
  embed.searchParams.set("skinColor", "000000");
  return embed.toString();
}

export function isAllowedEmbedUrl(raw: string | null | undefined): boolean {
  const url = parseHttpsUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  const bare = host.replace(/^www\./, "");
  if (YOUTUBE_EMBED_HOSTS.has(host) || YOUTUBE_EMBED_HOSTS.has(bare)) {
    return /\/embed\/[\w-]{11}(\?|$)/.test(url.pathname) && youtubeVideoId(url) != null;
  }
  if (bare === "rutube.ru" || bare === "rutube.com") {
    return /\/play\/embed\/[a-f0-9]{32}/i.test(url.pathname) && rutubeVideoId(url) != null;
  }
  return false;
}

export type VideoInput = {
  video_url?: string | null;
  url?: string | null;
  video_provider?: string | null;
  video_embed_url?: string | null;
  video_title?: string | null;
  video_status?: string | null;
  video_fallback_text?: string | null;
  title?: string | null;
  fallback_text?: string | null;
  video?: Partial<ExerciseVideo> | null;
};

/**
 * Серверная нормализация: provider и embed_url считаются заново из https-URL.
 * Сохранённый embed_url из клиента игнорируется (защита от произвольного iframe).
 */
export function normalizeExerciseVideo(input: VideoInput | null | undefined): ExerciseVideo {
  const nested = input?.video ?? null;
  const rawUrl = nested?.url ?? input?.url ?? input?.video_url ?? null;
  const title = stripUnsafeText(nested?.title ?? input?.title ?? input?.video_title, MAX_TITLE);
  const fallback_text = stripUnsafeText(
    nested?.fallback_text ?? input?.fallback_text ?? input?.video_fallback_text,
    MAX_FALLBACK,
  );

  if (!rawUrl || !String(rawUrl).trim()) {
    return {
      provider: "none",
      url: null,
      embed_url: null,
      title,
      status: fallback_text ? "unavailable" : "unchecked",
      fallback_text,
    };
  }

  const trimmedRaw = String(rawUrl).trim();
  // Same-origin selfhost media files (mp4/webm) — playable via <video>, not embed hosts.
  if (
    trimmedRaw.startsWith("/api/selfhost/media?") ||
    trimmedRaw.startsWith("/api/selfhost/media/")
  ) {
    const looksVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(trimmedRaw);
    return {
      provider: "external",
      url: trimmedRaw.slice(0, MAX_URL),
      embed_url: null,
      title,
      status: looksVideo ? "ok" : "unavailable",
      fallback_text: looksVideo
        ? fallback_text
        : (fallback_text ?? "Видео временно недоступно. Выполняйте по подсказкам."),
    };
  }

  const parsed = parseHttpsUrl(rawUrl);
  if (!parsed) {
    return {
      provider: "none",
      url: null,
      embed_url: null,
      title,
      status: "unavailable",
      fallback_text:
        fallback_text ??
        "Видео недоступно: нужна ссылка https на YouTube, Rutube или внешнюю страницу.",
    };
  }

  const yt = youtubeVideoId(parsed);
  if (yt) {
    const embed = youtubeEmbedUrl(yt);
    return {
      provider: "youtube",
      url: `https://www.youtube.com/watch?v=${yt}`,
      embed_url: isAllowedEmbedUrl(embed) ? embed : null,
      title,
      status: "ok",
      fallback_text,
    };
  }

  const rt = rutubeVideoId(parsed);
  if (rt) {
    const privateParam = parsed.searchParams.get("p");
    const embed = rutubeEmbedUrl(rt, privateParam);
    const isPrivate = /\/video\/private\//i.test(parsed.pathname) || Boolean(privateParam);
    const canonical = isPrivate
      ? `https://rutube.ru/video/private/${rt}/${privateParam ? `?p=${encodeURIComponent(privateParam)}` : ""}`
      : `https://rutube.ru/video/${rt}/`;
    return {
      provider: "rutube",
      url: canonical,
      embed_url: isAllowedEmbedUrl(embed) ? embed : null,
      title,
      status: "ok",
      fallback_text,
    };
  }

  return {
    provider: "external",
    url: parsed.toString(),
    embed_url: null,
    title,
    status: "ok",
    fallback_text,
  };
}

export function requireYoutubeOrRutubeUrl(raw: string | null | undefined): ExerciseVideo {
  if (!raw || !String(raw).trim()) {
    return { ...EMPTY_EXERCISE_VIDEO };
  }
  const video = normalizeExerciseVideo({ url: raw });
  if (video.provider !== "youtube" && video.provider !== "rutube") {
    throw Object.assign(
      new Error("Нужна ссылка https на YouTube (youtube.com / youtu.be) или Rutube"),
      { statusCode: 400 },
    );
  }
  return video;
}

/** Адаптер для каталога и legacy snapshots: video_url + опциональный объект video. */
export function videoFromLegacyFields(input: VideoInput | null | undefined): ExerciseVideo {
  return normalizeExerciseVideo(input);
}

export function catalogVideoColumns(video: ExerciseVideo): {
  video_url: string | null;
  video_provider: string;
  video_embed_url: string | null;
  video_title: string | null;
  video_status: string;
  video_fallback_text: string | null;
} {
  return {
    video_url: video.url,
    video_provider: video.provider,
    video_embed_url: video.embed_url,
    video_title: video.title,
    video_status: video.status,
    video_fallback_text: video.fallback_text,
  };
}
