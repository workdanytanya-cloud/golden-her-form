import type { Exercise } from "@/lib/training";

/** Сопоставление инвентаря из анкеты с ключами в exercises.equipment. */
const ONBOARDING_EQUIPMENT_MAP: Record<string, string[]> = {
  Гантели: ["dumbbell"],
  "Резинки/фитнес-ленты": ["band", "resistance_band"],
  Коврик: ["mat"],
  Штанга: ["barbell"],
  "Тренажёры зала": ["gym_machine", "machine", "cable"],
  "Кардио-тренажёр": ["cardio_machine"],
  Гиря: ["kettlebell"],
  Ничего: ["bodyweight"],
};

/** Доступный клиенту инвентарь (ключи БД). */
export function clientAvailableEquipmentKeys(
  equipment: string[] | null | undefined,
  location: string | null | undefined,
): Set<string> {
  const items = equipment ?? [];
  const available = new Set<string>(["bodyweight", "mat"]);

  if (items.length === 1 && items[0] === "Ничего") {
    return new Set(["bodyweight", "mat"]);
  }

  for (const item of items) {
    for (const key of ONBOARDING_EQUIPMENT_MAP[item] ?? []) {
      available.add(key);
    }
  }

  if (location === "gym" || location === "mixed") {
    for (const key of ["gym_machine", "machine", "cable", "barbell", "cardio_machine"]) {
      available.add(key);
    }
  }

  return available;
}

/** Упражнение выполнимо с доступным инвентарём. Пустой equipment = bodyweight/mat. */
export function exerciseMatchesEquipment(
  exercise: Pick<Exercise, "equipment">,
  available: Set<string>,
): boolean {
  const required = (exercise.equipment ?? []).filter(Boolean);
  if (required.length === 0) return true;
  return required.every((r) => available.has(r) || r === "mat");
}
