import type {
  AuthProvider,
  DatabaseProvider,
  ExerciseRepository,
  PublishedProgramRepository,
} from "@/lib/platform/types";
import { SupabaseAuthProvider } from "@/lib/platform/supabase-auth-provider";
import { SupabaseDatabaseProvider } from "@/lib/platform/supabase-database-provider";
import { SupabaseExerciseRepository } from "@/lib/platform/supabase-exercise-repository";
import { SupabasePublishedProgramRepository } from "@/lib/platform/supabase-published-program-repository";

/**
 * Границы для последующего LocalPostgresProvider.
 * Сейчас приложение по-прежнему зависит от Supabase.
 */
let auth: AuthProvider | null = null;
let database: DatabaseProvider | null = null;
let published: PublishedProgramRepository | null = null;
let exercises: ExerciseRepository | null = null;

export function getAuthProvider(): AuthProvider {
  auth ??= new SupabaseAuthProvider();
  return auth;
}

export function getDatabaseProvider(): DatabaseProvider {
  database ??= new SupabaseDatabaseProvider();
  return database;
}

export function getPublishedProgramRepository(): PublishedProgramRepository {
  published ??= new SupabasePublishedProgramRepository();
  return published;
}

export function getExerciseRepository(): ExerciseRepository {
  exercises ??= new SupabaseExerciseRepository();
  return exercises;
}

export type { AuthProvider, DatabaseProvider, ExerciseRepository, PublishedProgramRepository };
export type { AuthSession, PdfAccessMeta } from "@/lib/platform/types";
