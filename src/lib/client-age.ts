/** Возраст клиента: только полные годы из профиля/анкеты. Дату рождения больше не собираем. */

export const MIN_STORED_AGE = 14;
export const MAX_STORED_AGE = 100;

export const AGE_FILL_HINT =
  "возраст: поле «Возраст, полных лет» в первом шаге анкеты или в профиле клиента";

const YEAR_MS = 31_557_600_000;

export function ageFromBirthDate(
  birthDate: string | null | undefined,
  now = Date.now(),
): number | null {
  const raw = birthDate?.trim();
  if (!raw) return null;
  const born = new Date(raw);
  if (Number.isNaN(born.getTime()) || born.getTime() > now) return null;
  const age = Math.floor((now - born.getTime()) / YEAR_MS);
  if (!Number.isInteger(age) || age < 1 || age > 120) return null;
  return age;
}

export function normalizeStoredAge(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(numeric) || numeric < MIN_STORED_AGE || numeric > MAX_STORED_AGE) {
    return null;
  }
  return numeric;
}

export function parseAgeYearsInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return normalizeStoredAge(Number(trimmed));
}

export function resolveClientAge(input: {
  birthDate?: string | null;
  ageYears?: number | null;
  now?: number;
}): number | null {
  const stored = normalizeStoredAge(input.ageYears);
  if (stored != null) return stored;
  return ageFromBirthDate(input.birthDate, input.now);
}
