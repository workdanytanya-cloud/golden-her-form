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

/** Нормализация ключей инвентаря из каталога (включая русские подписи). */
export function normalizeEquipmentKey(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return value;
  if (value === "коврик" || value === "mat") return "mat";
  if (value.includes("гантел") || value === "dumbbell") return "dumbbell";
  if (
    value.includes("резин") ||
    value.includes("лент") ||
    value.includes("амортизатор") ||
    value === "band" ||
    value === "resistance_band"
  ) {
    return "band";
  }
  if (value.includes("гир") || value === "kettlebell") return "kettlebell";
  if (value.includes("штан") || value === "barbell") return "barbell";
  if (value.includes("стул") || value === "chair") return "chair";
  if (value.includes("бутыл") || value.includes("вод")) return "dumbbell";
  return value;
}

export function normalizeExerciseEquipmentKeys(equipment: string[] | null | undefined): string[] {
  return [...new Set((equipment ?? []).map(normalizeEquipmentKey).filter(Boolean))];
}

/** Доступный клиенту инвентарь (ключи БД). */
export function clientAvailableEquipmentKeys(
  equipment: string[] | null | undefined,
  location: string | null | undefined,
): Set<string> {
  const items = equipment ?? [];
  const available = new Set<string>(["bodyweight", "mat", "chair"]);

  if (items.length === 1 && items[0] === "Ничего") {
    return new Set(["bodyweight", "mat", "chair"]);
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
  const required = normalizeExerciseEquipmentKeys(exercise.equipment);
  if (required.length === 0) return true;
  return required.every((r) => available.has(r) || r === "mat");
}
