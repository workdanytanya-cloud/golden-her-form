/**
 * Renders exercise demo media. If URL is an mp4/webm/mov, plays as a silent
 * auto-looping video (GIF-like); otherwise falls back to an <img> for real gif/png/jpg.
 */
type Props = {
  url: string | null | undefined;
  alt?: string;
  className?: string;
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

export function ExerciseMedia({ url, alt = "", className = "" }: Props) {
  if (!url) return null;
  if (isVideoUrl(url)) {
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
