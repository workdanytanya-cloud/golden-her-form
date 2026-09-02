import { describe, expect, it } from "vitest";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import { buildInMemoryCatalog } from "@/lib/nutrition-constructor/repo";

describe("butter autogen and allergens", () => {
  const ctx = buildInMemoryCatalog();

  it("excludes butter from autogeneration catalog flag", () => {
    const butter = ctx.products.get("butter");
    expect(butter).toBeDefined();
    expect(butter!.is_active_for_autogeneration).toBe(false);
    const olive = ctx.products.get("olive-oil");
    expect(olive!.is_active_for_autogeneration).not.toBe(false);
  });

  it("forbids butter on milk allergy and lactose intolerance", () => {
    const products = [...ctx.products.values()];
    const milk = buildForbiddenProductIds(products, { allergies: "молочный белок" });
    const lactose = buildForbiddenProductIds(products, { intolerances: "лактоза" });
    expect(milk.forbiddenIds.has("butter")).toBe(true);
    expect(lactose.forbiddenIds.has("butter")).toBe(true);
  });
});
