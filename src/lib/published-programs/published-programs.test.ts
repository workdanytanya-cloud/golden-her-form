import { describe, expect, it } from "vitest";
import {
  AUTO_REGENERATE_ON_DEPLOY,
  PUBLISHED_IMMUTABLE_ERROR,
  SEED_TOUCHES_CLIENT_ASSIGNMENTS,
} from "@/lib/published-programs/config";
import { assertUnchangedHash, contentHash } from "@/lib/published-programs/hash";
import {
  buildConstructorNutritionSnapshot,
  scaleConstructorDaysToKcal,
} from "@/lib/published-programs/nutrition-snapshot";
import { buildTrainingSnapshot } from "@/lib/published-programs/training-snapshot";
import {
  acceptRecommendationAndCreateDraft,
  applyExerciseCatalogChange,
  applyProductCatalogChange,
  applyRecipeCatalogChange,
  clientVisibleNutrition,
  clientVisibleTraining,
  createEmptyStore,
  nutritionHistory,
  onMeasurementSaved,
  publishNutritionVersion,
  publishTrainingVersion,
  reseedCatalog,
  saveNutritionDraft,
  startNutritionRevisionFromPublished,
  tryUpdatePublishedNutrition,
} from "@/lib/published-programs/store";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import type { Exercise, ProgramDay } from "@/lib/training";
import type { NutritionSnapshot, TrainingSnapshot } from "@/lib/published-programs/types";

function sampleDay(kcal = 1800): ConstructorDay {
  return {
    day_index: 0,
    day_note: null,
    is_valid: true,
    kcal: String(kcal),
    protein_g: "120",
    fat_g: "60",
    carbs_g: "180",
    fiber_g: "20",
    items: [
      {
        slot: "main1",
        recipe_id: "r1",
        recipe_name: "Курица с рисом",
        requires_cooking: true,
        prep_time_min: 25,
        steps: ["Варить"],
        weighing_note: "Сухой рис",
        snack_action: null,
        is_valid: true,
        kcal: String(kcal),
        protein_g: "120",
        fat_g: "60",
        carbs_g: "180",
        fiber_g: "20",
        ingredients: [
          {
            product_id: "cheese",
            product_name: "Сыр",
            grams: "50",
            weighing_note: "Как есть",
            kcal_per_100g: "350",
            protein_per_100g: "25",
            fat_per_100g: "27",
            carbs_per_100g: "0",
            fiber_per_100g: "0",
            kcal: "175",
            protein_g: "12.5",
            fat_g: "13.5",
            carbs_g: "0",
            fiber_g: "0",
            sort_order: 0,
          },
        ],
      },
    ],
  };
}

function sampleNutrition(kcal = 1800): NutritionSnapshot {
  return buildConstructorNutritionSnapshot({
    days: [sampleDay(kcal)],
    targets: { kcal, protein_g: 120, fat_g: 60, carbs_g: 180 },
    meal_schedule_mode: "two_main_two_snacks",
    primary_meal_slot: "lunch",
    bmr: 1400,
    tdee: 1900,
  });
}

function sampleExercise(id = "ex1"): Exercise {
  return {
    id,
    slug: id,
    name: "Приседания",
    category: "strength_lower",
    muscle_groups: ["quads"],
    equipment: ["bodyweight"],
    difficulty: "beginner",
    tags: [],
    description: "Техника А",
    cues: ["Колени"],
    common_mistakes: [],
    gif_url: null,
    video_url: null,
    default_sets: 3,
    default_reps: "12",
    tempo: "2-0-2",
    rest_seconds: 60,
  };
}

