import { describe, expect, it, vi } from "vitest";
import { loadAdminNutritionState, withLoadingFinally } from "./load-state";
import type { PublishedNutritionView } from "@/lib/published-programs/repo";

const published = Object.freeze({
  version: Object.freeze({ content_hash: "unchanged-hash" }),
  snapshot: Object.freeze({ kind: "legacy", legacy_days: Object.freeze([]) }),
  source: "published",
}) as unknown as PublishedNutritionView;

describe("admin nutrition loading", () => {
  it("shows published nutrition when the constructor draft is absent", async () => {
    const before = JSON.stringify(published);
    const state = await loadAdminNutritionState(
      async () => {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      },
      async () => published,
    );

    expect(state.view).toBe("published");
    expect(state.published).toBe(published);
    expect(JSON.stringify(published)).toBe(before);
    expect(state.published?.version?.content_hash).toBe("unchanged-hash");
  });

  it("prefers an existing draft", async () => {
    const draft = { plan: { id: "draft" }, days: [] } as never;
    const state = await loadAdminNutritionState(
      async () => draft,
      async () => published,
    );
    expect(state.view).toBe("draft");
    expect(state.draft).toBe(draft);
  });

  it("returns an explicit empty state when neither version exists", async () => {
    const state = await loadAdminNutritionState(
      async () => ({ plan: null, days: [] }),
      async () => null,
    );
    expect(state.view).toBe("empty");
  });

  it("does not hide genuine server errors", async () => {
    await expect(
      loadAdminNutritionState(
        async () => {
          throw Object.assign(new Error("server failed"), { statusCode: 500 });
        },
        async () => null,
      ),
    ).rejects.toThrow("server failed");
  });

  it.each([
    ["success", async () => "ok"],
    ["failure", async () => Promise.reject(new Error("failed"))],
  ])("always finishes loading after %s", async (_label, task) => {
    const setLoading = vi.fn();
    await withLoadingFinally(setLoading, task).catch(() => undefined);
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
  });
});
