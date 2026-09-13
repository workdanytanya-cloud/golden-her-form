import { normalizeExerciseVideo } from "@/lib/exercise-video";

export function getVideoEmbedUrl(url: string): string | null {
  return normalizeExerciseVideo({ url }).embed_url;
}

export function isDirectVideoFile(url: string): boolean {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return true;
  // Signed / public Supabase Storage video objects
  if (/\/storage\/v1\/object\/(?:sign|public|authenticated)\/media\//i.test(url)) {
    return true;
  }
  return false;
}