function sampleTraining(exName = "Приседания"): TrainingSnapshot {
  const ex = sampleExercise();
  ex.name = exName;
  const day: ProgramDay = {
    week_index: 0,
    day_index: 0,
    is_rest: false,
    title: "День 1",
    focus: "ноги",
    description: null,
    warmup: [],
    exercises: [{ exercise_id: ex.id, sets: 3, reps: "12", rest_seconds: 60 }],
    cooldown: [],
    day_note: null,
  };
  return buildTrainingSnapshot({
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

describe("immutable published programs", () => {
  it("1. изменение продукта не меняет опубликованное меню", () => {
    let store = createEmptyStore();
    const snap = sampleNutrition();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: snap,
    });
    const before = clientVisibleNutrition(store, "c1")!;
    store = applyProductCatalogChange(store, "cheese", "999");
    const after = clientVisibleNutrition(store, "c1")!;
    expect(after.constructor_days[0]!.items[0]!.ingredients[0]!.kcal_per_100g).toBe("350");
    expect(after).toEqual(before);
  });

  it("2. изменение рецепта не меняет опубликованное меню", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    const before = clientVisibleNutrition(store, "c1")!;
    store = applyRecipeCatalogChange(store, "r1", "Новое имя");
    expect(clientVisibleNutrition(store, "c1")!.constructor_days[0]!.items[0]!.recipe_name).toBe(
      "Курица с рисом",
    );
    expect(clientVisibleNutrition(store, "c1")).toEqual(before);
  });

  it("3. изменение упражнения не меняет опубликованную тренировку", () => {
    let store = createEmptyStore();
    store = publishTrainingVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleTraining("Приседания"),
    });
    store = applyExerciseCatalogChange(store, "ex1", "Выпады");
    expect(clientVisibleTraining(store, "c1")!.days[0]!.exercises[0]!.exercise!.name).toBe(
      "Приседания",
    );
  });

  it("4. повторный seed не меняет программы клиентов", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    const hash = store.nutritionVersions[0]!.content_hash;
    store = reseedCatalog(store, { cheese: { kcal_per_100g: "1" } });
    expect(SEED_TOUCHES_CLIENT_ASSIGNMENTS).toBe(false);
    expect(store.nutritionVersions[0]!.content_hash).toBe(hash);
    expect(store.assignments).toHaveLength(1);
  });

  it("5. новый деплой не запускает автоматическую перегенерацию", () => {
    expect(AUTO_REGENERATE_ON_DEPLOY).toBe(false);
  });

  it("6. обновление веса создаёт рекомендацию, но не меняет меню", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    const menuBefore = clientVisibleNutrition(store, "c1");
    store = onMeasurementSaved(store, {
      clientId: "c1",
      measurementId: "m1",
      newWeightKg: 70,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "medium",
      goal_primary: "maintain",
    });
    expect(store.recommendations).toHaveLength(1);
    expect(store.recommendations[0]!.status).toBe("pending_trainer_review");
    expect(clientVisibleNutrition(store, "c1")).toEqual(menuBefore);
  });

  it("7. обновление замеров не меняет тренировку", () => {
    let store = createEmptyStore();
    store = publishTrainingVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleTraining(),
    });
    const before = clientVisibleTraining(store, "c1");
    store = onMeasurementSaved(store, {
      clientId: "c1",
      measurementId: "m1",
      newWeightKg: 72,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
    });
    expect(clientVisibleTraining(store, "c1")).toEqual(before);
  });

  it("8. клиент не может изменить опубликованную программу", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    const vid = store.nutritionVersions[0]!.id;
    expect(() =>
      tryUpdatePublishedNutrition(store, vid, (s) => ({
        ...s,
        targets: { ...s.targets, kcal: 9999 },
      })),
    ).toThrow(PUBLISHED_IMMUTABLE_ERROR);
  });

  it("9. клиент не может увидеть черновик", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = saveNutritionDraft(
      store,
      "c1",
      sampleNutrition(2200),
      store.assignments[0]!.active_version_id,
    );
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(1800);
    expect(store.nutritionDrafts[0]!.snapshot.targets.kcal).toBe(2200);
  });

  it("10. тренер не может напрямую изменить опубликованную версию", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    expect(() =>
      tryUpdatePublishedNutrition(store, store.nutritionVersions[0]!.id, (s) => ({
        ...s,
        notes: "hack",
      })),
    ).toThrow(PUBLISHED_IMMUTABLE_ERROR);
  });

  it("11. редактирование создаёт новую версию draft", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    store = startNutritionRevisionFromPublished(store, "c1");
    expect(store.nutritionDrafts[0]!.status).toBe("draft");
    expect(store.nutritionDrafts[0]!.parent_version_id).toBe(
      store.assignments[0]!.active_version_id,
    );
  });

  it("12. до публикации клиент видит старую версию", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = saveNutritionDraft(store, "c1", sampleNutrition(2000));
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(1800);
  });

  it("13. после публикации клиент видит новую версию", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(2000),
    });
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(2000);
  });

  it("14. предыдущая версия сохраняется в истории", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(2000),
    });
    const hist = nutritionHistory(store, "c1");
    expect(hist).toHaveLength(2);
    expect(hist.find((v) => v.status === "superseded")!.snapshot.targets.kcal).toBe(1800);
    expect(hist.find((v) => v.status === "published")!.snapshot.targets.kcal).toBe(2000);
  });

  it("15. ошибка публикации не оставляет клиента без активной программы", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    const afterFail = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(2000),
      failAt: "assign",
    });
    expect(clientVisibleNutrition(afterFail, "c1")!.targets.kcal).toBe(1800);
    expect(afterFail.nutritionVersions.filter((v) => v.status === "published")).toHaveLength(1);
  });

  it("16. изменение KBJU продукта не меняет сохранённый snapshot", () => {
    const snap = sampleNutrition();
    const hash = contentHash(snap);
    snap.constructor_days[0]!.items[0]!.ingredients[0]!.kcal_per_100g = "350";
    // mutate catalog separately — snapshot object already frozen in publish
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(),
    });
    const published = store.nutritionVersions[0]!;
    store = applyProductCatalogChange(store, "cheese", "10");
    expect(assertUnchangedHash(published.snapshot, published.content_hash)).toBe(true);
    expect(contentHash(published.snapshot)).toBe(hash);
  });

  it("17. новая калорийность рассчитывается по последнему весу", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = onMeasurementSaved(store, {
      clientId: "c1",
      measurementId: "m1",
      newWeightKg: 60,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "medium",
      goal_primary: "maintain",
    });
    store = onMeasurementSaved(store, {
      clientId: "c1",
      measurementId: "m2",
      newWeightKg: 80,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
      activity_level: "medium",
      goal_primary: "maintain",
    });
    const pending = store.recommendations.filter((r) => r.status === "pending_trainer_review");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.new_weight_kg).toBe(80);
    expect(pending[0]!.recommended_kcal).toBeGreaterThan(0);
  });

  it("18. новая калорийность применяется только после подтверждения тренера", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = onMeasurementSaved(store, {
      clientId: "c1",
      measurementId: "m1",
      newWeightKg: 70,
      gender: "female",
      height_cm: 165,
      birth_date: "1990-01-01",
    });
    const rec = store.recommendations[0]!;
    store = acceptRecommendationAndCreateDraft(store, {
      clientId: "c1",
      recommendationId: rec.id!,
      buildDraft: (assigned, r) => {
        const days = scaleConstructorDaysToKcal(
          assigned.constructor_days.map((d) => ({
            ...d,
            items: d.items.map((i) => ({
              ...i,
              is_valid: true,
              ingredients: i.ingredients,
            })),
            is_valid: true,
          })) as ConstructorDay[],
          assigned.targets.kcal,
          r.recommended_kcal,
        );
        return buildConstructorNutritionSnapshot({
          days,
          targets: {
            kcal: r.recommended_kcal,
            protein_g: r.recommended_protein_g,
            fat_g: r.recommended_fat_g,
            carbs_g: r.recommended_carbs_g,
          },
          meal_schedule_mode: assigned.meal_schedule_mode,
          primary_meal_slot: assigned.primary_meal_slot,
        });
      },
    });
    // До publish клиент на старых калориях
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(1800);
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: store.nutritionDrafts[0]!.snapshot,
    });
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(rec.recommended_kcal);
  });

  it("19. программы одного клиента не влияют на программы другого", () => {
    let store = createEmptyStore();
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1800),
    });
    store = publishNutritionVersion(store, {
      clientId: "c2",
      actorId: "t1",
      snapshot: sampleNutrition(2100),
    });
    store = publishNutritionVersion(store, {
      clientId: "c1",
      actorId: "t1",
      snapshot: sampleNutrition(1900),
    });
    expect(clientVisibleNutrition(store, "c1")!.targets.kcal).toBe(1900);
    expect(clientVisibleNutrition(store, "c2")!.targets.kcal).toBe(2100);
  });

  it("20. проверяется неизменность content_hash опубликованной версии", () => {
    let store = createEmptyStore();
    const snap = sampleNutrition();
    store = publishNutritionVersion(store, { clientId: "c1", actorId: "t1", snapshot: snap });
    const v = store.nutritionVersions[0]!;
    expect(v.content_hash).toBe(contentHash(snap));
    expect(assertUnchangedHash(v.snapshot, v.content_hash)).toBe(true);
    const tampered = structuredClone(v.snapshot);
    tampered.targets.kcal = 1;
    expect(assertUnchangedHash(tampered, v.content_hash)).toBe(false);
  });
});
