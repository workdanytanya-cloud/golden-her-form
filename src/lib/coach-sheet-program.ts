/**
 * 4-недельная программа по таблице тренера:
 * https://docs.google.com/spreadsheets/d/13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ
 */

import {
  type Exercise,
  type ExerciseSet,
  type ProgramDay,
  type ProgramGoal,
  type ProgramLevel,
  needsJointCare,
  type ProgramInput,
} from "@/lib/training";

export const COACH_SHEET_SOURCE =
  "https://docs.google.com/spreadsheets/d/13tuqIgdPAP3U7PfMakse3hIvZkBCwSbNjJIaUeYmahQ";

export const COACH_PROGRAM_WEEKS = 4;
export const COACH_TRAINING_DAYS = [0, 2, 4] as const;

type SetSpec = {
  slug: string;
  sets: number;
  reps: string;
  rest_seconds?: number;
  note?: string;
};

const W = {
  warmup: "sheet-razminka",
  cooldown: "sheet-zaminka",
  springLunge: "sheet-bokovye-vypady-v-pruzhinke",
  jumpLunge: "sheet-bokovye-vypady-s-pryzhkom",
  halfLungeDb: "sheet-poluvypady-na-meste-s-podemom-ganteli-nad-golovoy",
  boat: "sheet-lodochka-poocheredno",
  plankPress: "sheet-press-v-planke-na-pryamyh-rukah",
  plankArm: "sheet-podem-ruk-iz-planki",
  singleLeg: "sheet-naklony-na-odnoy-noge",
  squatTouch: "sheet-prisedaniya-s-kasaniem-ladoney",
  pushArm: "sheet-otzhimanie-podem-ruki",
  circuit: "sheet-trenirovka",
} as const;

/** Slug'и упражнений из Google Sheet тренера (должны быть в public.exercises). */
export const COACH_SHEET_EXERCISE_SLUGS: readonly string[] = Object.values(W);

export function missingCoachSheetExercises(exercises: Pick<Exercise, "slug">[]): string[] {
  const have = new Set(exercises.map((e) => e.slug));
  return COACH_SHEET_EXERCISE_SLUGS.filter((slug) => !have.has(slug));
}

const WEEK_META: Array<{ title: string; focus: string }> = [
  { title: "Неделя 1 — освоение", focus: "Техника и ритм по таблице тренера." },
  { title: "Неделя 2 — объём", focus: "Больше времени и подходов при том же качестве." },
  { title: "Неделя 3 — вариации", focus: "Медленнее негатив, стабильнее кор." },
  { title: "Неделя 4 — пик", focus: "Максимум блока. Техника важнее скорости." },
];

function pickTime(week: number, values: [string, string, string, string]): string {
  return values[week] ?? values[0];
}

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

function workout1Specs(week: number, jointCare: boolean): SetSpec[] {
  const rounds = week === 0 ? 2 : week === 1 ? 3 : week === 2 ? 3 : 3;
  const main: SetSpec[] = [
    {
      slug: W.springLunge,
      sets: 1,
      reps: pickTime(week, ["2 мин", "2.5 мин", "3 мин", "2.5 мин"]),
      rest_seconds: 30,
    },
  ];

  if (!jointCare) {
    main.push({
      slug: W.jumpLunge,
      sets: 1,
      reps: pickTime(week, ["1 мин", "1.5 мин", "1 мин", "1 мин"]),
      rest_seconds: 45,
    });
  } else {
    main.push({
      slug: W.springLunge,
      sets: 1,
      reps: pickTime(week, ["1.5 мин", "2 мин", "2 мин", "2 мин"]),
      rest_seconds: 30,
      note: "Щадящий вариант вместо прыжков",
    });
  }

  main.push(
    {
      slug: W.halfLungeDb,
      sets: 1,
      reps: pickTime(week, ["1 мин/сторона", "1.5 мин/сторона", "1.5 мин/сторона", "2 мин/сторона"]),
      rest_seconds: 45,
    },
    {
      slug: W.boat,
      sets: 1,
      reps: pickTime(week, ["2 мин", "2.5 мин", "3 мин", "2.5 мин"]),
      rest_seconds: 30,
    },
    {
      slug: W.plankPress,
      sets: 1,
      reps: pickTime(week, ["1 мин", "1.5 мин", "1.5 мин", "2 мин"]),
      rest_seconds: 30,
      note: `Повторить круг ${rounds} раза`,
    },
  );
  return main;
}

