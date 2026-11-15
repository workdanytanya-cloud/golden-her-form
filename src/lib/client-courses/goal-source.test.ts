import { describe, expect, it } from "vitest";
import { directionFromGoalText, resolveClientGoal } from "./goal-source";

describe("client goal source", () => {
  it("reads a free-text weight goal that the card already shows", () => {
    const resolved = resolveClientGoal({ profileGoal: "Минус 10 кг к январю 2027" });
    expect(resolved.fallback).toBe(false);
    expect(resolved.direction).toBe("weight_loss");
    expect(resolved.text).toBe("Минус 10 кг к январю 2027");
  });

  it("uses a legacy field when the profile goal is empty", () => {
    expect(
      resolveClientGoal({ profileGoal: "  ", goalDetails: "хочу выносливость" }).direction,
    ).toBe("endurance");
    expect(directionFromGoalText("muscle_gain")).toBe("strength");
  });

  it("falls back to general fitness when no goal is stored", () => {
    const resolved = resolveClientGoal({});
    expect(resolved.fallback).toBe(true);
    expect(resolved.direction).toBe("general_fitness");
    expect(resolved.text).toBeNull();
  });
});
