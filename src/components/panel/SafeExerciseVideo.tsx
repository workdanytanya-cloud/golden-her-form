import { useEffect, useState, type ReactNode } from "react";
import {
  isAllowedEmbedUrl,
  normalizeExerciseVideo,
  type ExerciseVideo,
} from "@/lib/exercise-video";
import { isDirectVideoFile, isUnusableHostedMediaUrl } from "@/lib/video-embed";

type Props = {
  video?: ExerciseVideo | null;
  url?: string | null;
  title?: string;
  fallbackText?: string | null;
  className?: string;
  label?: string;
};

function VideoFallback({
  text,
  href,
  className,
}: {
  text: string;
  href?: string | null;
  className?: string;
}) {
  const safeHref = href && !isUnusableHostedMediaUrl(href) ? href : null;
  return (
    <div
      className={`flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 p-4 text-center ${className ?? ""}`}
    >
      <p className="text-xs text-warm-gray">{text}</p>
      {safeHref ? (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gold underline"
        >
          Открыть видео
        </a>
      ) : null}
    </div>
  );
}

export function SafeExerciseVideo({ video, url, title, fallbackText, className, label }: Props) {
  // Prefer overlay/catalog URL that is actually playable — never fall back to dead Supabase Storage.
  const preferredUrl =
    (video?.url && !isUnusableHostedMediaUrl(video.url) ? video.url : null) ??
    (url && !isUnusableHostedMediaUrl(url) ? url : null) ??
    null;

  const resolved = normalizeExerciseVideo({
    video_url: preferredUrl,
    video:
      video && isUnusableHostedMediaUrl(video.url)
        ? {
            ...video,
            url: preferredUrl,
            embed_url:
              video.embed_url && !isUnusableHostedMediaUrl(video.embed_url)
                ? video.embed_url
                : null,
            status: preferredUrl ? video.status : "unavailable",
          }
        : video,
    title: video?.title ?? title,
    fallback_text: video?.fallback_text ?? fallbackText,
  });

  // Dead hosted storage → never attempt playback / open-link to 402 JSON.
  const playable =
    resolved.url && !isUnusableHostedMediaUrl(resolved.url) && resolved.status !== "unavailable"
      ? resolved
      : {
          ...resolved,
          url: null,
          embed_url: null,
          status: "unavailable" as const,
          fallback_text:
            resolved.fallback_text || "Видео временно недоступно. Выполняйте по подсказкам.",
        };

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [playable.url, playable.embed_url]);

  const caption = playable.fallback_text || "Видео временно недоступно. Выполняйте по подсказкам.";
  const heading = playable.title || label || "Видео упражнения";

  if (!playable.url || playable.status === "unavailable") {
    return <VideoFallback text={caption} className={className} />;
  }

  if (failed) {
    return <VideoFallback text={caption} href={playable.url} className={className} />;
  }

  if (playable.provider === "external" || !playable.embed_url) {
    if (isDirectVideoFile(playable.url)) {
      return (
        <video
          src={playable.url}
          title={heading}
          className={className || "h-full w-full object-contain"}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      );
    }
    return <VideoFallback text={caption} href={playable.url} className={className} />;
  }

  if (!isAllowedEmbedUrl(playable.embed_url)) {
    return <VideoFallback text={caption} href={playable.url} className={className} />;
  }

  return (
    <div className={`relative flex h-full w-full flex-col ${className ?? ""}`}>
      <iframe
        src={playable.embed_url}
        title={heading}
        className="h-full min-h-[120px] w-full flex-1 border-0"
        allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        onError={() => setFailed(true)}
      />
      <a
        href={playable.url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 bg-surface/80 px-2 py-1 text-center text-[11px] text-gold underline"
      >
        Открыть видео
      </a>
    </div>
  );
}

export function SafeMediaSlot({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  try {
    return <>{children}</>;
  } catch {
    return <>{fallback ?? null}</>;
  }
}
