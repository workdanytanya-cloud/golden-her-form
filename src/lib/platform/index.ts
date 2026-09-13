import type {
  AuthProvider,
  DatabaseProvider,
  ExerciseRepository,
  PublishedProgramRepository,
} from "@/lib/platform/types";
import { getAuthBackend, getDataBackend } from "@/lib/selfhost/config";
import { getPostgresPool } from "@/lib/selfhost/db";
import { LocalAuthProvider } from "@/lib/selfhost/local-auth";
import { PostgresPublishedProgramRepository } from "@/lib/selfhost/postgres-published";
import { SupabaseAuthProvider } from "@/lib/platform/supabase-auth-provider";
import { SupabaseDatabaseProvider } from "@/lib/platform/supabase-database-provider";
import { SupabaseExerciseRepository } from "@/lib/platform/supabase-exercise-repository";
import { SupabasePublishedProgramRepository } from "@/lib/platform/supabase-published-program-repository";

class LocalPostgresDatabaseProvider implements DatabaseProvider {
  readonly kind = "local-postgres" as const;
}

let auth: AuthProvider | null = null;
let database: DatabaseProvider | null = null;
let published: PublishedProgramRepository | null = null;
let exercises: ExerciseRepository | null = null;

export function resetPlatformProvidersForTests() {
  auth = null;
  database = null;
  published = null;
  exercises = null;
}

export function getAuthProvider(): AuthProvider {
  auth ??= getAuthBackend() === "local" ? new LocalAuthProvider() : new SupabaseAuthProvider();
  return auth;
}

export function getDatabaseProvider(): DatabaseProvider {
  if (getDataBackend() === "postgres") {
    database ??= new LocalPostgresDatabaseProvider();
    return database;
  }
  database ??= new SupabaseDatabaseProvider();
  return database;
}

export function getPublishedProgramRepository(): PublishedProgramRepository {
  if (getDataBackend() === "postgres") {
    published ??= new PostgresPublishedProgramRepository(getPostgresPool());
    return published;
  }
  published ??= new SupabasePublishedProgramRepository();
  return published;
}

export function getExerciseRepository(): ExerciseRepository {
  if (getDataBackend() === "postgres") {
    throw new Error(
      "DATA_BACKEND=postgres: каталог упражнений тренера пока не перенесён. Supabase не используется как запасной вариант.",
    );
  }
  exercises ??= new SupabaseExerciseRepository();
  return exercises;
}

export type { AuthProvider, DatabaseProvider, ExerciseRepository, PublishedProgramRepository };
export type { AuthSession, PdfAccessMeta } from "@/lib/platform/types";
