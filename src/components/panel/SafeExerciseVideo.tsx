import { useEffect, useState } from "react";
import {
  selectExercisePlayback,
  YOUTUBE_NETWORK_WARNING,
  type ExercisePlaybackChoice,
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

function SourceButton({
  active,
  children,
  onClick,
  href,
}: {
  active?: boolean;
  children: string;
  onClick?: () => void;
  href?: string | null;
}) {
  const className = `inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm ${
    active ? "border-gold bg-gold text-background" : "border-gold/40 bg-background/70 text-ivory"
  }`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function SafeExerciseVideo({ video, url, title, fallbackText, className, label }: Props) {
  const playback = selectExercisePlayback(
    video
      ? {
          ...video,
          url: video.url || url || null,
          title: video.title ?? title ?? null,
          fallback_text: video.fallback_text ?? fallbackText ?? null,
        }
      : url
        ? {
            provider: "external",
            url,
            embed_url: null,
            title: title ?? null,
            status: "ok",
            fallback_text: fallbackText ?? null,
          }
        : null,
  );
  const [choice, setChoice] = useState<ExercisePlaybackChoice>(playback.active);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setChoice(playback.active);
    setFailed(false);
  }, [playback.active, playback.embedUrl, playback.openUrl]);

  const active =
    choice === "youtube" && playback.youtube
      ? "youtube"
      : choice === "rutube" && playback.rutube
        ? "rutube"
        : choice === "local" && playback.local
          ? "local"
          : choice === "external" && playback.external
            ? "external"
            : playback.active;
  const openUrl =
    active === "youtube"
      ? playback.youtube?.url
      : active === "rutube"
        ? playback.rutube?.url
        : active === "local"
          ? playback.local?.url
          : active === "external"
            ? playback.external?.url
            : playback.openUrl;
  const embedUrl = active === "rutube" ? playback.embedUrl : null;
  const localUrl = active === "local" ? playback.local?.url : null;
  const heading = video?.title || title || label || "Видео упражнения";
  const message =
    active === "youtube"
      ? YOUTUBE_NETWORK_WARNING
      : failed
        ? "Это видео не открылось. Остальные упражнения тренировки доступны."
        : active === "none"
          ? playback.message
          : null;

  return (
    <div className={`w-full max-w-full overflow-hidden ${className ?? ""}`}>
      {embedUrl && !failed ? (
        <div className="aspect-video w-full max-w-full overflow-hidden bg-black">
          <iframe
            src={embedUrl}
            title={heading}
            className="h-full w-full border-0"
            allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            onError={() => setFailed(true)}
          />
        </div>
      ) : localUrl && isDirectVideoFile(localUrl) && !failed ? (
        <div className="aspect-video w-full max-w-full overflow-hidden bg-black">
          <video
            src={localUrl}
            title={heading}
            className="h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div className="flex min-h-28 w-full flex-col items-center justify-center gap-3 px-4 py-5 text-center">
          <p className="text-sm leading-relaxed text-ivory">{message}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-gold/10 p-3">
        {playback.rutube ? (
          <SourceButton active={active === "rutube"} onClick={() => setChoice("rutube")}>
            Rutube
          </SourceButton>
        ) : null}
        {playback.youtube ? (
          <SourceButton active={active === "youtube"} onClick={() => setChoice("youtube")}>
            YouTube
          </SourceButton>
        ) : null}
        {active === "youtube" && playback.youtube ? (
          <SourceButton href={playback.youtube.url}>Открыть YouTube</SourceButton>
        ) : null}
        {openUrl ? <SourceButton href={openUrl}>Открыть видео отдельно</SourceButton> : null}
      </div>
    </div>
  );
}
