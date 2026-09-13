/** Конфигурация конструктора рационов PanovaPRO — все числовые константы здесь. */

/** Режимы для новых клиентов (выбор в анкете / кабинете). */
export const MEAL_SCHEDULE_MODES_CLIENT = [
  "three_main_two_snacks",
  "three_mains_only",
  "one_main_three_snacks",
] as const;

/** Legacy 2+2 — только для уже опубликованных планов и ручного выбора тренера. */
export const MEAL_SCHEDULE_MODE_LEGACY = "two_main_two_snacks" as const;

export const MEAL_SCHEDULE_MODES = [
  ...MEAL_SCHEDULE_MODES_CLIENT,
  MEAL_SCHEDULE_MODE_LEGACY,
] as const;

export type MealScheduleMode = (typeof MEAL_SCHEDULE_MODES)[number];

export function isLegacyScheduleMode(mode: MealScheduleMode): boolean {
  return mode === MEAL_SCHEDULE_MODE_LEGACY;
}

export function isClientScheduleMode(mode: MealScheduleMode): boolean {
  return (MEAL_SCHEDULE_MODES_CLIENT as readonly string[]).includes(mode);
}

export const PRIMARY_MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;
export type PrimaryMealSlot = (typeof PRIMARY_MEAL_SLOTS)[number];

export const MEAL_SCHEDULE_LABELS: Record<MealScheduleMode, string> = {
  three_main_two_snacks: "Полноценный рацион (3 основных + 2 перекуса)",
  three_mains_only: "Три полноценных приёма без перекусов",
  one_main_three_snacks: "1 основной + 3 перекуса без готовки",
  two_main_two_snacks: "Legacy: 2 основных + 2 перекуса",
};

export const MEAL_SCHEDULE_CLIENT_LABELS: Record<MealScheduleMode, string> = {
  three_main_two_snacks: "5 приёмов",
  three_mains_only: "3 полноценных приёма",
  one_main_three_snacks: "1 основной + 3 перекуса",
  two_main_two_snacks: "Классический (legacy)",
};

export const MEAL_SCHEDULE_TAGLINES: Record<MealScheduleMode, string> = {
  three_main_two_snacks: "Завтрак, обед, ужин и 2 полезных перекуса",
  three_mains_only: "Только завтрак, обед и ужин — без перекусов",
  one_main_three_snacks: "Один полноценный приём и 3 перекуса без готовки",
  two_main_two_snacks: "2 полноценных приёма и 2 перекуса (старый формат)",
};

export const MEAL_SCHEDULE_DESCRIPTIONS: Record<MealScheduleMode, string> = {
  three_main_two_snacks:
    "Сбалансированный день: три основных приёма с приготовлением и два лёгких перекуса между ними. Подходит, если вы готовите дома и хотите разнообразное меню.",
  three_mains_only:
    "Три полноценных приёма без перекусов. Удобно, если вы предпочитаете есть реже, но сытно.",
  one_main_three_snacks:
    "Для плотного графика: один полноценный приём в удобное время и три перекуса, которые собираются за 1–3 минуты и их можно взять с собой.",
  two_main_two_snacks:
    "Прежний формат программы. Сохранён для уже назначенных рационов.",
};

export function mealScheduleClientLabel(mode: MealScheduleMode): string {
  return MEAL_SCHEDULE_CLIENT_LABELS[mode];
}

export function mealScheduleDescription(mode: MealScheduleMode): string {
  return MEAL_SCHEDULE_DESCRIPTIONS[mode];
}

export const PRIMARY_MEAL_SLOT_LABELS: Record<PrimaryMealSlot, string> = {
  breakfast: "утром",
  lunch: "днём",
  dinner: "вечером",
};

export const ALL_PLAN_SLOTS = ["main1", "main2", "main3", "snack1", "snack2", "snack3"] as const;
export type PlanSlot = (typeof ALL_PLAN_SLOTS)[number];

/** @deprecated */
export type ConstructorSlot = PlanSlot;

export const SLOTS_THREE_MAIN_TWO_SNACKS: PlanSlot[] = [
  "main1",
  "snack1",
  "main2",
  "snack2",
  "main3",
];
export const SLOTS_THREE_MAINS_ONLY: PlanSlot[] = ["main1", "main2", "main3"];
export const SLOTS_TWO_MAIN_TWO_SNACKS: PlanSlot[] = ["main1", "snack1", "main2", "snack2"];
export const SLOTS_ONE_MAIN_THREE_SNACKS: PlanSlot[] = ["main1", "snack1", "snack2", "snack3"];

/** @deprecated */
export const CONSTRUCTOR_SLOTS = SLOTS_TWO_MAIN_TWO_SNACKS;

