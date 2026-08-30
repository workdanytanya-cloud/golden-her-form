/**
 * In-memory модель иммутабельных версий — эталон для регрессионных тестов
 * и семантика, которую реализует SQL RPC publish_*_version.
 */
import { contentHash } from "@/lib/published-programs/hash";
import { PUBLISHED_IMMUTABLE_ERROR } from "@/lib/published-programs/config";
import { calcMacroTargets } from "@/lib/nutrition-constructor/targets";
import type {
  NutritionRecommendation,
  NutritionSnapshot,
  ProgramVersionStatus,
  RecommendationStatus,
  TrainingSnapshot,
} from "@/lib/published-programs/types";

export type VersionRow<T> = {
  id: string;
  client_id: string;
  version: number;
  status: ProgramVersionStatus;
  snapshot: T;
  content_hash: string;
  parent_version_id: string | null;
  created_at: string;
  created_by: string | null;
  published_at: string | null;
  published_by: string | null;
};

export type AssignmentRow = {
  client_id: string;
  kind: "nutrition" | "training";
  active_version_id: string;
};

export type AuditRow = {
  id: string;
  client_id: string;
  kind: "nutrition" | "training";
  action: string;
  actor_id: string | null;
  from_version_id: string | null;
  to_version_id: string | null;
  measurement_id: string | null;
  diff: Record<string, unknown> | null;
  created_at: string;
};

export type DraftNutrition = {
  client_id: string;
  status: "draft" | "validated";
  snapshot: NutritionSnapshot;
  parent_version_id: string | null;
};

export type DraftTraining = {
  client_id: string;
  status: "draft";
  snapshot: TrainingSnapshot;
  parent_version_id: string | null;
};

export type PublishedStore = {
  nutritionVersions: VersionRow<NutritionSnapshot>[];
  trainingVersions: VersionRow<TrainingSnapshot>[];
  assignments: AssignmentRow[];
  nutritionDrafts: DraftNutrition[];
  trainingDrafts: DraftTraining[];
  recommendations: NutritionRecommendation[];
  audit: AuditRow[];
  /** Симулированная библиотека продуктов (изменяемая). */
  productCatalog: Record<string, { kcal_per_100g: string }>;
  recipeCatalog: Record<string, { name: string }>;
  exerciseCatalog: Record<string, { name: string; description: string | null }>;
};

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

export function createEmptyStore(): PublishedStore {
  return {
    nutritionVersions: [],
    trainingVersions: [],
    assignments: [],
    nutritionDrafts: [],
    trainingDrafts: [],
    recommendations: [],
    audit: [],
    productCatalog: {},
    recipeCatalog: {},
    exerciseCatalog: {},
  };
}

function cloneStore(s: PublishedStore): PublishedStore {
  return structuredClone(s);
}

export function assertCannotMutatePublishedSnapshot(
  version: VersionRow<unknown>,
  nextSnapshot: unknown,
): void {
  if (version.status === "draft") return;
  if (JSON.stringify(version.snapshot) !== JSON.stringify(nextSnapshot)) {
    throw new Error(PUBLISHED_IMMUTABLE_ERROR);
  }
}

export function tryUpdatePublishedNutrition(
  store: PublishedStore,
  versionId: string,
  mutator: (snap: NutritionSnapshot) => NutritionSnapshot,
): PublishedStore {
  const v = store.nutritionVersions.find((x) => x.id === versionId);
  if (!v) throw new Error("version not found");
  if (v.status !== "draft") throw new Error(PUBLISHED_IMMUTABLE_ERROR);
  const next = mutator(structuredClone(v.snapshot));
  assertCannotMutatePublishedSnapshot(v, next);
  return store;
}

export function clientVisibleNutrition(
  store: PublishedStore,
  clientId: string,
): NutritionSnapshot | null {
  const a = store.assignments.find((x) => x.client_id === clientId && x.kind === "nutrition");
  if (!a) return null;
  const v = store.nutritionVersions.find((x) => x.id === a.active_version_id);
  if (!v || v.status !== "published") return null;
  return structuredClone(v.snapshot);
}

export function clientVisibleTraining(
  store: PublishedStore,
  clientId: string,
): TrainingSnapshot | null {
  const a = store.assignments.find((x) => x.client_id === clientId && x.kind === "training");
  if (!a) return null;
  const v = store.trainingVersions.find((x) => x.id === a.active_version_id);
  if (!v || v.status !== "published") return null;
  return structuredClone(v.snapshot);
}

export function clientCanSeeDraft(store: PublishedStore, clientId: string): boolean {
  const draft = store.nutritionDrafts.find((d) => d.client_id === clientId);
  if (!draft) return false;
  const visible = clientVisibleNutrition(store, clientId);
  if (!visible) return false;
  return JSON.stringify(visible) === JSON.stringify(draft.snapshot);
}

