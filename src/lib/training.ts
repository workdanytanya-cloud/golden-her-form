// Training module — pure logic: exercise types, program generation, day templates.

export type ExerciseCategory =
  | "warmup"
  | "mobility"
  | "activation"
  | "core"
  | "strength_lower"
  | "strength_upper"
  | "strength_full"
  | "cardio"
  | "cooldown";

export type Exercise = {
  id: string;
  slug: string;
  name: string;
  category: ExerciseCategory;
  muscle_groups: string[];
  equipment: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  tags: string[];
  description: string | null;
  cues: string[];
  common_mistakes: string[];
  gif_url: string | null;
  video_url: string | null;
  default_sets: number;
  default_reps: string;
  tempo: string | null;
  rest_seconds: number;
};

export type ExerciseSet = {
  exercise_id: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  tempo?: string | null;
  note?: string | null;
};

export type ProgramDay = {
  day_index: number; // 0..6 (Пн..Вс)
  is_rest: boolean;
  title: string;
  focus: string | null;
  description: string | null;
  warmup: ExerciseSet[];
  exercises: ExerciseSet[];
  cooldown: ExerciseSet[];
  day_note: string | null;
};

export type ProgramGoal = "weight_loss" | "tone" | "muscle_gain" | "rehab" | "maintain";
export type ProgramLevel = "beginner" | "intermediate" | "advanced";

export type ProgramInput = {
  sessions_per_week: 3 | 4;
  goal: ProgramGoal;
  level: ProgramLevel;
  has_injuries: boolean;
  injuries_details?: string | null;
  equipment?: string[];
  location?: string | null;
  /** Последний известный вес клиента (кг). При >85 — без прыжков/ударных. */
  weight_kg?: number | null;
};

/** Порог: выше — без ударных, прыжковых и жёстких нагрузок на суставы. */
export const JOINT_CARE_WEIGHT_KG = 85;

const IMPACT_TEXT_RE =
  /прыж|jump|берпи|burpee|скакал|mountain.?climb|box.?jump|plyo|выпрыг|ударн|кикбокс|high.?knee|jumping.?jack|kb-swing|махи\s*гир/i;

export function needsJointCare(
  input: Pick<ProgramInput, "has_injuries" | "goal" | "weight_kg">,
): boolean {
  if (input.has_injuries || input.goal === "rehab") return true;
  const w = input.weight_kg;
  return typeof w === "number" && Number.isFinite(w) && w > JOINT_CARE_WEIGHT_KG;
}

export function isImpactOrJumpExercise(e: Pick<Exercise, "slug" | "name" | "tags">): boolean {
  const tags = e.tags.map((t) => t.toLowerCase());
  if (
    tags.some((t) =>
      ["jumping", "high_impact", "plyometric", "impact", "берпи"].includes(t),
    )
  ) {
    return true;
  }
  return IMPACT_TEXT_RE.test(`${e.slug} ${e.name}`);
}

export const WEEKDAY_LABELS = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

// -------------- Goal / level derivation --------------

export function inferGoal(raw: string | null | undefined): ProgramGoal {
  const g = (raw ?? "").toLowerCase();
  if (/(похуд|снижен|жир|weight_loss|lose)/.test(g)) return "weight_loss";
  if (/(набор|мышц|gain|muscle)/.test(g)) return "muscle_gain";
  if (/(реабилит|восстанов|rehab|injur)/.test(g)) return "rehab";
  if (/(тонус|форм|подтян|tone)/.test(g)) return "tone";
  return "maintain";
}

export function inferLevel(activity: string | null | undefined): ProgramLevel {
  const a = (activity ?? "").toLowerCase();
  if (/(high|very_high|advanced)/.test(a)) return "advanced";
  if (/(moderate|medium|intermediate)/.test(a)) return "intermediate";
  return "beginner";
}

// -------------- Split templates --------------

type SlotSpec = {
  category: ExerciseCategory;
  muscleHint?: string[]; // preferred muscle groups
  sets?: number;
  reps?: string;
  rest?: number;
  tempo?: string;
};

type DayTemplate = {
  title: string;
  focus: string;
  description: string;
  warmup: SlotSpec[];
  main: SlotSpec[];
  cooldown: SlotSpec[];
};