export function slotsForMode(mode: MealScheduleMode): PlanSlot[] {
  switch (mode) {
    case "three_main_two_snacks":
      return [...SLOTS_THREE_MAIN_TWO_SNACKS];
    case "three_mains_only":
      return [...SLOTS_THREE_MAINS_ONLY];
    case "one_main_three_snacks":
      return [...SLOTS_ONE_MAIN_THREE_SNACKS];
    default:
      return [...SLOTS_TWO_MAIN_TWO_SNACKS];
  }
}

export function expectedMainCount(mode: MealScheduleMode): number {
  switch (mode) {
    case "three_main_two_snacks":
    case "three_mains_only":
      return 3;
    case "one_main_three_snacks":
      return 1;
    default:
      return 2;
  }
}

export function expectedSnackCount(mode: MealScheduleMode): number {
  switch (mode) {
    case "three_main_two_snacks":
      return 2;
    case "three_mains_only":
      return 0;
    case "one_main_three_snacks":
      return 3;
    default:
      return 2;
  }
}

/** Порядок отображения приёмов в течение дня. */
export function displayOrderForPlan(
  mode: MealScheduleMode,
  primarySlot: PrimaryMealSlot = "lunch",
): PlanSlot[] {
  if (mode === "three_main_two_snacks") return [...SLOTS_THREE_MAIN_TWO_SNACKS];
  if (mode === "three_mains_only") return [...SLOTS_THREE_MAINS_ONLY];
  if (mode === "two_main_two_snacks") return [...SLOTS_TWO_MAIN_TWO_SNACKS];

  const snacks: PlanSlot[] = ["snack1", "snack2", "snack3"];
  const main: PlanSlot = "main1";
  if (primarySlot === "breakfast") return [main, ...snacks];
  if (primarySlot === "dinner") return [...snacks.slice(0, 2), main, snacks[2]!];
  return [snacks[0]!, main, snacks[1]!, snacks[2]!];
}

export const SLOT_LABELS: Record<PlanSlot, string> = {
  main1: "Завтрак",
  main2: "Обед",
  main3: "Ужин",
  snack1: "Перекус №1",
  snack2: "Перекус №2",
  snack3: "Перекус №3",
};

export function slotLabel(
  slot: PlanSlot,
  mode: MealScheduleMode,
  primarySlot: PrimaryMealSlot = "lunch",
): string {
  if (mode === "three_main_two_snacks" || mode === "three_mains_only") {
    return SLOT_LABELS[slot];
  }
  if (mode === "two_main_two_snacks") {
    if (slot === "main1") return "Основной приём №1";
    if (slot === "main2") return "Основной приём №2";
    return SLOT_LABELS[slot];
  }
  if (mode === "one_main_three_snacks" && slot === "main1") {
    if (primarySlot === "breakfast") return "Основной приём (завтрак)";
    if (primarySlot === "dinner") return "Основной приём (ужин)";
    return "Основной приём (обед)";
  }
  return SLOT_LABELS[slot];
}

