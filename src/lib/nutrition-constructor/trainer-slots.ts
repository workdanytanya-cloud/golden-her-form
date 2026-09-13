import {
  type MealScheduleMode,
  type PlanSlot,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";

export const TRAINER_CLOCK_SLOTS = [
  { id: "breakfast", label: "Завтрак" },
  { id: "snack1", label: "Перекус 1" },
  { id: "lunch", label: "Обед" },
  { id: "snack2", label: "Перекус 2" },
  { id: "dinner", label: "Ужин" },
  { id: "snack3", label: "Перекус 3" },
] as const;

export type TrainerClockSlot = (typeof TRAINER_CLOCK_SLOTS)[number]["id"];
export type TrainerMealKind = "main" | "snack";

export const TRAINER_MEAL_KIND_LABELS: Record<TrainerMealKind, string> = {
  main: "Основной приём",
  snack: "Перекус без приготовления",
};

export function planSlotForTrainerChoice(params: {
  clock: TrainerClockSlot;
  mealKind: TrainerMealKind;
  mode: MealScheduleMode;
  primarySlot: PrimaryMealSlot;
}): PlanSlot {
  const { clock, mealKind, mode } = params;
  if (clock === "snack1") return "snack1";
  if (clock === "snack2") return "snack2";
  if (clock === "snack3") return "snack3";

  if (mode === "one_main_three_snacks") {
    if (mealKind === "snack") {
      if (clock === "breakfast") return "snack1";
      if (clock === "dinner") return "snack3";
      return "snack2";
    }
    return "main1";
  }

  if (mode === "two_main_two_snacks") {
    if (clock === "breakfast") return "main1";
    return "main2";
  }

  if (clock === "breakfast") return "main1";
  if (clock === "lunch") return "main2";
  return "main3";
}

export function clockLabel(clock: TrainerClockSlot): string {
  return TRAINER_CLOCK_SLOTS.find((slot) => slot.id === clock)?.label ?? clock;
}

export function unusedClockHint(
  mode: MealScheduleMode,
  primarySlot: PrimaryMealSlot,
): string {
  if (mode === "one_main_three_snacks") {
    return `1 основной (${primarySlot}) + snack1/snack2/snack3`;
  }
  return mode;
}
