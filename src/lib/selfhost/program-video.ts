import type { Pool, PoolClient } from "pg";
import { normalizeExerciseVideo, type ExerciseVideo } from "@/lib/exercise-video";
import { isUuid, listSnapshotExercises } from "@/lib/selfhost/media";
import type { TrainingSnapshot } from "@/lib/published-programs/types";

type Queryable = Pick<Pool | PoolClient, "query">;

const UNBOUND =
  "В этой программе нет надёжной привязки упражнения. Общий каталог не изменён.";

export function programVideoBindingKeys(
  snapshot: TrainingSnapshot,
  exerciseId: string,
): { keys: string[] } | { error: string } {
  if (!isUuid(exerciseId)) return { error: UNBOUND };
  const keys = listSnapshotExercises(snapshot)
    .filter((item) => item.exerciseId === exerciseId)
    .map((item) => item.key);
  if (!keys.length) return { error: UNBOUND };
  return { keys };
}

export async function setProgramExerciseVideoPg(
  db: Queryable,
  params: { programId: string; exerciseId: string; sourceUrl: string; actorId: string },
): Promise<ExerciseVideo> {
  const video = normalizeExerciseVideo({ url: params.sourceUrl });
  if (video.provider !== "rutube" || !video.url || !video.embed_url) {
    throw Object.assign(
      new Error("Нужна полная ссылка RUTUBE. Прежняя ссылка не изменена."),
      { statusCode: 400 },
    );
  }
  const version = await db.query(
    `SELECT snapshot, content_hash
       FROM public.training_program_versions
      WHERE id = $1`,
    [params.programId],
  );
  const row = version.rows[0] as { snapshot: TrainingSnapshot; content_hash: string } | undefined;
  if (!row) {
    throw Object.assign(new Error(UNBOUND), { statusCode: 409 });
  }
  const plan = programVideoBindingKeys(row.snapshot, params.exerciseId);
  if ("error" in plan) {
    throw Object.assign(new Error(plan.error), { statusCode: 409 });
  }
  for (const key of plan.keys) {
    await db.query(
      `INSERT INTO public.snapshot_exercise_media_bindings
         (version_id, snapshot_exercise_key, exercise_id, confirmed_by_trainer, source_url, embed_url, created_by)
       VALUES ($1, $2, $3, true, $4, $5, $6)
       ON CONFLICT (version_id, snapshot_exercise_key) DO UPDATE SET
         exercise_id = EXCLUDED.exercise_id,
         confirmed_by_trainer = true,
         source_url = EXCLUDED.source_url,
         embed_url = EXCLUDED.embed_url`,
      [params.programId, key, params.exerciseId, video.url, video.embed_url, params.actorId],
    );
  }
  const unchanged = await db.query(
    `SELECT content_hash FROM public.training_program_versions WHERE id = $1`,
    [params.programId],
  );
  const hash = (unchanged.rows[0] as { content_hash: string } | undefined)?.content_hash;
  if (hash !== row.content_hash) {
    throw Object.assign(new Error("Ссылка не сохранена: версия программы изменилась."), {
      statusCode: 409,
    });
  }
  return video;
}
