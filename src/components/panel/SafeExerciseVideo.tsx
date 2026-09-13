import { useEffect, useState, type ReactNode } from "react";
import {
  isAllowedEmbedUrl,
  normalizeExerciseVideo,
  type ExerciseVideo,
} from "@/lib/exercise-video";
import { isDirectVideoFile } from "@/lib/video-embed";

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
  return (
    <div
      className={`flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 p-4 text-center ${className ?? ""}`}
    >
      <p className="text-xs text-warm-gray">{text}</p>
      {href ? (
        <a
          href={href}
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
  const resolved = normalizeExerciseVideo({
    video_url: url ?? video?.url,
    video,
    title: video?.title ?? title,
    fallback_text: video?.fallback_text ?? fallbackText,
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved.url, resolved.embed_url]);

  const caption = resolved.fallback_text || "Видео временно недоступно. Выполняйте по подсказкам.";
  const heading = resolved.title || label || "Видео упражнения";

  if (!resolved.url || resolved.status === "unavailable") {
    return <VideoFallback text={caption} className={className} />;
  }

  if (failed) {
    return <VideoFallback text={caption} href={resolved.url} className={className} />;
  }

  if (resolved.provider === "external" || !resolved.embed_url) {
    if (isDirectVideoFile(resolved.url)) {
      return (
        <video
          src={resolved.url}
          title={heading}
          className={className || "h-full w-full object-contain"}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      );
    }
    return <VideoFallback text={caption} href={resolved.url} className={className} />;
  }

  if (!isAllowedEmbedUrl(resolved.embed_url)) {
    return <VideoFallback text={caption} href={resolved.url} className={className} />;
  }

  return (
    <iframe
      src={resolved.embed_url}
      title={heading}
      className={className || "h-full w-full border-0"}
      allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onError={() => setFailed(true)}
    />
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
