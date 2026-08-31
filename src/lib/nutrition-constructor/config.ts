/** Конфигурация конструктора рационов PanovaPRO — все числовые константы здесь. */

export const MEAL_SCHEDULE_MODES = ["two_main_two_snacks", "one_main_three_snacks"] as const;
export type MealScheduleMode = (typeof MEAL_SCHEDULE_MODES)[number];

export const PRIMARY_MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;
export type PrimaryMealSlot = (typeof PRIMARY_MEAL_SLOTS)[number];

export const MEAL_SCHEDULE_LABELS: Record<MealScheduleMode, string> = {
  two_main_two_snacks: "Классический (2 основных + 2 перекуса)",
  one_main_three_snacks: "На бегу (1 основной + 3 перекуса без готовки)",
};

/** Короткое название для клиентского кабинета. */
export const MEAL_SCHEDULE_CLIENT_LABELS: Record<MealScheduleMode, string> = {
  two_main_two_snacks: "Классический",
  one_main_three_snacks: "На бегу",
};

/** Подзаголовок на карточке выбора. */
export const MEAL_SCHEDULE_TAGLINES: Record<MealScheduleMode, string> = {
  two_main_two_snacks: "2 полноценных приёма и 2 перекуса",
  one_main_three_snacks: "1 полноценный приём и 3 перекуса без готовки",
};

/** Описание формата меню — простым и грамотным языком. */
export const MEAL_SCHEDULE_DESCRIPTIONS: Record<MealScheduleMode, string> = {
  two_main_two_snacks:
    "Сбалансированный вариант на каждый день: два полноценных приёма пищи с приготовлением и два лёгких перекуса. Подходит, если вы готовите дома и хотите разнообразное меню.",
  one_main_three_snacks:
    "Формат для плотного графика: один полноценный приём пищи в удобное время (завтрак, обед или ужин) и три перекуса, которые не нужно готовить — их можно взять с собой и съесть за несколько минут. Орехи, фрукты, йогурт и другие простые продукты по вашему меню.",
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

/** Все возможные слоты в snapshot плана. */
export const ALL_PLAN_SLOTS = ["main1", "main2", "snack1", "snack2", "snack3"] as const;
export type PlanSlot = (typeof ALL_PLAN_SLOTS)[number];

/** @deprecated используйте PlanSlot */
export type ConstructorSlot = PlanSlot;

export const SLOTS_TWO_MAIN_TWO_SNACKS: PlanSlot[] = ["main1", "snack1", "main2", "snack2"];
export const SLOTS_ONE_MAIN_THREE_SNACKS: PlanSlot[] = ["main1", "snack1", "snack2", "snack3"];

export function slotsForMode(mode: MealScheduleMode): PlanSlot[] {
  return mode === "two_main_two_snacks"
    ? [...SLOTS_TWO_MAIN_TWO_SNACKS]
    : [...SLOTS_ONE_MAIN_THREE_SNACKS];
}

/** Порядок отображения приёмов в течение дня. */
export function displayOrderForPlan(
  mode: MealScheduleMode,
  primarySlot: PrimaryMealSlot = "lunch",
): PlanSlot[] {
  if (mode === "two_main_two_snacks") {
    return [...SLOTS_TWO_MAIN_TWO_SNACKS];
  }
  const snacks: PlanSlot[] = ["snack1", "snack2", "snack3"];
  const main: PlanSlot = "main1";
  if (primarySlot === "breakfast") return [main, ...snacks];
  if (primarySlot === "dinner") return [...snacks.slice(0, 2), main, snacks[2]!];
  return [snacks[0]!, main, snacks[1]!, snacks[2]!];
}

export const SLOT_LABELS: Record<PlanSlot, string> = {
  main1: "Основной приём",
  main2: "Основной приём №2",
  snack1: "Перекус №1",
  snack2: "Перекус №2",
  snack3: "Перекус №3",
};

export function slotLabel(
  slot: PlanSlot,
  mode: MealScheduleMode,
  primarySlot: PrimaryMealSlot = "lunch",
): string {
  if (mode === "one_main_three_snacks" && slot === "main1") {
    if (primarySlot === "breakfast") return "Основной приём (завтрак)";
    if (primarySlot === "dinner") return "Основной приём (ужин)";
    return "Основной приём (обед)";
  }
  if (mode === "two_main_two_snacks" && slot === "main1") return "Основной приём №1";
  if (mode === "two_main_two_snacks" && slot === "main2") return "Основной приём №2";
  return SLOT_LABELS[slot];
}

/** @deprecated используйте SLOTS_TWO_MAIN_TWO_SNACKS */
export const CONSTRUCTOR_SLOTS = SLOTS_TWO_MAIN_TWO_SNACKS;

/** Стартовое распределение калорий — режим 2+2. */
export const SLOT_CALORIE_SHARE_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.35,
  snack1: 0.15,
  main2: 0.35,
  snack2: 0.15,
  snack3: 0,
};

