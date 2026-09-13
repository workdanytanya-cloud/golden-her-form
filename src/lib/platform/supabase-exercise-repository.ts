import type { ExerciseRepository, ExerciseUpsertInput } from "@/lib/platform/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import type { Exercise } from "@/lib/training";
import type { ExerciseCategory } from "@/lib/training";

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return /schema cache|could not find|PGRST204|column/i.test(msg) || error.code === "PGRST204";
}

export class SupabaseExerciseRepository implements ExerciseRepository {
  async list(): Promise<Exercise[]> {
    const pageSize = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("exercises")
        .select("*")
        .order("name")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    return rows.map((e) => {
      const video = normalizeExerciseVideo(e);
      return {
        id: e.id as string,
        slug: e.slug as string,
        name: e.name as string,
        category: e.category as ExerciseCategory,
        muscle_groups: (e.muscle_groups as string[]) ?? [],
        equipment: (e.equipment as string[]) ?? [],
        difficulty: e.difficulty as Exercise["difficulty"],
        tags: (e.tags as string[]) ?? [],
        description: (e.description as string | null) ?? null,
        cues: (e.cues as string[]) ?? [],
        common_mistakes: (e.common_mistakes as string[]) ?? [],
        gif_url: (e.gif_url as string | null) ?? null,
        video_url: video.url,
        video,
        default_sets: Number(e.default_sets ?? 3),
        default_reps: String(e.default_reps ?? "10-12"),
        tempo: (e.tempo as string | null) ?? null,
        rest_seconds: Number(e.rest_seconds ?? 60),
      };
    });
  }

  async upsert(input: ExerciseUpsertInput) {
    const video = normalizeExerciseVideo({
      url: input.video_url,
      title: input.video_title,
      fallback_text: input.video_fallback_text,
    });
    const base = {
      slug: input.slug,
      name: input.name,
      category: input.category,
      difficulty: input.difficulty,
      muscle_groups: input.muscle_groups,
      equipment: input.equipment,
      default_sets: input.default_sets,
      default_reps: input.default_reps,
      rest_seconds: input.rest_seconds,
      tempo: input.tempo,
      description: input.description,
      gif_url: input.gif_url,
      video_url: video.url,
      video_provider: video.provider,
      video_embed_url: video.embed_url,
      video_title: video.title,
      video_status: video.status,
      video_fallback_text: video.fallback_text,
    };
    const full = input.id ? { ...base, id: input.id } : base;
    const query = input.id
      ? supabaseAdmin.from("exercises").update(base).eq("id", input.id).select("id").maybeSingle()
      : supabaseAdmin.from("exercises").insert(full).select("id").maybeSingle();
    let { data, error } = await query;
    if (error && isMissingColumn(error)) {
      const legacy = {
        slug: input.slug,
        name: input.name,
        category: input.category,
        difficulty: input.difficulty,
        muscle_groups: input.muscle_groups,
        equipment: input.equipment,
        default_sets: input.default_sets,
        default_reps: input.default_reps,
        rest_seconds: input.rest_seconds,
        tempo: input.tempo,
        description: input.description,
        gif_url: input.gif_url,
        video_url: video.url,
      };
      const fallback = input.id
        ? supabaseAdmin
            .from("exercises")
            .update(legacy)
            .eq("id", input.id)
            .select("id")
            .maybeSingle()
        : supabaseAdmin.from("exercises").insert(legacy).select("id").maybeSingle();
      const second = await fallback;
      data = second.data;
      error = second.error;
    }
    if (error) throw error;
    const id = (data as { id?: string } | null)?.id ?? input.id;
    if (!id) throw new Error("Не удалось сохранить упражнение");
    return { id, video };
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabaseAdmin.from("exercises").delete().eq("id", id);
    if (error) throw error;
  }
}
