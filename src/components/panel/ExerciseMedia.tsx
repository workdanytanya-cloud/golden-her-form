/**
 * Renders exercise demo media:
 * - mp4/webm/mov (свои файлы) → video
 * - YouTube / Rutube → iframe embed
 * - gif/png/jpg → <img>
 */
import { getVideoEmbedUrl, isDirectVideoFile } from "@/lib/video-embed";

type Props = {
  url: string | null | undefined;
  alt?: string;
  className?: string;
};

export function ExerciseMedia({ url, alt = "", className = "" }: Props) {
  if (!url) return null;

  if (isDirectVideoFile(url)) {
    return (
      <video
        src={url}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        controls
      />
    );
  }

  const embedUrl = getVideoEmbedUrl(url);
  if (embedUrl) {
    return (
      <iframe
        src={embedUrl}
        title={alt || "Видео упражнения"}
        className={className || "h-full w-full border-0"}
        allow="clipboard-write; autoplay; fullscreen; picture-in-picture; encrypted-media; web-share"
        allowFullScreen
        loading="lazy"
      />
    );
  }

  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