const WARMUP_STANDARD: SlotSpec[] = [
  { category: "warmup", sets: 1, reps: "60 сек" },
  { category: "mobility", sets: 1, reps: "8-10" },
  { category: "activation", sets: 2, reps: "12-15" },
];

const COOLDOWN_STANDARD: SlotSpec[] = [
  { category: "cooldown", sets: 1, reps: "40 сек" },
  { category: "cooldown", sets: 1, reps: "40 сек" },
];

function fullBodyDay(letter: "A" | "B" | "C", withCardio: boolean): DayTemplate {
  return {
    title: `Full Body ${letter}`,
    focus: "Всё тело — база на силу и тонус",
    description:
      "Комплекс на все крупные мышечные группы: работаем над силой ног и ягодиц, укрепляем спину и грудной отдел, добавляем стабилизацию корпуса. Задача — прокачать основные паттерны и удержать нейтральную поясницу.",
    warmup: WARMUP_STANDARD,
    main: [
      {
        category: "strength_lower",
        muscleHint: letter === "A" ? ["квадрицепс"] : ["ягодицы", "задняя поверхность"],
      },
      {
        category: "strength_upper",
        muscleHint: letter === "B" ? ["грудные"] : ["спина", "широчайшие"],
      },
      { category: "strength_lower", muscleHint: ["ягодицы"] },
      { category: "strength_upper", muscleHint: letter === "A" ? ["спина"] : ["плечи"] },
      { category: "core" },
      ...(withCardio ? [{ category: "cardio" as ExerciseCategory }] : []),
    ],
    cooldown: COOLDOWN_STANDARD,
  };
}

function upperDay(): DayTemplate {
  return {
    title: "Верх тела",
    focus: "Грудь, спина, плечи, руки",
    description:
      "Развиваем верх плечевого пояса. Работаем над осанкой через тяги, укрепляем грудные и плечи. Профилактика сутулости — обязательный компонент.",
    warmup: WARMUP_STANDARD,
    main: [
      { category: "strength_upper", muscleHint: ["грудные"] },
      { category: "strength_upper", muscleHint: ["спина", "широчайшие"] },
      { category: "strength_upper", muscleHint: ["плечи"] },
      { category: "strength_upper", muscleHint: ["задние дельты"] },
      { category: "strength_upper", muscleHint: ["бицепс"] },
      { category: "strength_upper", muscleHint: ["трицепс"] },
      { category: "core" },
    ],
    cooldown: COOLDOWN_STANDARD,
  };
}

function lowerDay(): DayTemplate {
  return {
    title: "Низ тела",
    focus: "Ягодицы, ноги, задняя цепь",
    description:
      "Сессия на нижнюю часть тела: активируем ягодицы, работаем над квадрицепсом и задней поверхностью бедра. Ставим паттерн приседа и шарнира бедра — фундамент здоровой поясницы.",
    warmup: WARMUP_STANDARD,
    main: [
      { category: "strength_lower", muscleHint: ["квадрицепс"] },
      { category: "strength_lower", muscleHint: ["задняя поверхность", "ягодицы"] },
      { category: "strength_lower", muscleHint: ["ягодицы"] },
      { category: "strength_lower", muscleHint: ["ягодицы", "квадрицепс"] },
      { category: "strength_lower", muscleHint: ["икры"] },
      { category: "core" },
    ],
    cooldown: COOLDOWN_STANDARD,
  };
}

function pushDay(): DayTemplate {
  return {
    title: "Push (жимовые)",
    focus: "Грудные, плечи, трицепс",
    description:
      "Жимовая сессия: развиваем передние толкающие мышцы. Фокус на технике и подконтрольном движении.",
    warmup: WARMUP_STANDARD,
    main: [
      { category: "strength_upper", muscleHint: ["грудные"] },
      { category: "strength_upper", muscleHint: ["плечи"] },
      { category: "strength_upper", muscleHint: ["грудные"] },
      { category: "strength_upper", muscleHint: ["трицепс"] },
      { category: "core" },
    ],
    cooldown: COOLDOWN_STANDARD,
  };
}

