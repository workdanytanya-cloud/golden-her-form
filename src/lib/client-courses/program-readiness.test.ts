import { describe, expect, it } from "vitest";
import {
  decideGenerationStage,
  trainingDraftNeedsRebuild,
  goalLabel,
  missingProgramFields,
  missingProgramMessage,
  resolveProvisionMealSchedule,
} from "./program-readiness";

const complete = {
  goal: "weight_loss",
  heightCm: 168,
  weightKg: 62,
  gender: "female",
  birthDate: null as string | null,
  ageYears: 32,
  activityLevel: "moderate",
  trainingDays: 3,
};

describe("program readiness", () => {
  it("asks for the real missing fields and does not invent a goal", () => {
    expect(goalLabel(null)).toBeNull();
    expect(goalLabel("  ")).toBeNull();
    expect(goalLabel("weight_loss")).toBe("Снижение веса");
    expect(goalLabel("Своя формулировка")).toBe("Своя формулировка");
    expect(missingProgramFields({ ...complete, goal: null, ageYears: null }, "both")).toEqual([
      "возраст: поле «Возраст, полных лет» в первом шаге анкеты или в профиле клиента",
    ]);
    expect(
      missingProgramMessage(missingProgramFields({ ...complete, ageYears: null }, "nutrition")),
    ).toBe(
      "Для программы не хватает: возраст: поле «Возраст, полных лет» в первом шаге анкеты или в профиле клиента",
    );
  });

  it("uses three mains when a five-meal scheme was not chosen and carbs are too low", () => {
    expect(
      resolveProvisionMealSchedule({
        explicit: false,
        storedMode: "three_main_two_snacks",
        carbsG: 107,
      }),
    ).toEqual({ mode: "three_mains_only", adjustedForLowCarb: true });
    expect(
      resolveProvisionMealSchedule({
        explicit: true,
        storedMode: "three_main_two_snacks",
        carbsG: 107,
      }),
    ).toEqual({ mode: "three_main_two_snacks", adjustedForLowCarb: false });
    expect(
      resolveProvisionMealSchedule({
        explicit: false,
        storedMode: "three_main_two_snacks",
        carbsG: 180,
      }),
    ).toEqual({ mode: "three_main_two_snacks", adjustedForLowCarb: false });
  });

  it("checks only the selected scope", () => {
    expect(
      missingProgramFields({ ...complete, ageYears: null, gender: null }, "training"),
    ).toEqual([]);
    expect(missingProgramFields({ ...complete, trainingDays: null }, "nutrition")).toEqual([]);
    expect(missingProgramFields(complete, "both")).toEqual([]);
  });

  it("rebuilds a training draft when direction or level changes", () => {
    const stored = {
      goal: "tone",
      level: "intermediate",
      sessions: 3,
      notes: "Направленность: Общая физическая подготовка.",
    };
    expect(
      trainingDraftNeedsRebuild(stored, {
        goal: "tone",
        level: "intermediate",
        sessions: 3,
        directionLabel: "Общая физическая подготовка",
      }),
    ).toBe(false);
    expect(
      trainingDraftNeedsRebuild(stored, {
        goal: "muscle_gain",
        level: "advanced",
        sessions: 4,
        directionLabel: "Укрепление мышц",
      }),
    ).toBe(true);
    expect(
      trainingDraftNeedsRebuild(null, {
        goal: "tone",
        level: "beginner",
        sessions: 3,
        directionLabel: "Общая физическая подготовка",
      }),
    ).toBe(false);
  });

  it("runs a failed stage again and leaves a ready stage alone", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(
      decideGenerationStage({
        inScope: true,
        status: "failed",
        draftExists: false,
        startedAt: null,
        now,
        staleMs: 90_000,
      }),
    ).toBe("run");
    expect(
      decideGenerationStage({
        inScope: true,
        status: "ready",
        draftExists: true,
        startedAt: now,
        now,
        staleMs: 90_000,
      }),
    ).toBe("skip");
    expect(
      decideGenerationStage({
        inScope: false,
        status: "failed",
        draftExists: false,
        startedAt: null,
        now,
        staleMs: 90_000,
      }),
    ).toBe("skip");
    expect(
      decideGenerationStage({
        inScope: true,
        status: "generating",
        draftExists: false,
        startedAt: now,
        now,
        staleMs: 90_000,
      }),
    ).toBe("skip");
    expect(
      decideGenerationStage({
        inScope: true,
        status: null,
        draftExists: true,
        startedAt: null,
        now,
        staleMs: 90_000,
      }),
    ).toBe("skip");
  });
});
