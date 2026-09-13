import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server/assert-admin";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import { getExerciseRepository } from "@/lib/platform";

const payloadSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  difficulty: z.string().min(1).max(40),
  muscle_groups: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  default_sets: z.number().int().min(0).max(50),
  default_reps: z.string().max(40),
  rest_seconds: z.number().int().min(0).max(600),
  tempo: z.string().max(40).nullable(),
  description: z.string().max(4000).nullable(),
  gif_url: z.string().max(2000).nullable(),
  video_url: z.string().max(2000).nullable(),
  video_title: z.string().max(200).nullable().optional(),
  video_fallback_text: z.string().max(500).nullable().optional(),
});

export const adminUpsertExerciseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => payloadSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const video = normalizeExerciseVideo({
      url: data.video_url,
      title: data.video_title,
      fallback_text: data.video_fallback_text,
    });
    const repo = getExerciseRepository();
    const saved = await repo.upsert({
      id: data.id,
      slug: data.slug.trim(),
      name: data.name.trim(),
      category: data.category,
      difficulty: data.difficulty,
      muscle_groups: data.muscle_groups,
      equipment: data.equipment,
      default_sets: data.default_sets,
      default_reps: data.default_reps,
      rest_seconds: data.rest_seconds,
      tempo: data.tempo,
      description: data.description,
      gif_url: data.gif_url,
      video_url: video.url,
      video_provider: video.provider,
      video_embed_url: video.embed_url,
      video_title: video.title,
      video_status: video.status,
      video_fallback_text: video.fallback_text,
    });
    return { ok: true as const, video, id: saved.id };
  });
