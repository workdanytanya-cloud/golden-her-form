import pg from "pg";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  BIRTH_DATE_FUTURE_MESSAGE,
  BIRTH_DATE_INVALID_MESSAGE,
  birthDateForInput,
  birthDateFromPg,
  birthDateSchema,
  parseBirthDateInput,
  resolveBirthDatePatch,
} from "@/lib/birth-date";
import { resolveClientAge } from "@/lib/client-age";
import { calcBmr } from "@/lib/nutrition-constructor/targets";
import { PostgresAdminClientRepository } from "@/lib/selfhost/postgres-admin-clients";

const NOW = new Date(2026, 10, 22, 12, 0, 0);
const CLIENT = "b1000000-0000-4000-8000-000000000033";

describe("дата рождения профиля", () => {
  it("показывает, откуда берётся Fri Jan 01, и читает календарный день без сдвига", () => {
    const parsed = pg.types.getTypeParser(1082, "text")("1993-01-01") as Date;
    expect(String(parsed).slice(0, 10)).toBe("Fri Jan 01");
    expect(birthDateFromPg(parsed)).toBe("1993-01-01");
    expect(birthDateForInput(parsed)).toBe("1993-01-01");
    expect(birthDateForInput("Fri Jan 01")).toBe("");
    expect(birthDateFromPg("1993-01-01")).toBe("1993-01-01");
    if (parsed.getTimezoneOffset() !== 0) {
      expect(parsed.toISOString().slice(0, 10)).not.toBe("1993-01-01");
    }
  });

  it("принимает только календарную дату и не выводит её из возраста", () => {
    expect(parseBirthDateInput("", NOW)).toEqual({ ok: true, value: null });
    expect(parseBirthDateInput(null, NOW)).toEqual({ ok: true, value: null });
    expect(parseBirthDateInput("1993-01-01", NOW)).toEqual({ ok: true, value: "1993-01-01" });
    expect(parseBirthDateInput("2024-02-29", NOW).ok).toBe(true);
    expect(parseBirthDateInput("Fri Jan 01", NOW)).toEqual({
      ok: false,
      message: BIRTH_DATE_INVALID_MESSAGE,
    });
    expect(parseBirthDateInput("1992-12-31T17:00:00.000Z", NOW).ok).toBe(false);
    expect(parseBirthDateInput("2023-02-29", NOW).ok).toBe(false);
    expect(parseBirthDateInput("2026-04-31", NOW).ok).toBe(false);
    expect(parseBirthDateInput(33, NOW)).toEqual({
      ok: false,
      message: BIRTH_DATE_INVALID_MESSAGE,
    });
    expect(parseBirthDateInput("2099-01-01", NOW)).toEqual({
      ok: false,
      message: BIRTH_DATE_FUTURE_MESSAGE,
    });
    expect(birthDateSchema.parse(undefined)).toBeUndefined();
    expect(birthDateSchema.parse(null)).toBeNull();
    expect(birthDateSchema.parse("")).toBeNull();
    expect(birthDateSchema.parse("1993-01-01")).toBe("1993-01-01");
    expect(() => birthDateSchema.parse("Fri Jan 01")).toThrow(BIRTH_DATE_INVALID_MESSAGE);
  });

  it("не перезаписывает дату, если её не меняли, и сохраняет явную очистку", () => {
    expect(resolveBirthDatePatch(null, "", NOW)).toEqual({ ok: true, patch: {} });
    expect(resolveBirthDatePatch("1993-01-01", "1993-01-01", NOW)).toEqual({ ok: true, patch: {} });
    expect(resolveBirthDatePatch("1993-01-01", "", NOW)).toEqual({
      ok: true,
      patch: { birth_date: null },
    });
    expect(resolveBirthDatePatch(null, "1990-04-02", NOW)).toEqual({
      ok: true,
      patch: { birth_date: "1990-04-02" },
    });
    expect(resolveBirthDatePatch("Fri Jan 01", "", NOW)).toEqual({ ok: true, patch: {} });
    const invalid = resolveBirthDatePatch(null, "Fri Jan 01", NOW);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toBe(BIRTH_DATE_INVALID_MESSAGE);
  });

  it("считает возраст 33 без даты рождения и не подставляет 1 января", () => {
    const now = Date.parse("2026-11-22T00:00:00Z");
    expect(resolveClientAge({ birthDate: null, ageYears: 33, now })).toBe(33);
    expect(resolveClientAge({ birthDate: "1993-01-01", ageYears: 33, now })).toBe(33);
    const fromAge = calcBmr({
      gender: "female",
      birth_date: null,
      age_years: 33,
      height_cm: 170,
      weight_kg: 70,
    });
    const fallback = calcBmr({
      gender: "female",
      birth_date: null,
      age_years: null,
      height_cm: 170,
      weight_kg: 70,
    });
    expect(fromAge.eq(fallback)).toBe(false);
  });
});

