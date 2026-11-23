import { describe, expect, it } from "vitest";
import { missingCompletedBody } from "@/lib/selfhost/postgres-onboarding";
import { calcBmr, checkAutoGenerationSafety } from "@/lib/nutrition-constructor/targets";
import {
  AGE_FILL_HINT,
  ageFromBirthDate,
  resolveClientAge,
} from "@/lib/client-age";
import { missingProgramFields, missingProgramMessage } from "@/lib/client-courses/program-readiness";

const ready = {
  goal: "weight_loss",
  heightCm: 168,
  weightKg: 62,
  gender: "female",
  birthDate: null as string | null,
  ageYears: null as number | null,
  activityLevel: "moderate",
  trainingDays: 3,
};

describe("client age", () => {
  it("берёт полные годы из профиля и не вычисляет дату рождения", () => {
    const now = Date.parse("2026-11-19T00:00:00Z");
    expect(ageFromBirthDate("1973-01-01", now)).toBe(53);
    expect(resolveClientAge({ birthDate: "1973-01-01", ageYears: 30, now })).toBe(30);
    expect(resolveClientAge({ birthDate: null, ageYears: 53, now })).toBe(53);
    expect(resolveClientAge({ birthDate: "не дата", ageYears: 53, now })).toBe(53);
    expect(resolveClientAge({ birthDate: "2099-01-01", ageYears: 53, now })).toBe(53);
    expect(resolveClientAge({ birthDate: "1973-01-01", ageYears: null, now })).toBe(53);
    expect(resolveClientAge({ birthDate: null, ageYears: null, now })).toBeNull();
    expect(resolveClientAge({ birthDate: null, ageYears: 5, now })).toBeNull();
  });

  it("проверка готовности и расчёт видят один и тот же возраст", () => {
    expect(missingProgramFields({ ...ready, ageYears: 53 }, "both")).toEqual([]);
    expect(missingProgramFields(ready, "nutrition")).toEqual([AGE_FILL_HINT]);
    expect(missingProgramMessage(missingProgramFields(ready, "both"))).toContain(
      "Возраст, полных лет",
    );
    expect(missingProgramFields({ ...ready, birthDate: "1973-01-01" }, "nutrition")).toEqual([]);

    const fromYears = calcBmr({
      gender: "female",
      height_cm: 165,
      weight_kg: 60,
      age_years: 53,
    });
    const withLegacyBirth = calcBmr({
      gender: "female",
      height_cm: 165,
      weight_kg: 60,
      birth_date: "1973-01-01",
      age_years: 30,
    });
    const fallback = calcBmr({ gender: "female", height_cm: 165, weight_kg: 60 });
    expect(withLegacyBirth.toNumber()).toBeCloseTo(
      calcBmr({
        gender: "female",
        height_cm: 165,
        weight_kg: 60,
        age_years: 30,
      }).toNumber(),
      0,
    );
    expect(fromYears.toNumber()).toBeLessThan(fallback.toNumber());
    expect(
      checkAutoGenerationSafety({ birth_date: null, age_years: 53, profile_complete: true }).blocked,
    ).toBe(false);
    expect(
      checkAutoGenerationSafety({ birth_date: null, age_years: 17, profile_complete: true }).blocked,
    ).toBe(true);
    expect(
      checkAutoGenerationSafety({
        birth_date: null,
        age_years: 30,
        profile_complete: true,
        pregnancy_status: "na",
      }).blocked,
    ).toBe(false);
    expect(
      checkAutoGenerationSafety({
        birth_date: null,
        age_years: 30,
        profile_complete: true,
        pregnancy_status: "no",
      }).blocked,
    ).toBe(false);
    expect(
      checkAutoGenerationSafety({
        birth_date: null,
        age_years: 30,
        profile_complete: true,
        pregnancy_status: "pregnant",
      }).blocked,
    ).toBe(true);
  });

  it("отправка анкеты требует возраст, пол, рост и вес", () => {
    expect(missingCompletedBody({ age_years: null, gender: "female", height_cm: 165, weight_kg: 60 })).toEqual([
      "возраст, полных лет",
    ]);
    expect(missingCompletedBody({ age_years: 53, gender: null, height_cm: 165, weight_kg: 60 })).toEqual([
      "пол",
    ]);
    expect(missingCompletedBody({ age_years: 53, gender: "female", height_cm: null, weight_kg: 60 })).toEqual([
      "рост, см",
    ]);
    expect(missingCompletedBody({ age_years: 53, gender: "female", height_cm: 165, weight_kg: null })).toEqual([
      "вес, кг",
    ]);
    expect(missingCompletedBody({ age_years: 53, gender: "female", height_cm: 165, weight_kg: 60 })).toEqual([]);
  });
});
