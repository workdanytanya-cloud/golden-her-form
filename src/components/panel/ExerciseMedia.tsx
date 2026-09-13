/**
 * Renders exercise demo media:
 * - mp4/webm/mov (свои файлы) → video
 * - YouTube / Rutube → iframe только с allowlist домена
 * - gif/png/jpg → <img>
 * Недоступное видео не ломает кабинет.
 */
import { SafeExerciseVideo } from "@/components/panel/SafeExerciseVideo";
import { isDirectVideoFile } from "@/lib/video-embed";
import type { ExerciseVideo } from "@/lib/exercise-video";

type Props = {
  url: string | null | undefined;
  video?: ExerciseVideo | null;
  alt?: string;
  className?: string;
  fallbackText?: string | null;
};

export function ExerciseMedia({ url, video, alt = "", className = "", fallbackText }: Props) {
  const mediaUrl = url ?? video?.url ?? null;
  if (!mediaUrl && !video?.fallback_text && !fallbackText) return null;

  if (
    mediaUrl &&
    !video &&
    /\.(gif|png|jpe?g|webp)(\?|$)/i.test(mediaUrl) &&
    !isDirectVideoFile(mediaUrl)
  ) {
    return <img src={mediaUrl} alt={alt} className={className} loading="lazy" />;
  }

  return (
    <SafeExerciseVideo
      url={mediaUrl}
      video={video}
      title={alt}
      fallbackText={fallbackText}
      className={className}
    />
  );
}
