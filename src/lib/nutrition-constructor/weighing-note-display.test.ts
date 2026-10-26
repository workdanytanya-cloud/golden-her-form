import { describe, expect, it } from "vitest";
import {
  displayProductName,
  displayWeighingNote,
  WEIGHING_NOTE_DISPLAY,
} from "@/lib/nutrition-constructor/weighing-note-display";

describe("displayWeighingNote", () => {
  it("rewrites eggs legacy note for display", () => {
    expect(
      displayWeighingNote({
        product_id: "egg-whole",
        product_name: "Яйца",
        weighing_note: "Съедобная часть (~50 г на 1 яйцо С1).",
      }),
    ).toBe(WEIGHING_NOTE_DISPLAY.eggWhole);
  });

  it("rewrites pasteurized egg white legacy note for display", () => {
    expect(
      displayWeighingNote({
        product_id: "egg-white-raw",
        product_name: "Готовый пастеризованный яичный белок",
        weighing_note: "Взвешивать сырым, без скорлупы.",
      }),
    ).toBe(WEIGHING_NOTE_DISPLAY.pasteurizedEggWhite);
  });

  it("leaves other products unchanged", () => {
    expect(
      displayWeighingNote({
        product_id: "rice-dry",
        product_name: "Рис",
        weighing_note: "Взвешивать сухой крупой.",
      }),
    ).toBe("Взвешивать сухой крупой.");
  });

  it("shows client-friendly egg product names", () => {
    expect(
      displayProductName({
        product_id: "egg-whole",
        product_name: "Яйца",
        weighing_note: "Съедобная часть (~50 г на 1 яйцо С1).",
      }),
    ).toBe(WEIGHING_NOTE_DISPLAY.eggWholeName);
    expect(
      displayProductName({
        product_id: "egg-white-raw",
        product_name: "Готовый пастеризованный яичный белок",
      }),
    ).toBe(WEIGHING_NOTE_DISPLAY.eggWhiteName);
  });

  it("returns null when there is no note and no override", () => {
    expect(
      displayWeighingNote({
        product_id: "chicken-breast",
        product_name: "Куриная грудка",
        weighing_note: null,
      }),
    ).toBeNull();
  });
});
