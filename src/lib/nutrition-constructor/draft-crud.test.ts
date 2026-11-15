import { describe, expect, it } from "vitest";
import { checkNutritionDraft } from "@/lib/nutrition-constructor/draft-check";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";
import { lastCatalogFix } from "@/lib/nutrition-constructor/recipe-instructions";
import { repairRecipeName, technicalNameReason } from "@/lib/nutrition-constructor/recipe-names";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";

describe("draft names and structure", () => {
  it("repairs portion-size titles and rejects the remaining technical wording", () => {
    expect(repairRecipeName("Курица с небольшой гречкой")).toBe(
      "Куриная грудка с гречкой и свежими овощами",
    );
    for (const name of [
      "Курица с малым количеством риса",
      "Немного творога с фруктом",
      "Лёгкая порция творога",
      "Большая порция риса",
      "Остаток гречки",
      "Добор белка",
      "Вариант № 2",
    ]) {
      expect(technicalNameReason(name), name).toBeTruthy();
    }
    expect(technicalNameReason("Куриная грудка с гречкой и свежими овощами")).toBeNull();
  });

  it("canonicalizes the in-memory catalog and flags an empty required slot", () => {
    const catalog = buildInMemoryCatalog();
    const bad = catalog.recipes.filter((recipe) => technicalNameReason(recipe.name));
    expect(bad.map((recipe) => recipe.name)).toEqual([]);
    expect(lastCatalogFix.names).toBe(0);
    expect(lastCatalogFix.instructions).toBeGreaterThan(0);
    const day: ConstructorDay = {
      day_index: 0,
      day_note: null,
      items: [],
      kcal: "0",
      protein_g: "0",
      fat_g: "0",
      carbs_g: "0",
      fiber_g: "0",
      is_valid: false,
    };
    const issues = checkNutritionDraft({
      days: [day],
      targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 160 },
      mode: "three_mains_only",
      products: catalog.products,
      expectedDays: 1,
    });
    expect(issues.some((issue) => issue.message.includes("приём не заполнен"))).toBe(true);
  });
});