export function saveNutritionDraft(
  store: PublishedStore,
  clientId: string,
  snapshot: NutritionSnapshot,
  parentVersionId: string | null = null,
): PublishedStore {
  const next = cloneStore(store);
  const idx = next.nutritionDrafts.findIndex((d) => d.client_id === clientId);
  const row: DraftNutrition = {
    client_id: clientId,
    status: "draft",
    snapshot: structuredClone(snapshot),
    parent_version_id: parentVersionId,
  };
  if (idx >= 0) next.nutritionDrafts[idx] = row;
  else next.nutritionDrafts.push(row);
  return next;
}

export function startNutritionRevisionFromPublished(
  store: PublishedStore,
  clientId: string,
): PublishedStore {
  const current = clientVisibleNutrition(store, clientId);
  if (!current) throw new Error("Нет опубликованной версии");
  const a = store.assignments.find((x) => x.client_id === clientId && x.kind === "nutrition")!;
  return saveNutritionDraft(store, clientId, current, a.active_version_id);
}

export type PublishNutritionParams = {
  clientId: string;
  actorId: string;
  snapshot: NutritionSnapshot;
  failAt?: "validate" | "snapshot" | "supersede" | "publish" | "assign" | "audit";
  measurementId?: string | null;
  reason?: string | null;
};

export function publishNutritionVersion(
  store: PublishedStore,
  params: PublishNutritionParams,
): PublishedStore {
  const rollback = cloneStore(store);
  try {
    const next = cloneStore(store);
    if (params.failAt === "validate") throw new Error("validate failed");

    const hash = contentHash(params.snapshot);
    if (params.failAt === "snapshot") throw new Error("snapshot failed");

    const prevAssign = next.assignments.find(
      (x) => x.client_id === params.clientId && x.kind === "nutrition",
    );
    const prevVersion = prevAssign
      ? next.nutritionVersions.find((v) => v.id === prevAssign.active_version_id)
      : null;
    const versionNum = (prevVersion?.version ?? 0) + 1;

    if (params.failAt === "supersede") throw new Error("supersede failed");
    if (prevVersion && prevVersion.status === "published") {
      prevVersion.status = "superseded";
    }

    const newId = id("nv");
    if (params.failAt === "publish") throw new Error("publish failed");
    const now = new Date().toISOString();
    next.nutritionVersions.push({
      id: newId,
      client_id: params.clientId,
      version: versionNum,
      status: "published",
      snapshot: structuredClone(params.snapshot),
      content_hash: hash,
      parent_version_id: prevVersion?.id ?? null,
      created_at: now,
      created_by: params.actorId,
      published_at: now,
      published_by: params.actorId,
    });

    if (params.failAt === "assign") throw new Error("assign failed");
    if (prevAssign) prevAssign.active_version_id = newId;
    else
      next.assignments.push({
        client_id: params.clientId,
        kind: "nutrition",
        active_version_id: newId,
      });

    if (params.failAt === "audit") throw new Error("audit failed");
    next.audit.push({
      id: id("log"),
      client_id: params.clientId,
      kind: "nutrition",
      action: "publish",
      actor_id: params.actorId,
      from_version_id: prevVersion?.id ?? null,
      to_version_id: newId,
      measurement_id: params.measurementId ?? null,
      diff: {
        reason: params.reason ?? null,
        old_kcal: prevVersion?.snapshot.targets.kcal ?? null,
        new_kcal: params.snapshot.targets.kcal,
      },
      created_at: now,
    });

    // Черновик синхронизируем с опубликованным
    const dIdx = next.nutritionDrafts.findIndex((d) => d.client_id === params.clientId);
    const synced: DraftNutrition = {
      client_id: params.clientId,
      status: "validated",
      snapshot: structuredClone(params.snapshot),
      parent_version_id: newId,
    };
    if (dIdx >= 0) next.nutritionDrafts[dIdx] = synced;
    else next.nutritionDrafts.push(synced);

    return next;
  } catch {
    return rollback;
  }
}

export function publishTrainingVersion(
  store: PublishedStore,
  params: {
    clientId: string;
    actorId: string;
    snapshot: TrainingSnapshot;
    failAt?: "publish" | "assign";
  },
): PublishedStore {
  const rollback = cloneStore(store);
  try {
    const next = cloneStore(store);
    const hash = contentHash(params.snapshot);
    const prevAssign = next.assignments.find(
      (x) => x.client_id === params.clientId && x.kind === "training",
    );
    const prevVersion = prevAssign
      ? next.trainingVersions.find((v) => v.id === prevAssign.active_version_id)
      : null;
    if (prevVersion && prevVersion.status === "published") prevVersion.status = "superseded";
    if (params.failAt === "publish") throw new Error("publish failed");
    const newId = id("tv");
    const now = new Date().toISOString();
    next.trainingVersions.push({
      id: newId,
      client_id: params.clientId,
      version: (prevVersion?.version ?? 0) + 1,
      status: "published",
      snapshot: structuredClone(params.snapshot),
      content_hash: hash,
      parent_version_id: prevVersion?.id ?? null,
      created_at: now,
      created_by: params.actorId,
      published_at: now,
      published_by: params.actorId,
    });
    if (params.failAt === "assign") throw new Error("assign failed");
    if (prevAssign) prevAssign.active_version_id = newId;
    else
      next.assignments.push({
        client_id: params.clientId,
        kind: "training",
        active_version_id: newId,
      });
    next.audit.push({
      id: id("log"),
      client_id: params.clientId,
      kind: "training",
      action: "publish",
      actor_id: params.actorId,
      from_version_id: prevVersion?.id ?? null,
      to_version_id: newId,
      measurement_id: null,
      diff: null,
      created_at: now,
    });
    return next;
  } catch {
    return rollback;
  }
}

