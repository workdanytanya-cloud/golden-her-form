import { EMPTY_EXERCISE_VIDEO, normalizeExerciseVideo, type ExerciseVideo } from "@/lib/exercise-video";
import type { FrozenExerciseSet, TrainingSnapshot } from "@/lib/published-programs/types";

export type ExerciseMediaBinding = {
  exercise_id: string;
  provider: ExerciseVideo["provider"];
  source_url: string | null;
  embed_url: string | null;
  title: string | null;
  status: ExerciseVideo["status"];
  fallback_text: string | null;
};

export type SnapshotExerciseMediaBinding = {
  version_id: string;
  snapshot_exercise_key: string;
  exercise_id: string | null;
  confirmed_by_trainer: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export function snapshotExerciseKey(
  weekIndex: number,
  dayIndex: number,
  section: "warmup" | "exercises" | "cooldown",
  setIndex: number,
): string {
  return `${weekIndex}:${dayIndex}:${section}:${setIndex}`;
}

export function resolveSetExerciseId(set: FrozenExerciseSet): string | null {
  if (isUuid(set.exercise_id)) return set.exercise_id;
  if (isUuid(set.exercise?.id)) return set.exercise.id;
  return null;
}

export type SnapshotExerciseRef = {
  key: string;
  exerciseId: string | null;
  name: string | null;
};

export function listSnapshotExercises(snapshot: TrainingSnapshot): SnapshotExerciseRef[] {
  const out: SnapshotExerciseRef[] = [];
  for (const day of snapshot.days) {
    const week = day.week_index ?? 0;
    const walk = (section: "warmup" | "exercises" | "cooldown") => {
      day[section].forEach((set, index) => {
        out.push({
          key: snapshotExerciseKey(week, day.day_index, section, index),
          exerciseId: resolveSetExerciseId(set),
          name: set.exercise?.name ?? null,
        });
      });
    };
    walk("warmup");
    walk("exercises");
    walk("cooldown");
  }
  return out;
}

export function summarizeSnapshotExerciseIds(snapshot: TrainingSnapshot): {
  total: number;
  withExerciseId: number;
  needingManualMatch: number;
} {
  const refs = listSnapshotExercises(snapshot);
  const withExerciseId = refs.filter((r) => r.exerciseId).length;
  return {
    total: refs.length,
    withExerciseId,
    needingManualMatch: refs.length - withExerciseId,
  };
}

export function bindingToVideo(binding: ExerciseMediaBinding | null | undefined): ExerciseVideo {
  if (!binding) return { ...EMPTY_EXERCISE_VIDEO };
  return normalizeExerciseVideo({
    url: binding.source_url,
    video_url: binding.source_url,
    title: binding.title,
    fallback_text: binding.fallback_text,
    video: {
      provider: binding.provider,
      url: binding.source_url,
      embed_url: binding.embed_url,
      title: binding.title,
      status: binding.status,
      fallback_text: binding.fallback_text,
    },
  });
}

/**
 * Видео для отображения/PDF: сначала общая привязка по exercise_id,
 * затем явная snapshot-привязка (только если confirmed_by_trainer).
 * Snapshot не изменяется.
 */
export function resolveDisplayVideo(params: {
  exerciseId: string | null;
  snapshotKey: string;
  byExerciseId: Map<string, ExerciseMediaBinding>;
  snapshotBindings: SnapshotExerciseMediaBinding[];
}): ExerciseVideo | null {
  if (params.exerciseId) {
    const direct = params.byExerciseId.get(params.exerciseId);
    if (direct) return bindingToVideo(direct);
  }
  const explicit = params.snapshotBindings.find(
    (row) => row.snapshot_exercise_key === params.snapshotKey && row.confirmed_by_trainer,
  );
  if (explicit?.exercise_id) {
    const via = params.byExerciseId.get(explicit.exercise_id);
    if (via) return bindingToVideo(via);
  }
  return null;
}

export function overlayVideosForSnapshot(params: {
  snapshot: TrainingSnapshot;
  byExerciseId: Map<string, ExerciseMediaBinding>;
  snapshotBindings: SnapshotExerciseMediaBinding[];
}): Map<string, ExerciseVideo> {
  const overlay = new Map<string, ExerciseVideo>();
  for (const ref of listSnapshotExercises(params.snapshot)) {
    const video = resolveDisplayVideo({
      exerciseId: ref.exerciseId,
      snapshotKey: ref.key,
      byExerciseId: params.byExerciseId,
      snapshotBindings: params.snapshotBindings,
    });
    if (video && ref.exerciseId) overlay.set(ref.exerciseId, video);
    if (video) overlay.set(ref.key, video);
  }
  return overlay;
}

export function applyMediaOverlayToExercises<T extends { id: string; name?: string; video?: ExerciseVideo; video_url: string | null }>(
  snapshot: TrainingSnapshot,
  exercises: T[],
  overlay: Map<string, ExerciseVideo>,
): T[] {
  const next = exercises.map((ex) => {
    const video = overlay.get(ex.id);
    if (!video) return ex;
    return { ...ex, video, video_url: video.url ?? ex.video_url };
  });
  for (const ref of listSnapshotExercises(snapshot)) {
    const video = overlay.get(ref.key);
    if (!video || ref.exerciseId) continue;
    const idx = next.findIndex((ex) => !isUuid(ex.id) && !ex.video?.url);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        video,
        video_url: video.url ?? next[idx].video_url,
      };
    }
  }
  return next;
}
