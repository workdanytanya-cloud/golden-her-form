import type { Session } from "@supabase/supabase-js";
import type { Exercise } from "@/lib/training";
import type { ExerciseVideo } from "@/lib/exercise-video";
import type {
  NutritionSnapshot,
  TrainingSnapshot,
  VersionMeta,
} from "@/lib/published-programs/types";

export type AppRole = "admin" | "client";

export type AuthSession = {
  userId: string;
  email: string | null;
  role: AppRole;
};

export interface AuthProvider {
  readonly kind: "supabase" | "local";
  getSessionFromBearerToken(token: string): Promise<AuthSession | null>;
  getBrowserSession(): Promise<Session | null>;
}

export interface DatabaseProvider {
  readonly kind: "supabase" | "local-postgres";
}

export type PublishedNutritionRecord = {
  version: VersionMeta;
  snapshot: NutritionSnapshot;
  source: "published";
};

export type PublishedTrainingRecord = {
  version: VersionMeta;
  snapshot: TrainingSnapshot;
  source: "published";
};

export type PdfAccessMeta = {
  clientName: string;
  courseTitle: string;
  courseStart: string;
  courseEnd: string;
};

export interface PublishedProgramRepository {
  getActivePublishedNutrition(
    clientId: string,
    courseId?: string | null,
  ): Promise<PublishedNutritionRecord | null>;
  getActivePublishedTraining(
    clientId: string,
    courseId?: string | null,
  ): Promise<PublishedTrainingRecord | null>;
  getPdfAccessMeta(clientId: string, courseId?: string | null): Promise<PdfAccessMeta>;
}

export type ExerciseUpsertInput = {
  id?: string;
  slug: string;
  name: string;
  category: string;
  difficulty: string;
  muscle_groups: string[];
  equipment: string[];
  default_sets: number;
  default_reps: string;
  rest_seconds: number;
  tempo: string | null;
  description: string | null;
  gif_url: string | null;
  video_url: string | null;
  video_provider: string | null;
  video_embed_url: string | null;
  video_title: string | null;
  video_status: string | null;
  video_fallback_text: string | null;
};

export interface ExerciseRepository {
  list(): Promise<Exercise[]>;
  upsert(input: ExerciseUpsertInput): Promise<{ id: string; video: ExerciseVideo }>;
  remove(id: string): Promise<void>;
}
