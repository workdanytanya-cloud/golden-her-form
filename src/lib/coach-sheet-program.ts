/**
 * 4-недельная программа и пул упражнений тренера (импорт из таблицы, без UI таблицы).
 */

import {
  type Exercise,
  type ExerciseSet,
  type ProgramDay,
  type ProgramGoal,
  type ProgramInput,
  type ProgramLevel,
  generateProgram,
  needsJointCare,
} from "@/lib/training";
import {
  PANOVA_4WEEK_PROGRAM,
  PANOVA_SHEET_SLUGS,
  type PanovaSheetItem,
} from "@/lib/panova-sheet-data";

export const COACH_PROGRAM_WEEKS = 4;
export const COACH_TRAINING_DAYS = [0, 2, 4] as const;

/** Slug'и упражнений из Google Sheet тренера (должны быть в public.exercises). */
export const COACH_SHEET_EXERCISE_SLUGS: readonly string[] = PANOVA_SHEET_SLUGS;

export function missingCoachSheetExercises(exercises: Pick<Exercise, "slug">[]): string[] {
  const have = new Set(exercises.map((e) => e.slug));
  // Достаточно ключевых slug из 4-недельной программы (не весь каталог из 180+)
  const required = new Set<string>();
  for (const week of PANOVA_4WEEK_PROGRAM) {
    for (const wo of week.workouts) {
      for (const it of wo.items) {
        if (it.slug) required.add(it.slug);
      }
    }
  }
  if (required.size === 0) {
    return COACH_SHEET_EXERCISE_SLUGS.filter((slug) => !have.has(slug)).slice(0, 20);
  }
  return [...required].filter((slug) => !have.has(slug));
}

const WEEK_META: Array<{ title: string; focus: string }> = [
  { title: "Неделя 1 — освоение", focus: "Техника и ритм по таблице тренера." },
  { title: "Неделя 2 — объём", focus: "Больше времени и подходов при том же качестве." },
  { title: "Неделя 3 — вариации", focus: "Медленнее негатив, стабильнее кор." },
  { title: "Неделя 4 — пик", focus: "Максимум блока. Техника важнее скорости." },
];

function restDay(weekIndex: number, dayIndex: number): ProgramDay {
  return {
    week_index: weekIndex,
    day_index: dayIndex,
    is_rest: true,
    title: "Активный отдых",
    focus: "Восстановление",
    description: "Прогулка, растяжка, сон. Отдых — часть 4-недельного цикла.",
    warmup: [],
    exercises: [],
    cooldown: [],
    day_note: null,
  };
}

function toSet(item: PanovaSheetItem, bySlug: Map<string, Exercise>, byVideo: Map<string, Exercise>): ExerciseSet | null {
  const ex =
    (item.slug ? bySlug.get(item.slug) : undefined) ||
    byVideo.get(item.video_url) ||
    null;
  if (!ex) return null;
  return {
    exercise_id: ex.id,
    sets: item.sets,
    reps: item.reps,
    rest_seconds: item.rest_seconds,
    tempo: ex.tempo,
    note: item.note,
  };
}

function buildDayFromWorkout(
  weekIndex: number,
  dayIndex: number,
  workout: { title: string; focus: string | null; items: PanovaSheetItem[] },
  bySlug: Map<string, Exercise>,
  byVideo: Map<string, Exercise>,
  jointCare: boolean,
): ProgramDay {
  const meta = WEEK_META[weekIndex] ?? WEEK_META[0];
  const warmup: ExerciseSet[] = [];
  const main: ExerciseSet[] = [];
  const cooldown: ExerciseSet[] = [];

  for (const item of workout.items) {
    if (jointCare && /прыж|джампинг|табата/i.test(item.name)) continue;
    const set = toSet(item, bySlug, byVideo);
    if (!set) continue;
    if (item.section === "warmup") warmup.push(set);
    else if (item.section === "cooldown") cooldown.push(set);
    else main.push(set);
  }

  return {
    week_index: weekIndex,
    day_index: dayIndex,
    is_rest: false,
    title: `${workout.title} · ${meta.title}`,
    focus: workout.focus || meta.focus,
    description: "Блок из таблицы тренера. Техника — по видео.",
    warmup,
    exercises: main,
    cooldown,
    day_note: `Неделя ${weekIndex + 1}/${COACH_PROGRAM_WEEKS}`,
  };
}