describe("сохранение профиля не отправляет битую дату", () => {
  const friday = new Date(1993, 0, 1);

  function repository(rowBirth: unknown = friday) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (
          sql.includes("SELECT * FROM public.onboarding_responses") ||
          sql.includes("FROM public.measurements")
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO public.profiles") || sql.includes("UPDATE public.profiles")) {
          return { rows: [], rowCount: 1 };
        }
        return {
          rows: [
            {
              id: CLIENT,
              email: "birth-date-fixture@example.invalid",
              account_status: "active",
              created_at: "2026-01-01T00:00:00.000Z",
              full_name: "Тестовый профиль",
              phone: "+70000000000",
              goal: "проверка",
              height_cm: 170,
              birth_date: rowBirth,
              age_years: 33,
              gender: "female",
              avatar_url: null,
              access_status: "active",
              unlock_source: null,
              activated_at: null,
              access_notes: null,
              onboarding_completed_at: null,
              course_count: 1,
              active_course_id: "b1000000-0000-4000-8000-0000000000c1",
            },
          ],
          rowCount: 1,
        };
      },
    };
    return { repo: new PostgresAdminClientRepository(db as unknown as Pool), calls };
  }

  it("читает 1993-01-01, хотя драйвер выглядит как Fri Jan 01", async () => {
    const { repo, calls } = repository();
    const card = await repo.get(CLIENT);
    expect(String(friday).slice(0, 10)).toBe("Fri Jan 01");
    expect(card?.birth_date).toBe("1993-01-01");
    expect(card?.age_years).toBe(33);
    expect(calls[0]?.sql).toContain("birth_date::text");
  });

  it("отклоняет Fri Jan 01 до запроса в базу", async () => {
    let queries = 0;
    const db = {
      query: async () => {
        queries += 1;
        return { rows: [], rowCount: 0 };
      },
    };
    const repo = new PostgresAdminClientRepository(db as unknown as Pool);
    await expect(repo.updateProfile(CLIENT, { birth_date: "Fri Jan 01" })).rejects.toThrow(
      BIRTH_DATE_INVALID_MESSAGE,
    );
    await expect(
      repo.updateProfile(CLIENT, { birth_date: new Date(1993, 0, 1) as unknown as string }),
    ).rejects.toThrow(BIRTH_DATE_INVALID_MESSAGE);
    await expect(
      repo.updateProfile(CLIENT, { birth_date: 33 as unknown as string }),
    ).rejects.toThrow(BIRTH_DATE_INVALID_MESSAGE);
    expect(queries).toBe(0);
  });

  it("не записывает дату, если ключ не передан, и пишет NULL или YYYY-MM-DD без объекта Date", async () => {
    const { repo, calls } = repository();
    await repo.updateProfile(CLIENT, {
      full_name: "Тестовый профиль",
      phone: "+70000000033",
      age_years: 33,
    });
    const kept = calls.find((call) => call.sql.includes("UPDATE public.profiles"));
    expect(kept?.params[5]).toBe(false);
    expect(kept?.params[6]).toBeNull();
    expect(kept?.params[7]).toBe(true);
    expect(kept?.params[8]).toBe(33);
    expect(kept?.sql).not.toMatch(/nutrition_plan|client_courses|program_change_log/i);

    calls.length = 0;
    await repo.updateProfile(CLIENT, { birth_date: null, age_years: 33 });
    const cleared = calls.find((call) => call.sql.includes("UPDATE public.profiles"));
    expect(cleared?.params[5]).toBe(true);
    expect(cleared?.params[6]).toBeNull();

    calls.length = 0;
    await repo.updateProfile(CLIENT, { birth_date: "1993-06-15" });
    const dated = calls.find((call) => call.sql.includes("UPDATE public.profiles"));
    expect(dated?.params[6]).toBe("1993-06-15");
    expect(dated?.params[6]).not.toBeInstanceOf(Date);
    expect(
      calls
        .filter((call) => /^(insert|update|delete)/i.test(call.sql.trim()))
        .every((call) => call.sql.includes("public.profiles")),
    ).toBe(true);
  });
});
