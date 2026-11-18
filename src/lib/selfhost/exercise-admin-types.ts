import type { ExerciseVideoProvider, ExerciseVideoStatus } from "@/lib/exercise-video";

export const MEDIA_FILTERS = [
  "all",
  "ok",
  "none",
  "unchecked",
  "unavailable",
  "used",
  "rutube",
  "youtube_only",
  "missing_video",
  "needs_confirmation",
] as const;
export type MediaFilter = (typeof MEDIA_FILTERS)[number];

export type AdminExerciseReport = {
  all: number;
  ok: number;
  none: number;
  unchecked: number;
  unavailable: number;
  used: number;
  rutube: number;
  youtube_only: number;
  missing_video: number;
  needs_confirmation: number;
};

export type AdminExerciseRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  difficulty: string;
  muscle_groups: string[];
  equipment: string[];
  tags: string[];
  cues: string[];
  common_mistakes: string[];
  default_sets: number;
  default_reps: string;
  rest_seconds: number;
  tempo: string | null;
  description: string | null;
  gif_url: string | null;
  video_url: string | null;
  video_title: string | null;
  video_fallback_text: string | null;
  video_provider: ExerciseVideoProvider;
  video_status: ExerciseVideoStatus;
  video_embed_url: string | null;
  publishedUseCount: number;
  needsManualCheck: boolean;
  archived_at: string | null;
  is_active: boolean;
  video_coverage?: "rutube" | "youtube_only" | "missing" | "needs_confirmation" | "other";
  verified_rutube_url?: string | null;
};