export function applyProductCatalogChange(
  store: PublishedStore,
  productId: string,
  kcal: string,
): PublishedStore {
  const next = cloneStore(store);
  next.productCatalog[productId] = { kcal_per_100g: kcal };
  return next;
}

export function applyRecipeCatalogChange(
  store: PublishedStore,
  recipeId: string,
  name: string,
): PublishedStore {
  const next = cloneStore(store);
  next.recipeCatalog[recipeId] = { name };
  return next;
}

export function applyExerciseCatalogChange(
  store: PublishedStore,
  exerciseId: string,
  name: string,
): PublishedStore {
  const next = cloneStore(store);
  next.exerciseCatalog[exerciseId] = {
    name,
    description: next.exerciseCatalog[exerciseId]?.description ?? null,
  };
  return next;
}

/** Симуляция seed: меняет только каталог, не assignments. */
export function reseedCatalog(
  store: PublishedStore,
  products: Record<string, { kcal_per_100g: string }>,
): PublishedStore {
  const next = cloneStore(store);
  next.productCatalog = { ...next.productCatalog, ...products };
  return next;
}

export function onMeasurementSaved(
  store: PublishedStore,
  params: {
    clientId: string;
    measurementId: string;
    newWeightKg: number;
    gender?: "female" | "male" | null;
    birth_date?: string | null;
    height_cm?: number | null;
    activity_level?: string | null;
    goal_primary?: string | null;
  },
): PublishedStore {
  const next = cloneStore(store);
  const visible = clientVisibleNutrition(next, params.clientId);
  const assigned = visible?.targets ?? {
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
  };
  const calc = calcMacroTargets({
    gender: params.gender,
    birth_date: params.birth_date,
    height_cm: params.height_cm,
    weight_kg: params.newWeightKg,
    activity_level: params.activity_level,
    goal_primary: params.goal_primary,
  });

  // Пометить предыдущие pending как replaced
  for (const r of next.recommendations) {
    if (r.client_id === params.clientId && r.status === "pending_trainer_review") {
      r.status = "replaced";
    }
  }

  const a = next.assignments.find((x) => x.client_id === params.clientId && x.kind === "nutrition");
  next.recommendations.push({
    id: id("rec"),
    client_id: params.clientId,
    measurement_id: params.measurementId,
    based_on_version_id: a?.active_version_id ?? null,
    status: "pending_trainer_review",
    assigned_kcal: assigned.kcal,
    assigned_protein_g: assigned.protein_g,
    assigned_fat_g: assigned.fat_g,
    assigned_carbs_g: assigned.carbs_g,
    recommended_kcal: Math.round(calc.targets.kcal.toNumber()),
    recommended_protein_g: Math.round(calc.targets.protein_g.toNumber() * 10) / 10,
    recommended_fat_g: Math.round(calc.targets.fat_g.toNumber() * 10) / 10,
    recommended_carbs_g: Math.round(calc.targets.carbs_g.toNumber() * 10) / 10,
    assigned_weight_kg: null,
    new_weight_kg: params.newWeightKg,
    bmr: Math.round(calc.bmr.toNumber()),
    tdee: Math.round(calc.tdee.toNumber()),
    reason: "Новые замеры клиента",
  });

  // Меню и тренировки не трогаем
  return next;
}

export function acceptRecommendationAndCreateDraft(
  store: PublishedStore,
  params: {
    clientId: string;
    recommendationId: string;
    buildDraft: (assigned: NutritionSnapshot, rec: NutritionRecommendation) => NutritionSnapshot;
  },
): PublishedStore {
  const next = cloneStore(store);
  const rec = next.recommendations.find((r) => r.id === params.recommendationId);
  if (!rec) throw new Error("recommendation not found");
  const assigned = clientVisibleNutrition(next, params.clientId);
  if (!assigned) throw new Error("no published nutrition");
  const draftSnap = params.buildDraft(structuredClone(assigned), rec);
  rec.status = "accepted";
  return saveNutritionDraft(next, params.clientId, draftSnap, rec.based_on_version_id);
}

export function setRecommendationStatus(
  store: PublishedStore,
  recommendationId: string,
  status: RecommendationStatus,
): PublishedStore {
  const next = cloneStore(store);
  const rec = next.recommendations.find((r) => r.id === recommendationId);
  if (rec) rec.status = status;
  return next;
}

export function nutritionHistory(
  store: PublishedStore,
  clientId: string,
): VersionRow<NutritionSnapshot>[] {
  return store.nutritionVersions
    .filter((v) => v.client_id === clientId && v.status !== "draft")
    .sort((a, b) => b.version - a.version);
}