export const SLOT_CALORIE_SHARE_THREE_MAIN_TWO: Record<PlanSlot, number> = {
  main1: 0.25,
  snack1: 0.1,
  main2: 0.3,
  snack2: 0.1,
  main3: 0.25,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_THREE_MAINS: Record<PlanSlot, number> = {
  main1: 0.3,
  main2: 0.35,
  main3: 0.35,
  snack1: 0,
  snack2: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.35,
  snack1: 0.15,
  main2: 0.35,
  snack2: 0.15,
  main3: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.5,
  snack1: 0.167,
  snack2: 0.167,
  snack3: 0.166,
  main2: 0,
  main3: 0,
};

export function slotCalorieShare(mode: MealScheduleMode): Record<PlanSlot, number> {
  switch (mode) {
    case "three_main_two_snacks":
      return SLOT_CALORIE_SHARE_THREE_MAIN_TWO;
    case "three_mains_only":
      return SLOT_CALORIE_SHARE_THREE_MAINS;
    case "one_main_three_snacks":
      return SLOT_CALORIE_SHARE_ONE_MAIN;
    default:
      return SLOT_CALORIE_SHARE_TWO_MAIN;
  }
}

export const SLOT_CALORIE_SHARE_MIN_THREE_MAIN_TWO: Record<PlanSlot, number> = {
  main1: 0.2,
  snack1: 0.08,
  main2: 0.25,
  snack2: 0.08,
  main3: 0.2,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MAX_THREE_MAIN_TWO: Record<PlanSlot, number> = {
  main1: 0.3,
  snack1: 0.14,
  main2: 0.35,
  snack2: 0.14,
  main3: 0.3,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MIN_THREE_MAINS: Record<PlanSlot, number> = {
  main1: 0.25,
  main2: 0.3,
  main3: 0.3,
  snack1: 0,
  snack2: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MAX_THREE_MAINS: Record<PlanSlot, number> = {
  main1: 0.35,
  main2: 0.4,
  main3: 0.4,
  snack1: 0,
  snack2: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MIN_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.28,
  snack1: 0.1,
  main2: 0.28,
  snack2: 0.1,
  main3: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MAX_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.42,
  snack1: 0.2,
  main2: 0.42,
  snack2: 0.2,
  main3: 0,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MIN_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.45,
  snack1: 0.14,
  snack2: 0.14,
  snack3: 0.14,
  main2: 0,
  main3: 0,
};

export const SLOT_CALORIE_SHARE_MAX_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.55,
  snack1: 0.2,
  snack2: 0.2,
  snack3: 0.2,
  main2: 0,
  main3: 0,
};

export function slotCalorieShareBounds(mode: MealScheduleMode): {
  min: Record<PlanSlot, number>;
  max: Record<PlanSlot, number>;
} {
  switch (mode) {
    case "three_main_two_snacks":
      return {
        min: SLOT_CALORIE_SHARE_MIN_THREE_MAIN_TWO,
        max: SLOT_CALORIE_SHARE_MAX_THREE_MAIN_TWO,
      };
    case "three_mains_only":
      return { min: SLOT_CALORIE_SHARE_MIN_THREE_MAINS, max: SLOT_CALORIE_SHARE_MAX_THREE_MAINS };
    case "one_main_three_snacks":
      return { min: SLOT_CALORIE_SHARE_MIN_ONE_MAIN, max: SLOT_CALORIE_SHARE_MAX_ONE_MAIN };
    default:
      return { min: SLOT_CALORIE_SHARE_MIN_TWO_MAIN, max: SLOT_CALORIE_SHARE_MAX_TWO_MAIN };
  }
}

/** @deprecated */
export const SLOT_CALORIE_SHARE = SLOT_CALORIE_SHARE_TWO_MAIN;

export const PLAN_DAY_OPTIONS = [1, 7, 14, 28] as const;
export type PlanDaysCount = (typeof PLAN_DAY_OPTIONS)[number];

export const ACTIVITY_FACTORS = {
  low: 1.2,
  sedentary: 1.2,
  medium: 1.375,
  moderate: 1.375,
  high: 1.55,
  very_high: 1.725,
} as const;

export const DEFAULT_GOAL_ADJUSTMENT = {
  weight_loss: -15,
  maintain: 0,
  muscle_gain: 10,
} as const;

export const ADJUSTMENT_PCT_MIN = -25;
export const ADJUSTMENT_PCT_MAX = 20;

export const PROTEIN_G_PER_KG = { min: 1.5, max: 2.0, default: 1.8 } as const;
export const FAT_G_PER_KG = { min: 0.8, max: 1.0, default: 0.9 } as const;

/** Единый строгий допуск для всех режимов. */
export const DEFAULT_TOLERANCE = {
  kcal: 5,
  protein_g: 1,
  fat_g: 1,
  carbs_g: 1,
} as const;

/** @deprecated — больше не используется для генерации; только legacy UI. */
export const ONE_MAIN_TOLERANCE = DEFAULT_TOLERANCE;

export function toleranceForMode(_mode: MealScheduleMode): typeof DEFAULT_TOLERANCE {
  return DEFAULT_TOLERANCE;
}

export const SAFE_KCAL = { min: 1200, max: 4000 } as const;
export const MIN_AUTO_AGE = 18;

export const SNACK_MAX_PRODUCTS = 4;
export const SNACK_MIN_PRODUCTS = 2;

export const GRAM_STEP = 1;
export const GRAM_STEP_COARSE = 5;
export const MAIN_RECIPE_REPEAT_DAYS = 3;

/** Масло в одном основном приёме (г). */
export const OIL_GRAM_MIN = 3;
export const OIL_GRAM_MAX = 15;
/** Максимум масла за день (г) — настройка оптимизатора. */
export const OIL_DAILY_MAX_G = 30;

export const MAX_ACTIVE_PREP_MINUTES = 20;
export const MAX_TOTAL_COOK_MINUTES = 40;

export const ONE_MAIN_UNACHIEVABLE_MESSAGE =
  'Не удалось собрать рацион в формате «1 основной + 3 перекуса» с заданными KBJU. Измените целевые показатели, доступные продукты или выберите другой режим питания.';

export const MACRO_INCOMPATIBLE_MESSAGE =
  "Заданные калории и БЖУ математически несовместимы. Проверьте целевые показатели.";

export const WEIGHING_NOTICE =
  "Крупы взвешиваются сухими, мясо и рыба — до приготовления, консервы — без жидкости. Расчёт выполнен по данным карточек продуктов.";
