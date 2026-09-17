import { describe, expect, it } from "vitest";
import { d, finiteMacroNumber } from "@/lib/nutrition-constructor/decimal-math";

describe("decimal macro parsing", () => {
  it("accepts 49.5 / '49.5' / '49,5' and 221.2 / '221,2'", () => {
    expect(d(49.5).toNumber()).toBe(49.5);
    expect(d("49.5").toNumber()).toBe(49.5);
    expect(d("49,5").toNumber()).toBe(49.5);
    expect(d(221.2).toNumber()).toBe(221.2);
    expect(d("221,2").toNumber()).toBe(221.2);
    expect(finiteMacroNumber("49,5")).toBe(49.5);
    expect(finiteMacroNumber("221,2")).toBe(221.2);
  });

  it("kcal identity for screenshot targets", () => {
    const kcal = d(99).mul(4).plus(d(49.5).mul(9)).plus(d(221.2).mul(4));
    expect(kcal.toDecimalPlaces(1).toNumber()).toBeCloseTo(1726.3, 1);
    expect(Math.abs(kcal.toNumber() - 1726)).toBeLessThan(1);
  });

  it("roundTargetsForDb keeps one decimal for macros", async () => {
    const { roundTargetsForDb } = await import("@/lib/nutrition-constructor/decimal-math");
    expect(roundTargetsForDb({ kcal: 1726.4, protein_g: 99, fat_g: 49.5, carbs_g: 221.2 })).toEqual(
      {
        kcal: 1726,
        protein_g: 99,
        fat_g: 49.5,
        carbs_g: 221.2,
      },
    );
  });
});