function pullDay(): DayTemplate {
  return {
    title: "Pull (тяговые)",
    focus: "Спина, задние дельты, бицепс",
    description:
      "Тяговая сессия: строим осанку, укрепляем спину и заднюю дельту, снимаем сутулость.",
    warmup: WARMUP_STANDARD,
    main: [
      { category: "strength_upper", muscleHint: ["широчайшие", "спина"] },
      { category: "strength_upper", muscleHint: ["спина"] },
      { category: "strength_upper", muscleHint: ["задние дельты"] },
      { category: "strength_upper", muscleHint: ["бицепс"] },
      { category: "core" },
    ],
    cooldown: COOLDOWN_STANDARD,
  };
}

function legsDay(): DayTemplate {
  return { ...lowerDay(), title: "Legs (ноги)" };
}

function rehabDay(letter: "A" | "B"): DayTemplate {
  return {
    title: `Восстановительная сессия ${letter}`,
    focus: "Мобильность, активация, глубокая стабилизация",
    description:
      "Сессия направлена на восстановление функционального движения: мягкая мобилизация суставов, активация ягодиц и глубоких стабилизаторов, безопасная силовая работа без ударных нагрузок.",
    warmup: [
      { category: "warmup", sets: 2, reps: "8-10" },
      { category: "mobility", sets: 2, reps: "8" },
    ],
    main: [
      { category: "activation", sets: 3, reps: "12-15" },
      { category: "activation", sets: 3, reps: "12-15" },
      { category: "strength_lower", muscleHint: ["ягодицы"] },
      { category: "core" },
      { category: "core" },
    ],
    cooldown: [
      { category: "cooldown", sets: 1, reps: "45 сек" },
      { category: "cooldown", sets: 1, reps: "45 сек" },
      { category: "cooldown", sets: 1, reps: "45 сек" },
    ],
  };
}

function restDay(dayIndex: number): ProgramDay {
  return {
    day_index: dayIndex,
    is_rest: true,
    title: "Активный отдых",
    focus: "Восстановление",
    description:
      "День без силовой работы. Мягкая мобильность, прогулка 30-40 минут, растяжка, сон и вода. Восстановление — часть тренировочного процесса.",
    warmup: [],
    exercises: [],
    cooldown: [],
    day_note: null,
  };
}

// -------------- Split scheduling --------------

function planWeek(input: ProgramInput): DayTemplate[] {
  const { sessions_per_week, goal, has_injuries } = input;
  if (has_injuries || goal === "rehab") {
    if (sessions_per_week >= 4) return [rehabDay("A"), rehabDay("B"), rehabDay("A"), rehabDay("B")];
    return [rehabDay("A"), rehabDay("B"), rehabDay("A")];
  }
  // Вес >85 кг: ударные/прыжковые отсекаются в pickExerciseForSlot, кардио оставляем (low-impact).
  if (goal === "muscle_gain") {
    if (sessions_per_week >= 4) return [upperDay(), lowerDay(), upperDay(), lowerDay()];
    return [pushDay(), pullDay(), legsDay()];
  }
  if (goal === "weight_loss") {
    if (sessions_per_week >= 4)
      return [
        fullBodyDay("A", true),
        fullBodyDay("B", true),
        fullBodyDay("C", true),
        fullBodyDay("A", true),
      ];
    return [fullBodyDay("A", true), fullBodyDay("B", true), fullBodyDay("C", true)];
  }
  // tone / maintain
  if (sessions_per_week >= 4) return [upperDay(), lowerDay(), upperDay(), lowerDay()];
  return [fullBodyDay("A", true), fullBodyDay("B", true), fullBodyDay("C", true)];
}

// Place training days evenly across the week (Пн..Вс)
function scheduleSlots(sessions: number): number[] {
  if (sessions === 3) return [0, 2, 4]; // Пн, Ср, Пт
  if (sessions === 4) return [0, 1, 3, 5]; // Пн, Вт, Чт, Сб
  return [0, 2, 4];
}

// -------------- Exercise selection --------------

