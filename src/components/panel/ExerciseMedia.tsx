/**
 * Renders exercise demo media:
 * - YouTube / Rutube → iframe embed
 * - mp4/webm/mov → silent looping video
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
      />
    );
  }

  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