export function buildCoachSheetProgramDays(
  exercises: Exercise[],
  profile: Pick<ProgramInput, "has_injuries" | "weight_kg" | "goal" | "level">,
): ProgramDay[] {
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));
  const byVideo = new Map(
    exercises.filter((e) => e.video_url).map((e) => [e.video_url as string, e]),
  );
  const jointCare = needsJointCare(profile);
  const days: ProgramDay[] = [];

  for (let week = 0; week < COACH_PROGRAM_WEEKS; week++) {
    const weekData = PANOVA_4WEEK_PROGRAM.find((w) => w.weekIndex === week);
    const workouts = weekData?.workouts ?? [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      if (!COACH_TRAINING_DAYS.includes(dayIndex as (typeof COACH_TRAINING_DAYS)[number])) {
        days.push(restDay(week, dayIndex));
        continue;
      }

      const workoutNum = dayIndex === 0 ? 0 : dayIndex === 2 ? 1 : 2;
      const workout =
        workouts[workoutNum] ||
        workouts[workoutNum % Math.max(workouts.length, 1)] ||
        workouts[0];

      if (!workout || workout.items.length === 0) {
        // Fallback: взять из недели 0 тот же слот
        const w0 = PANOVA_4WEEK_PROGRAM.find((w) => w.weekIndex === 0);
        const fallback = w0?.workouts[workoutNum] ?? w0?.workouts[0];
        if (!fallback) {
          days.push(restDay(week, dayIndex));
          continue;
        }
        days.push(buildDayFromWorkout(week, dayIndex, fallback, bySlug, byVideo, jointCare));
        continue;
      }

      days.push(buildDayFromWorkout(week, dayIndex, workout, bySlug, byVideo, jointCare));
    }
  }
  return days;
}

export function coachProgramNotes(profile: {
  goal: ProgramGoal;
  level: ProgramLevel;
  has_injuries: boolean;
}): string {
  const goalRu =
    profile.goal === "weight_loss"
      ? "снижение веса"
      : profile.goal === "tone"
        ? "тонус"
        : profile.goal === "muscle_gain"
          ? "набор мышц"
          : "поддержание формы";

  return [
    "4-недельный блок по программе тренера (3 тренировки: пн / ср / пт).",
    `Цель: ${goalRu}, уровень: ${profile.level}.`,
    profile.has_injuries
      ? "Учтены ограничения из анкеты (без ударных нагрузок)."
      : "Прогрессия: техника → объём → темп → пик.",
  ].join("\n");
}

/** Упражнения с тегом sheet из библиотеки тренера. */
export function coachSheetExercisePool(exercises: Exercise[]): Exercise[] {
  return exercises.filter((e) => e.tags.includes("sheet") || e.tags.includes("panova"));
}

export function canBuildCoachSheetProgram(exercises: Pick<Exercise, "slug" | "video_url">[]): boolean {
  const missing = missingCoachSheetExercises(exercises);
  // Допускаем частичное покрытие: достаточно ≥60% слотов 4-недельной программы
  const required = new Set<string>();
  for (const week of PANOVA_4WEEK_PROGRAM) {
    for (const wo of week.workouts) {
      for (const it of wo.items) {
        if (it.slug) required.add(it.slug);
      }
    }
  }
  if (required.size === 0) return coachSheetExercisePool(exercises as Exercise[]).length >= 8;
  const have = required.size - missing.length;
  return have / required.size >= 0.6;
}

export type DefaultProgramPlan = {
  days: ProgramDay[];
  programWeeks: number;
  coachNotes: string;
  mode: "coach_sheet" | "sheet_pool" | "generic";
};

/**
 * Стартовая программа: сначала 4-недельный блок из таблицы,
 * иначе — генерация только из sheet-упражнений, иначе — общий пул.
 */
export function resolveDefaultTrainingProgram(
  exercises: Exercise[],
  input: ProgramInput,
): DefaultProgramPlan {
  if (canBuildCoachSheetProgram(exercises)) {
    return {
      days: buildCoachSheetProgramDays(exercises, input),
      programWeeks: COACH_PROGRAM_WEEKS,
      coachNotes: coachProgramNotes(input),
      mode: "coach_sheet",
    };
  }

  const sheetPool = coachSheetExercisePool(exercises);
  if (sheetPool.length >= 4) {
    return {
      days: generateProgram(sheetPool, input),
      programWeeks: 1,
      coachNotes: "Программа из библиотеки упражнений тренера (таблица).",
      mode: "sheet_pool",
    };
  }

  return {
    days: generateProgram(exercises, input),
    programWeeks: 1,
    coachNotes: "",
    mode: "generic",
  };
}

export const ANNA_USER_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