function pickExerciseForSlot(
  slot: SlotSpec,
  exercises: Exercise[],
  input: ProgramInput,
  usedInDay: Set<string>,
  weekUse: Map<string, number>,
): Exercise | null {
  const jointCare = needsJointCare(input);
  const excludeTags = new Set<string>();
  if (jointCare) {
    excludeTags.add("high_impact");
    excludeTags.add("jumping");
    excludeTags.add("plyometric");
    excludeTags.add("impact");
  }
  const restrictedSlugs = new Set<string>(
    jointCare
      ? [
          "jumping-jack",
          "kb-swing",
          "mountain-climber",
          "burpee",
          "box-jump",
          "jump-squat",
          "high-knees",
        ]
      : [],
  );

  const pool = exercises.filter((e) => {
    if (e.category !== slot.category) return false;
    if (usedInDay.has(e.id)) return false;
    if (restrictedSlugs.has(e.slug)) return false;
    if (e.tags.some((t) => excludeTags.has(t.toLowerCase()))) return false;
    if (jointCare && isImpactOrJumpExercise(e)) return false;
    // Level ceiling
    if (input.level === "beginner" && e.difficulty === "advanced") return false;
    // При защите суставов не берём advanced на низ/кардио
    if (
      jointCare &&
      e.difficulty === "advanced" &&
      (slot.category === "strength_lower" || slot.category === "cardio")
    ) {
      return false;
    }
    return true;
  });
  if (pool.length === 0) {
    // relax used-in-day, но сохраняем запрет ударных при jointCare
    const relaxed = exercises.filter((e) => {
      if (e.category !== slot.category) return false;
      if (jointCare && (restrictedSlugs.has(e.slug) || isImpactOrJumpExercise(e))) return false;
      if (jointCare && e.tags.some((t) => excludeTags.has(t.toLowerCase()))) return false;
      return true;
    });
    if (relaxed.length === 0) return null;
    return relaxed[Math.floor(Math.random() * relaxed.length)];
  }

  const scored = pool.map((e) => {
    let s = Math.random();
    if (slot.muscleHint) {
      const hits = slot.muscleHint.reduce(
        (a, m) =>
          a + (e.muscle_groups.some((g) => g.toLowerCase().includes(m.toLowerCase())) ? 3 : 0),
        0,
      );
      s += hits;
    }
    if (input.level === "beginner" && e.difficulty === "beginner") s += 0.5;
    const uses = weekUse.get(e.id) ?? 0;
    s -= uses * 1.5;
    if (jointCare && e.tags.includes("rehab")) s += 2;
    if (jointCare && e.tags.includes("low_impact")) s += 2;
    if (jointCare && e.tags.includes("no_jumping")) s += 1;
    return { e, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].e;
}

function toSet(e: Exercise, slot: SlotSpec, input: ProgramInput): ExerciseSet {
  // Reps by goal
  let reps = slot.reps ?? e.default_reps;
  let sets = slot.sets ?? e.default_sets;
  let rest = slot.rest ?? e.rest_seconds;
  if (
    slot.category === "strength_upper" ||
    slot.category === "strength_lower" ||
    slot.category === "strength_full"
  ) {
    if (input.goal === "muscle_gain") {
      reps = "8-10";
      sets = Math.max(sets, 4);
      rest = Math.max(rest, 75);
    } else if (input.goal === "weight_loss") {
      reps = "12-15";
      rest = Math.min(rest, 45);
    } else if (input.goal === "tone") {
      reps = "10-12";
    }
    if (input.level === "beginner") sets = Math.min(sets, 3);
  }
  return {
    exercise_id: e.id,
    sets,
    reps,
    rest_seconds: rest,
    tempo: slot.tempo ?? e.tempo,
    note: null,
  };
}

// -------------- Public generator --------------

export function generateProgram(exercises: Exercise[], input: ProgramInput): ProgramDay[] {
  const templates = planWeek(input);
  const slots = scheduleSlots(input.sessions_per_week);
  const weekUse = new Map<string, number>();

  const days: ProgramDay[] = [];
  for (let d = 0; d < 7; d++) {
    const idx = slots.indexOf(d);
    if (idx === -1) {
      days.push(restDay(d));
      continue;
    }
    const template = templates[idx % templates.length];
    const usedInDay = new Set<string>();

    const build = (specs: SlotSpec[]): ExerciseSet[] => {
      const out: ExerciseSet[] = [];
      for (const spec of specs) {
        const ex = pickExerciseForSlot(spec, exercises, input, usedInDay, weekUse);
        if (!ex) continue;
        usedInDay.add(ex.id);
        weekUse.set(ex.id, (weekUse.get(ex.id) ?? 0) + 1);
        out.push(toSet(ex, spec, input));
      }
      return out;
    };

    days.push({
      day_index: d,
      is_rest: false,
      title: template.title,
      focus: template.focus,
      description: template.description,
      warmup: build(template.warmup),
      exercises: build(template.main),
      cooldown: build(template.cooldown),
      day_note: null,
    });
  }
  return days;
}

// -------------- Default FAQ --------------

export type FaqItem = { q: string; a: string };

export function defaultFaq(input: ProgramInput): FaqItem[] {
  const restBetween = input.sessions_per_week === 3 ? "1-2 дня" : "1 день";
  const durationMin = input.goal === "muscle_gain" ? "50-70" : "45-60";
  return [
    {
      q: "Как часто тренироваться?",
      a: `${input.sessions_per_week} раз в неделю, между силовыми — ${restBetween} на восстановление. В дни отдыха допустима лёгкая активность: прогулка, растяжка.`,
    },
    {
      q: "Сколько длится тренировка?",
      a: `${durationMin} минут вместе с разминкой и заминкой. Разминку и заминку не пропускай — 5-7 минут каждая.`,
    },
    {
      q: "Что если пропустил тренировку?",
      a: "Не удваивай нагрузку. Просто сдвинь программу: пропущенную сессию делай следующим тренировочным днём, дальше по порядку.",
    },
    {
      q: "Как понять, что нагрузка адекватная?",
      a: "Последние 2-3 повтора в подходе должны даваться с усилием, но с чистой техникой. Если можешь спокойно ещё 5 повторов — увеличивай вес. Если техника ломается — снижай.",
    },
    {
      q: "Когда добавлять вес?",
      a: "Когда все подходы выполняешь в верхней границе повторов две тренировки подряд с чистой техникой. Прибавляй небольшие шаги: гантели +1-2 кг, штанга +2.5 кг.",
    },
    {
      q: "Что делать, если появилась боль?",
      a: "Острая, простреливающая боль — остановись, пропусти упражнение и напиши тренеру. Тянущая, мышечная боль — норма после нагрузки. Через 24-48 часов должна пройти.",
    },
    {
      q: "Разминка и заминка обязательны?",
      a: "Да. Разминка готовит суставы и повышает температуру мышц — снижает риск травм. Заминка ускоряет восстановление и сохраняет мобильность.",
    },
    {
      q: "Что есть до и после тренировки?",
      a: "За 1.5-2 часа — комплексные углеводы + белок. Сразу после — вода. В течение часа — приём пищи из твоего плана питания.",
    },
    ...(input.has_injuries
      ? [
          {
            q: "У меня есть противопоказания. Что учитывать?",
            a: "Программа собрана без ударных и рискованных для тебя движений. Если чувствуешь дискомфорт в проблемной зоне — остановись, сообщи тренеру, при необходимости заменим упражнение.",
          },
        ]
      : []),
    ...(typeof input.weight_kg === "number" &&
    input.weight_kg > JOINT_CARE_WEIGHT_KG &&
    !input.has_injuries
      ? [
          {
            q: "Почему в программе нет прыжков и ударных упражнений?",
            a: `При весе выше ${JOINT_CARE_WEIGHT_KG} кг программа автоматически без прыжков, берпи и жёстких ударных нагрузок на суставы — даже если травм нет. Фокус на контролируемой силе, мобильности и безопасном кардио.`,
          },
        ]
      : []),
  ];
}

export const GOAL_LABEL: Record<ProgramGoal, string> = {
  weight_loss: "Снижение веса",
  tone: "Тонус и форма",
  muscle_gain: "Набор мышц",
  rehab: "Восстановление",
  maintain: "Поддержание формы",
};

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  warmup: "Разминка",
  mobility: "Мобильность",
  activation: "Активация",
  core: "Кор",
  strength_lower: "Сила: низ",
  strength_upper: "Сила: верх",
  strength_full: "Сила: всё тело",
  cardio: "Кардио",
  cooldown: "Заминка",
};
