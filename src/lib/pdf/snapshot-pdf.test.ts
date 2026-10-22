import { describe, expect, it } from "vitest";
import {
  nutritionPdfLines,
  pdfFileName,
  pdfTextHasForbiddenPii,
  requirePublishedSnapshot,
  resolvePdfClientId,
  trainingPdfLines,
} from "@/lib/pdf/snapshot-content";
import { buildNutritionPdf, buildTrainingPdf, pdfDownloadHeaders } from "@/lib/pdf/render-pdf";
import { buildConstructorNutritionSnapshot } from "@/lib/published-programs/nutrition-snapshot";
import { buildTrainingSnapshot } from "@/lib/published-programs/training-snapshot";
import {
  applyProductCatalogChange,
  clientVisibleNutrition,
  createEmptyStore,
  publishNutritionVersion,
} from "@/lib/published-programs/store";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import type { Exercise, ProgramDay } from "@/lib/training";

const meta = {
  clientName: "Анна Тестова",
  courseTitle: "Курс весна",
  courseStart: "01.03.2026",
  courseEnd: "28.03.2026",
  issuedAt: "2026-03-02",
};

function sampleDay(): ConstructorDay {
  return {
    day_index: 0,
    day_note: "Старт",
    is_valid: true,
    kcal: "1800",
    protein_g: "120",
    fat_g: "60",
    carbs_g: "180",
    fiber_g: "20",
    items: [
      {
        slot: "main1",
        recipe_id: "11111111-1111-4111-8111-111111111111",
        recipe_name: "Курица с рисом",
        requires_cooking: true,
        prep_time_min: 25,
        steps: ["Варить"],
        weighing_note: null,
        snack_action: null,
        is_valid: true,
        kcal: "700",
        protein_g: "50",
        fat_g: "20",
        carbs_g: "70",
        fiber_g: "4",
        ingredients: [
          {
            product_id: "22222222-2222-4222-8222-222222222222",
            product_name: "Куриная грудка",
            grams: "150",
            weighing_note: null,
            kcal_per_100g: "110",
            protein_per_100g: "23",
            fat_per_100g: "2",
            carbs_per_100g: "0",
            fiber_per_100g: "0",
            kcal: "165",
            protein_g: "34.5",
            fat_g: "3",
            carbs_g: "0",
            fiber_g: "0",
            sort_order: 0,
          },
        ],
      },
    ],
  };
}

function nutritionSnap() {
  return buildConstructorNutritionSnapshot({
    days: [sampleDay()],
    targets: { kcal: 1800, protein_g: 120, fat_g: 60, carbs_g: 180 },
    meal_schedule_mode: "three_mains_only",
    primary_meal_slot: "lunch",
    bmr: 1400,
    tdee: 1900,
    notes: "Пить воду",
  });
}

function trainingSnap() {
  const ex: Exercise = {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "squat",
    name: "Приседания",
    category: "strength_lower",
    muscle_groups: ["quads"],
    equipment: ["bodyweight"],
    difficulty: "beginner",
    tags: [],
    description: "Спина прямая",
    cues: ["Колени наружу"],
    common_mistakes: [],
    gif_url: null,
    video_url: "https://youtu.be/dQw4w9WgXcQ",
    video: normalizeExerciseVideo({
      url: "https://youtu.be/dQw4w9WgXcQ",
      title: "Присед",
    }),
    default_sets: 3,
    default_reps: "12",
    tempo: "2-0-2",
    rest_seconds: 60,
  };
  const day: ProgramDay = {
    week_index: 0,
    day_index: 0,
    is_rest: false,
    title: "Ноги",
    focus: "квадрицепс",
    description: null,
    warmup: [],
    exercises: [{ exercise_id: ex.id, sets: 3, reps: "12", rest_seconds: 60, tempo: "2-0-2" }],
    cooldown: [],
    day_note: null,
  };
  return buildTrainingSnapshot({
    name: "Силовая база",
    sessions_per_week: 3,
    goal: "tone",
    level: "beginner",
    has_injuries: false,
    injuries_details: null,
    equipment: ["bodyweight"],
    location: "home",
    notes: null,
    faq: [],
    program_weeks: 4,
    days: [day],
    exercises: [ex],
  });
}

describe("snapshot PDFs", () => {
  it("строит PDF из published snapshot и содержит кириллицу", async () => {
    const snap = nutritionSnap();
    const text = nutritionPdfLines(snap, meta).join("\n");
    expect(text).toContain("Курица с рисом");
    expect(text).toContain("Куриная грудка");
    expect(text).toContain("150 г");
    expect(text).toContain("Анна Тестова");
    const buf = await buildNutritionPdf(snap, meta);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.toString("latin1")).toContain("NotoSans");
  });

  it("черновик не попадает в выборку PDF", () => {
    const draft = {
      source: "legacy_fallback" as const,
      snapshot: nutritionSnap(),
      version: { status: "draft" as const },
    };
    const result = requirePublishedSnapshot(draft);
    expect("ok" in result && result.ok === false && result.status === 404).toBe(true);

    const published = requirePublishedSnapshot({
      source: "published",
      snapshot: nutritionSnap(),
      version: { status: "published" },
    });
    expect("snapshot" in published).toBe(true);
  });

  it("другой клиент получает 403", () => {
    const denied = resolvePdfClientId({
      sessionUserId: "client-a",
      isAdmin: false,
      requestedClientId: "client-b",
    });
    expect(denied).toEqual({
      ok: false,
      status: 403,
      message: "Нельзя скачать программу другого клиента",
    });
    const admin = resolvePdfClientId({
      sessionUserId: "trainer",
      isAdmin: true,
      requestedClientId: "client-b",
    });
    expect(admin).toEqual({ ok: true, clientId: "client-b" });
  });

  it("отсутствующая версия даёт 404", () => {
    const missing = requirePublishedSnapshot(null);
    expect(missing).toMatchObject({ ok: false, status: 404 });
  });

  it("данные PDF не меняются после правки live-каталога", () => {
    let store = createEmptyStore();
    const snap = nutritionSnap();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: snap,
    });
    const before = nutritionPdfLines(clientVisibleNutrition(store, "c1")!, meta).join("\n");
    store = applyProductCatalogChange(store, "22222222-2222-4222-8222-222222222222", "999");
    const after = nutritionPdfLines(clientVisibleNutrition(store, "c1")!, meta).join("\n");
    expect(after).toBe(before);
    expect(after).toContain("Куриная грудка — 150 г");
  });

  it("PDF текст не содержит UUID, email и телефон", async () => {
    const nText = nutritionPdfLines(nutritionSnap(), meta).join("\n");
    const tText = trainingPdfLines(trainingSnap(), meta).join("\n");
    expect(pdfTextHasForbiddenPii(nText)).toBe(false);
    expect(pdfTextHasForbiddenPii(tText)).toBe(false);
    expect(nText).not.toContain("@");
    const buf = await buildTrainingPdf(trainingSnap(), meta);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const headers = pdfDownloadHeaders("training", "2026-03-02");
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["Content-Disposition"]).toContain(
      'filename="panovapro-training-2026-03-02.pdf"',
    );
    expect(headers["Content-Disposition"]).toContain(
      "filename*=UTF-8''panovapro-training-2026-03-02.pdf",
    );
    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(pdfFileName("nutrition", "2026-09-13")).toBe("panovapro-nutrition-2026-09-13.pdf");
  });
});
