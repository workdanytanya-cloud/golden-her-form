import type { PublishedNutritionView } from "@/lib/published-programs/repo";
import type { DayRow, PlanRow } from "@/lib/nutrition-repo";

export type NutritionDraftState = { plan: PlanRow | null; days: DayRow[] };

export type AdminNutritionLoadState = {
  draft: NutritionDraftState;
  published: PublishedNutritionView | null;
  view: "draft" | "published" | "empty";
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

export async function loadAdminNutritionState(
  loadDraft: () => Promise<NutritionDraftState>,
  loadPublished: () => Promise<PublishedNutritionView | null>,
): Promise<AdminNutritionLoadState> {
  let draft: NutritionDraftState;
  try {
    draft = await loadDraft();
  } catch (error) {
    if (!isNotFound(error)) throw error;
    draft = { plan: null, days: [] };
  }

  const published = await loadPublished();
  return {
    draft,
    published,
    view: draft.plan ? "draft" : published ? "published" : "empty",
  };
}

export async function withLoadingFinally<T>(
  setLoading: (loading: boolean) => void,
  task: () => Promise<T>,
): Promise<T> {
  setLoading(true);
  try {
    return await task();
  } finally {
    setLoading(false);
  }
}
