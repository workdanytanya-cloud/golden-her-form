import { describe, expect, it } from "vitest";
import { ONE_MAIN_TOLERANCE } from "@/lib/nutrition-constructor/config";
import {
  buildPlanValidationMessage,
  formatMacroDeviationPhrase,
  formatMacroDeviationSummary,
} from "@/lib/nutrition-constructor/validation-messages";

describe("validation-messages", () => {
  it("formats protein deficit", () => {
    expect(formatMacroDeviationPhrase({ label: "Белки", target: 120, actual: 112, diff: -8 })).toBe(
      "−8 г белка",
    );
  });

  it("summarizes out-of-tolerance macros", () => {
    const summary = formatMacroDeviationSummary(
      [
        { label: "Калории", target: 1800, actual: 1830, diff: 30 },
        { label: "Белки", target: 120, actual: 105, diff: -15 },
        { label: "Жиры", target: 60, actual: 61, diff: 1 },
        { label: "Углеводы", target: 180, actual: 175, diff: -5 },
      ],
      ONE_MAIN_TOLERANCE,
    );
    expect(summary).toContain("−15 г белка");
    expect(summary).toContain("+30 ккал");
    expect(summary).not.toContain("жиров");
  });

  it("builds human-readable plan message", () => {
    const msg = buildPlanValidationMessage({
      comparison: [{ label: "Белки", target: 120, actual: 105, diff: -15 }],
      tolerance: ONE_MAIN_TOLERANCE,
      hasDays: true,
      failMessage: "fail",
    });
    expect(msg).toContain("−15 г белка");
    expect(msg).toContain("среднее за период");
  });
});