/** Стартовое распределение калорий — режим 1+3. */
export const SLOT_CALORIE_SHARE_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.5,
  snack1: 0.167,
  snack2: 0.167,
  snack3: 0.166,
  main2: 0,
};

export function slotCalorieShare(mode: MealScheduleMode): Record<PlanSlot, number> {
  return mode === "two_main_two_snacks" ? SLOT_CALORIE_SHARE_TWO_MAIN : SLOT_CALORIE_SHARE_ONE_MAIN;
}

export const SLOT_CALORIE_SHARE_MIN_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.28,
  snack1: 0.1,
  main2: 0.28,
  snack2: 0.1,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MAX_TWO_MAIN: Record<PlanSlot, number> = {
  main1: 0.42,
  snack1: 0.2,
  main2: 0.42,
  snack2: 0.2,
  snack3: 0,
};

export const SLOT_CALORIE_SHARE_MIN_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.45,
  snack1: 0.14,
  snack2: 0.14,
  snack3: 0.14,
  main2: 0,
};

export const SLOT_CALORIE_SHARE_MAX_ONE_MAIN: Record<PlanSlot, number> = {
  main1: 0.55,
  snack1: 0.2,
  snack2: 0.2,
  snack3: 0.2,
  main2: 0,
};

export function slotCalorieShareBounds(mode: MealScheduleMode): {
  min: Record<PlanSlot, number>;
  max: Record<PlanSlot, number>;
} {
  return mode === "two_main_two_snacks"
    ? { min: SLOT_CALORIE_SHARE_MIN_TWO_MAIN, max: SLOT_CALORIE_SHARE_MAX_TWO_MAIN }
    : { min: SLOT_CALORIE_SHARE_MIN_ONE_MAIN, max: SLOT_CALORIE_SHARE_MAX_ONE_MAIN };
}

/** @deprecated */
export const SLOT_CALORIE_SHARE = SLOT_CALORIE_SHARE_TWO_MAIN;
/** @deprecated */
export const SLOT_CALORIE_SHARE_MIN = SLOT_CALORIE_SHARE_MIN_TWO_MAIN;
/** @deprecated */
export const SLOT_CALORIE_SHARE_MAX = SLOT_CALORIE_SHARE_MAX_TWO_MAIN;

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

export const DEFAULT_TOLERANCE = {
  kcal: 5,
  protein_g: 1,
  fat_g: 1,
  carbs_g: 1,
} as const;

export const SAFE_KCAL = { min: 1200, max: 4000 } as const;
export const MIN_AUTO_AGE = 18;

export const SNACK_MAX_PRODUCTS = 4;
export const SNACK_MIN_PRODUCTS = 2;

export const GRAM_STEP = 1;
export const MAIN_RECIPE_REPEAT_DAYS = 3;

export const ONE_MAIN_UNACHIEVABLE_MESSAGE =
  'Не удалось собрать рацион в формате «На бегу» (1 основной приём + 3 перекуса без готовки) с заданными КБЖU. Измените целевые показатели, доступные продукты или выберите классический формат «2 основных + 2 перекуса».';

export const WEIGHING_NOTICE =
  "Крупы взвешиваются сухими, мясо и рыба — до приготовления, консервы — без жидкости. Расчёт выполнен по данным карточек продуктов.";
