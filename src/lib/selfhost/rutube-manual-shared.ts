export type ManualCollection = "workout" | "workout_male" | "piece";
export type ManualWorkoutCollection = "workout" | "workout_male";

/** Мужские целые тренировки — только при поле male в анкете/профиле. */
export function clientAllowsMaleWorkouts(gender: "female" | "male" | null | undefined): boolean {
  return gender === "male";
}

export function isManualWorkoutCollection(value: string): value is ManualWorkoutCollection {
  return value === "workout" || value === "workout_male";
}
