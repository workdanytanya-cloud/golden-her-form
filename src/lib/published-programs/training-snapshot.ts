import type { Exercise, ExerciseSet, ProgramDay } from "@/lib/training";
import type { FaqItem } from "@/lib/training";
import type {
  FrozenExercise,
  FrozenExerciseSet,
  FrozenTrainingDay,
  TrainingSnapshot,
} from "@/lib/published-programs/types";
import { contentHash } from "@/lib/published-programs/hash";

export function freezeExercise(ex: Exercise): FrozenExercise {
  return {
    id: ex.id,
    slug: ex.slug,
    name: ex.name,
    category: ex.category,
    muscle_groups: [...ex.muscle_groups],
    equipment: [...ex.equipment],
    difficulty: ex.difficulty,
    tags: [...ex.tags],
    description: ex.description,
    cues: [...ex.cues],
    common_mistakes: [...ex.common_mistakes],
    gif_url: ex.gif_url,
    video_url: ex.video_url,
    default_sets: ex.default_sets,
    default_reps: ex.default_reps,
    tempo: ex.tempo,
    rest_seconds: ex.rest_seconds,
  };
}

function freezeSet(set: ExerciseSet, byId: Map<string, Exercise>): FrozenExerciseSet {
  const ex = byId.get(set.exercise_id) ?? null;
  return {
    exercise_id: set.exercise_id,
    sets: set.sets,
    reps: set.reps,
    rest_seconds: set.rest_seconds,
    tempo: set.tempo ?? null,
    note: set.note ?? null,
    exercise: ex ? freezeExercise(ex) : null,
  };
}

export function buildTrainingSnapshot(params: {
  name?: string;
  sessions_per_week: number;
  goal: string | null;
  level: string;
  has_injuries: boolean;
  injuries_details: string | null;
  equipment: string[];
  location: string | null;
  notes: string | null;
  faq: FaqItem[] | unknown;
  program_weeks: number;
  days: ProgramDay[];
  exercises: Exercise[];
}): TrainingSnapshot {
  const byId = new Map(params.exercises.map((e) => [e.id, e]));
  const freezeDay = (d: ProgramDay): FrozenTrainingDay => ({
    week_index: d.week_index ?? 0,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup.map((s) => freezeSet(s, byId)),
    exercises: d.exercises.map((s) => freezeSet(s, byId)),
    cooldown: d.cooldown.map((s) => freezeSet(s, byId)),
    day_note: d.day_note,
  });
  return {
    name: params.name ?? "Программа тренировок",
    sessions_per_week: params.sessions_per_week,
    goal: params.goal,
    level: params.level,
    has_injuries: params.has_injuries,
    injuries_details: params.injuries_details,
    equipment: [...params.equipment],
    location: params.location,
    notes: params.notes,
    faq: params.faq,
    program_weeks: params.program_weeks,
    days: params.days.map(freezeDay),
  };
}

export function trainingSnapshotHash(snapshot: TrainingSnapshot): string {
  return contentHash(snapshot);
}

export function exercisesFromTrainingSnapshot(snapshot: TrainingSnapshot): Exercise[] {
  const out: Exercise[] = [];
  const seen = new Set<string>();
  const collect = (sets: FrozenExerciseSet[]) => {
    for (const s of sets) {
      if (!s.exercise || seen.has(s.exercise.id)) continue;
      seen.add(s.exercise.id);
      const e = s.exercise;
      out.push({
        id: e.id,
        slug: e.slug,
        name: e.name,
        category: e.category as Exercise["category"],
        muscle_groups: e.muscle_groups,
        equipment: e.equipment,
        difficulty: e.difficulty as Exercise["difficulty"],
        tags: e.tags,
        description: e.description,
        cues: e.cues,
        common_mistakes: e.common_mistakes,
        gif_url: e.gif_url,
        video_url: e.video_url,
        default_sets: e.default_sets,
        default_reps: e.default_reps,
        tempo: e.tempo,
        rest_seconds: e.rest_seconds,
      });
    }
  };
  for (const day of snapshot.days) {
    collect(day.warmup);
    collect(day.exercises);
    collect(day.cooldown);
  }
  return out;
}

export function programDaysFromSnapshot(snapshot: TrainingSnapshot): ProgramDay[] {
  const toSet = (s: FrozenExerciseSet): ExerciseSet => ({
    exercise_id: s.exercise_id,
    sets: s.sets,
    reps: s.reps,
    rest_seconds: s.rest_seconds,
    tempo: s.tempo,
    note: s.note,
  });
  return snapshot.days.map((d) => ({
    week_index: d.week_index,
    day_index: d.day_index,
    is_rest: d.is_rest,
    title: d.title,
    focus: d.focus,
    description: d.description,
    warmup: d.warmup.map(toSet),
    exercises: d.exercises.map(toSet),
    cooldown: d.cooldown.map(toSet),
    day_note: d.day_note,
  }));
}
