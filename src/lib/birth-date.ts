import { z } from "zod";

/** Сообщение у поля. Показывается до запроса в базу. */
export const BIRTH_DATE_INVALID_MESSAGE =
  "Дата рождения указана некорректно. Введите её как ГГГГ-ММ-ДД или оставьте поле пустым.";

export const BIRTH_DATE_FUTURE_MESSAGE = "Дата рождения не может быть в будущем.";

const MIN_BIRTH_YEAR = 1900;

export type BirthDateParse =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Календарная дата без часового пояса.
 * `new Date("1993-01-01")` и `toISOString()` сдвигают день; здесь сравниваются только компоненты UTC.
 */
function calendarParts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_BIRTH_YEAR || month < 1 || month > 12) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatYmd(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return calendarParts(iso) ? iso : null;
}

function todayIso(now: Date): string {
  return formatYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()) ?? "1970-01-01";
}

/**
 * Пустая строка — явная очистка (NULL).
 * Иначе только реальная календарная дата `YYYY-MM-DD`. Возраст сюда не входит.
 */
export function parseBirthDateInput(value: unknown, now = new Date()): BirthDateParse {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: BIRTH_DATE_INVALID_MESSAGE };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parts = calendarParts(trimmed);
  if (!parts) return { ok: false, message: BIRTH_DATE_INVALID_MESSAGE };
  if (trimmed > todayIso(now)) return { ok: false, message: BIRTH_DATE_FUTURE_MESSAGE };
  return { ok: true, value: trimmed };
}

/**
 * Значение колонки `date` из node-pg — это локальная полночь, не текст.
 * `String(date).slice(0, 10)` для 1993-01-01 даёт `Fri Jan 01`, а `toISOString()` — предыдущий день.
 * Берём календарные компоненты локальной даты, как их собрал парсер `date`, либо уже готовый `YYYY-MM-DD`.
 */
export function birthDateFromPg(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return calendarParts(trimmed) ? trimmed : null;
}

/** Значение для `<input type="date">`: только `YYYY-MM-DD` или пустая строка. */
export function birthDateForInput(value: unknown): string {
  return birthDateFromPg(value) ?? "";
}

/**
 * Частичное обновление: ту же дату не перезаписываем, очищенное поле становится NULL,
 * новая дата уходит как `YYYY-MM-DD`. Некорректный текст не попадает в запрос.
 */
export function resolveBirthDatePatch(
  loaded: string | null,
  current: string,
  now = new Date(),
): { ok: true; patch: { birth_date?: string | null } } | { ok: false; message: string } {
  const parsed = parseBirthDateInput(current, now);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const loadedValue = birthDateFromPg(loaded);
  if (parsed.value === loadedValue) return { ok: true, patch: {} };
  return { ok: true, patch: { birth_date: parsed.value } };
}

export const birthDateSchema = z
  .union([z.string(), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    if (value == null) return;
    const parsed = parseBirthDateInput(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
    }
  })
  .transform((value) => {
    if (value === undefined) return undefined;
    const parsed = parseBirthDateInput(value);
    return parsed.ok ? parsed.value : null;
  });
