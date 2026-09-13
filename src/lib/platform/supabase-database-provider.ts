import type { DatabaseProvider } from "@/lib/platform/types";

/** Текущая реализация данных — Supabase PostgREST. LocalPostgresProvider появится отдельно. */
export class SupabaseDatabaseProvider implements DatabaseProvider {
  readonly kind = "supabase" as const;
}
