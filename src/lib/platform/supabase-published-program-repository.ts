import type {
  PdfAccessMeta,
  PublishedNutritionRecord,
  PublishedProgramRepository,
  PublishedTrainingRecord,
} from "@/lib/platform/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatRuDate, parseISODate } from "@/lib/client-courses/format";

function isMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    /schema cache|does not exist|PGRST202|PGRST205|relation/i.test(msg) || error.code === "42P01"
  );
}

export class SupabasePublishedProgramRepository implements PublishedProgramRepository {
  async getActivePublishedNutrition(
    clientId: string,
    courseId?: string | null,
  ): Promise<PublishedNutritionRecord | null> {
    const assignment = await this.loadAssignment(clientId, "nutrition", courseId);
    if (!assignment) return null;
    const { data, error } = await supabaseAdmin
      .from("nutrition_plan_versions" as never)
      .select("*")
      .eq("id", assignment)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      source: "published",
      snapshot: row.snapshot as PublishedNutritionRecord["snapshot"],
      version: {
        id: row.id as string,
        client_id: row.client_id as string,
        version: row.version as number,
        status: row.status as PublishedNutritionRecord["version"]["status"],
        content_hash: row.content_hash as string,
        parent_version_id: (row.parent_version_id as string | null) ?? null,
        created_at: row.created_at as string,
        created_by: (row.created_by as string | null) ?? null,
        published_at: (row.published_at as string | null) ?? null,
        published_by: (row.published_by as string | null) ?? null,
      },
    };
  }

  async getActivePublishedTraining(
    clientId: string,
    courseId?: string | null,
  ): Promise<PublishedTrainingRecord | null> {
    const assignment = await this.loadAssignment(clientId, "training", courseId);
    if (!assignment) return null;
    const { data, error } = await supabaseAdmin
      .from("training_program_versions" as never)
      .select("*")
      .eq("id", assignment)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      source: "published",
      snapshot: row.snapshot as PublishedTrainingRecord["snapshot"],
      version: {
        id: row.id as string,
        client_id: row.client_id as string,
        version: row.version as number,
        status: row.status as PublishedTrainingRecord["version"]["status"],
        content_hash: row.content_hash as string,
        parent_version_id: (row.parent_version_id as string | null) ?? null,
        created_at: row.created_at as string,
        created_by: (row.created_by as string | null) ?? null,
        published_at: (row.published_at as string | null) ?? null,
        published_by: (row.published_by as string | null) ?? null,
      },
    };
  }

  async getPdfAccessMeta(clientId: string, courseId?: string | null): Promise<PdfAccessMeta> {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", clientId)
      .maybeSingle();
    const clientName = (profile?.full_name && profile.full_name.trim()) || "Клиент";

    let courseQuery = supabaseAdmin
      .from("client_courses" as never)
      .select("title, start_date, end_date, status")
      .eq("client_id", clientId);
    if (courseId) courseQuery = courseQuery.eq("id", courseId);
    const { data: course } = await courseQuery
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = course as { title?: string; start_date?: string; end_date?: string } | null;
    const start = row?.start_date ? formatRuDate(parseISODate(row.start_date)) : "—";
    const end = row?.end_date ? formatRuDate(parseISODate(row.end_date)) : "—";
    return {
      clientName,
      courseTitle: row?.title?.trim() || "Курс",
      courseStart: start,
      courseEnd: end,
    };
  }

  private async loadAssignment(
    clientId: string,
    kind: "nutrition" | "training",
    courseId?: string | null,
  ): Promise<string | null> {
    let q = supabaseAdmin
      .from("client_program_assignments" as never)
      .select("active_version_id")
      .eq("client_id", clientId)
      .eq("kind", kind);
    if (courseId) q = q.eq("course_id", courseId);
    const { data, error } = await q.maybeSingle();
    if (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    return (data as { active_version_id?: string } | null)?.active_version_id ?? null;
  }
}
