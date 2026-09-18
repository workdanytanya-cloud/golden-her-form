import { normalizeExerciseVideo } from "@/lib/exercise-video";

export function getVideoEmbedUrl(url: string): string | null {
  return normalizeExerciseVideo({ url }).embed_url;
}

export function isDirectVideoFile(url: string): boolean {
  // Broken / quota-limited Supabase Storage must not be treated as playable local media.
  if (/supabase\.co/i.test(url) || /\/storage\/v1\/object\//i.test(url)) {
    return false;
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return true;
  return false;
}

/** Dead cloud storage (e.g. Supabase 402) — не открывать как «рабочую» ссылку. */
export function isUnusableHostedMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /supabase\.co/i.test(url) || /\/storage\/v1\/object\//i.test(url);
}