function workout2Specs(week: number): SetSpec[] {
  const sets = week === 0 ? 3 : 4;
  const reps = week >= 2 ? "12-15" : "10-12";
  const rest = week === 3 ? 45 : 60;
  return [
    {
      slug: W.plankArm,
      sets: 1,
      reps: pickTime(week, ["2 мин", "2.5 мин", "3 мин", "2.5 мин"]),
      rest_seconds: 30,
    },
    { slug: W.singleLeg, sets, reps, rest_seconds: rest },
    { slug: W.squatTouch, sets, reps, rest_seconds: rest },
    {
      slug: W.pushArm,
      sets,
      reps,
      rest_seconds: rest,
      note: week >= 2 ? "Негатив 3 сек" : undefined,
    },
  ];
}

function workout3Specs(week: number): SetSpec[] {
  const rounds = week === 3 ? 2 : week === 0 ? 2 : 3;
  return [
    {
      slug: W.circuit,
      sets: rounds,
      reps: "круг",
      rest_seconds: 90,
      note: WEEK_META[week].focus,
    },
  ];
}

function resolveSets(specs: SetSpec[], bySlug: Map<string, Exercise>): ExerciseSet[] {
  return specs.map((s) => {
    const ex = bySlug.get(s.slug);
    if (!ex) throw new Error(`Упражнение «${s.slug}» не найдено в базе.`);
    return {
      exercise_id: ex.id,
      sets: s.sets,
      reps: s.reps,
      rest_seconds: s.rest_seconds ?? ex.rest_seconds,
      tempo: ex.tempo,
      note: s.note ?? null,
    };
  });
}

function trainingDay(
  weekIndex: number,
  dayIndex: number,
  workoutNum: 1 | 2 | 3,
  specs: SetSpec[],
  bySlug: Map<string, Exercise>,
): ProgramDay {
  const meta = WEEK_META[weekIndex];
  const warmupEx = bySlug.get(W.warmup);
  const cooldownEx = bySlug.get(W.cooldown);
  if (!warmupEx || !cooldownEx) {
    throw new Error("Разминка/заминка из таблицы не найдены в базе.");
  }

  const titles = {
    1: `Тренировка №1 · ${meta.title}`,
    2: `Тренировка №2 · ${meta.title}`,
    3: `Тренировка №3 · ${meta.title}`,
  };

  return {
    week_index: weekIndex,
    day_index: dayIndex,
    is_rest: false,
    title: titles[workoutNum],
    focus: meta.focus,
    description:
      workoutNum === 1
        ? "Круг на ноги и кор: разминка → блок → заминка."
        : workoutNum === 2
          ? "Баланс, кор и сила верха/низа."
          : "Комплекс по видео тренера.",
    warmup: [
      {
        exercise_id: warmupEx.id,
        sets: 1,
        reps: "по видео",
        rest_seconds: 0,
        note: "Перед тренировкой",
      },
    ],
    exercises: resolveSets(specs, bySlug),
    cooldown: [
      {
        exercise_id: cooldownEx.id,
        sets: 1,
        reps: "по видео",
        rest_seconds: 0,
        note: "После тренировки",
      },
    ],
    day_note: `Неделя ${weekIndex + 1}/${COACH_PROGRAM_WEEKS}`,
  };
}

export function buildCoachSheetProgramDays(
  exercises: Exercise[],
  profile: Pick<ProgramInput, "has_injuries" | "weight_kg" | "goal" | "level">,
): ProgramDay[] {
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));
  const jointCare = needsJointCare(profile);
  const days: ProgramDay[] = [];

  for (let week = 0; week < COACH_PROGRAM_WEEKS; week++) {
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      if (!COACH_TRAINING_DAYS.includes(dayIndex as (typeof COACH_TRAINING_DAYS)[number])) {
        days.push(restDay(week, dayIndex));
        continue;
      }
      const workoutNum = (dayIndex === 0 ? 1 : dayIndex === 2 ? 2 : 3) as 1 | 2 | 3;
      const specs =
        workoutNum === 1
          ? workout1Specs(week, jointCare)
          : workoutNum === 2
            ? workout2Specs(week)
            : workout3Specs(week);
      days.push(trainingDay(week, dayIndex, workoutNum, specs, bySlug));
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
    "4-недельный блок по таблице тренера (3 тренировки: пн / ср / пт).",
    `Цель: ${goalRu}, уровень: ${profile.level}.`,
    profile.has_injuries
      ? "Учтены ограничения из анкеты (без ударных нагрузок)."
      : "Прогрессия: техника → объём → темп → пик.",
  ].join("\n");
}

export const ANNA_USER_ID = "5f75b433-8b2d-46ac-9a8b-a708634cb3d7";
