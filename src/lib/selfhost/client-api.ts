import type { RuntimePublicConfig } from "@/lib/selfhost/config";
import { getAuthBackend, getDataBackend, getMediaBackend } from "@/lib/selfhost/config";
import type { ClientCourse } from "@/lib/client-courses/repo";
import type { PublishedNutritionView, PublishedTrainingView } from "@/lib/published-programs/repo";
import type {
  AdminExerciseReport,
  AdminExerciseRow,
  MediaFilter,
} from "@/lib/selfhost/exercise-admin-types";
import type { ExerciseVideo } from "@/lib/exercise-video";

let cached: RuntimePublicConfig | null = null;
let csrfToken: string | null = null;

export async function loadRuntimeConfig(): Promise<RuntimePublicConfig> {
  if (typeof window === "undefined") {
    return {
      authBackend: getAuthBackend(),
      dataBackend: getDataBackend(),
      mediaBackend: getMediaBackend(),
    };
  }
  if (cached) return cached;
  const res = await fetch("/api/selfhost/runtime");
  if (!res.ok) {
    throw new Error("Не удалось прочитать selfhost runtime; fallback на Supabase запрещён");
  }
  cached = (await res.json()) as RuntimePublicConfig;
  return cached;
}

export function peekRuntimeConfig(): RuntimePublicConfig | null {
  return cached;
}

export async function usesLocalPostgresCircuit(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  return cfg.authBackend === "local" && cfg.dataBackend === "postgres";
}

export async function usesLocalLinksMedia(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  return (
    cfg.authBackend === "local" &&
    cfg.dataBackend === "postgres" &&
    cfg.mediaBackend === "local-links"
  );
}

async function readSelfhostJson(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : "Ошибка сервера";
    // 401: сессия отсутствует/истекла (часто после смены пользователя в той же вкладке).
    // 403 CSRF: in-memory токен рассинхронизирован с cookie — сбрасываем кэш.
    if (res.status === 401 || (res.status === 403 && /csrf/i.test(message))) {
      csrfToken = null;
    }
    const err = new Error(
      res.status === 401 ? `${message}. Войдите снова в кабинет.` : message,
    ) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

export async function selfhostAdminExercises(
  input: {
    q?: string;
    category?: string;
    media?: MediaFilter;
  } = {},
): Promise<{ items: AdminExerciseRow[]; report: AdminExerciseReport }> {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.category) params.set("category", input.category);
  if (input.media) params.set("media", input.media);
  const qs = params.toString();
  const res = await fetch(`/api/selfhost/admin/exercises${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  return (await readSelfhostJson(res)) as {
    items: AdminExerciseRow[];
    report: AdminExerciseReport;
  };
}

export async function selfhostAdminUpsertExercise(payload: Record<string, unknown>): Promise<{
  id: string;
  video: ExerciseVideo;
}> {
  const res = await selfhostFetch("/api/selfhost/admin/exercises", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (await readSelfhostJson(res)) as { id: string; video: ExerciseVideo };
}

export async function selfhostAdminRemoveExercise(id: string): Promise<void> {
  const res = await selfhostFetch(`/api/selfhost/admin/exercises?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: "{}",
  });
  await readSelfhostJson(res);
}

export async function selfhostAdminSaveExerciseMedia(payload: Record<string, unknown>): Promise<{
  id: string;
  video: ExerciseVideo;
}> {
  const res = await selfhostFetch("/api/selfhost/admin/exercises/media", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (await readSelfhostJson(res)) as { id: string; video: ExerciseVideo };
}

export async function selfhostAdminDeleteExerciseMedia(exerciseId: string): Promise<void> {
  const res = await selfhostFetch(
    `/api/selfhost/admin/exercises/media?id=${encodeURIComponent(exerciseId)}`,
    { method: "DELETE", body: "{}" },
  );
  await readSelfhostJson(res);
}

export async function selfhostAdminRestoreExercise(id: string): Promise<void> {
  const res = await selfhostFetch("/api/selfhost/admin/exercises/restore", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  await readSelfhostJson(res);
}

export async function selfhostAdminClients(q = "") {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await fetch(`/api/selfhost/admin/clients${params}`, { credentials: "include" });
  return readSelfhostJson(res) as Promise<{
    items: Array<Record<string, unknown>>;
    queryCount: number;
  }>;
}

export async function selfhostAdminClient(id: string) {
  const res = await fetch(`/api/selfhost/admin/clients/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  return readSelfhostJson(res) as Promise<{ client: Record<string, unknown> }>;
}

export async function selfhostAdminUpdateProfile(id: string, payload: Record<string, unknown>) {
  const res = await selfhostFetch(`/api/selfhost/admin/clients/${encodeURIComponent(id)}/profile`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await readSelfhostJson(res);
}

export async function selfhostAdminSetAccess(id: string, payload: Record<string, unknown>) {
  const res = await selfhostFetch(`/api/selfhost/admin/clients/${encodeURIComponent(id)}/access`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await readSelfhostJson(res);
}

export async function selfhostAdminExportContacts() {
  const res = await fetch("/api/selfhost/admin/clients/export", { credentials: "include" });
  return readSelfhostJson(res) as Promise<{
    rows: Array<{ full_name: string; phone: string; email: string; created_at: string }>;
  }>;
}

export async function selfhostAdminCourses(clientId: string): Promise<ClientCourse[]> {
  const res = await fetch(`/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses`, {
    credentials: "include",
  });
  const data = await readSelfhostJson(res);
  return data.courses as ClientCourse[];
}

export async function selfhostAdminCreateCourse(
  clientId: string,
  payload: Record<string, unknown>,
) {
  const res = await selfhostFetch(
    `/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  const data = await readSelfhostJson(res);
  return data.course as ClientCourse;
}

export async function selfhostAdminActivateCourse(clientId: string, courseId: string) {
  const res = await selfhostFetch(
    `/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses/${encodeURIComponent(courseId)}`,
    { method: "POST", body: JSON.stringify({ op: "activate" }) },
  );
  await readSelfhostJson(res);
}

export async function selfhostAdminArchiveCourse(clientId: string, courseId: string) {
  const res = await selfhostFetch(
    `/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses/${encodeURIComponent(courseId)}`,
    { method: "POST", body: JSON.stringify({ op: "archive" }) },
  );
  await readSelfhostJson(res);
}

export async function selfhostAdminDeleteCourseDraft(clientId: string, courseId: string) {
  const res = await selfhostFetch(
    `/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses/${encodeURIComponent(courseId)}`,
    { method: "DELETE", body: "{}" },
  );
  await readSelfhostJson(res);
}

export async function selfhostAdminUpdateCourse(
  clientId: string,
  courseId: string,
  payload: Record<string, unknown>,
) {
  const res = await selfhostFetch(
    `/api/selfhost/admin/clients/${encodeURIComponent(clientId)}/courses/${encodeURIComponent(courseId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  const data = await readSelfhostJson(res);
  return data.course as ClientCourse;
}

export async function ensureCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch("/api/selfhost/csrf", { credentials: "include" });
  const data = (await res.json()) as { csrf?: string };
  csrfToken = data.csrf ?? "";
  return csrfToken;
}

async function selfhostFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const mutating = Boolean(init.method && init.method !== "GET" && init.method !== "HEAD");
  const alreadyRetried = Boolean((init as RequestInit & { __csrfRetried?: boolean }).__csrfRetried);
  if (mutating) {
    headers.set("x-csrf-token", await ensureCsrfToken(alreadyRetried));
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  // Ровно один повтор при CSRF mismatch. Тело запроса то же — publish не дублируется,
  // если первая попытка не прошла assertCsrf до мутации.
  if (mutating && !alreadyRetried && res.status === 403) {
    const clone = res.clone();
    try {
      const body = (await clone.json()) as { error?: string };
      if (typeof body.error === "string" && /csrf/i.test(body.error)) {
        csrfToken = null;
        return selfhostFetch(path, {
          ...init,
          headers,
          __csrfRetried: true,
        } as RequestInit & { __csrfRetried?: boolean });
      }
    } catch {
      /* оставляем исходный ответ */
    }
  }
  return res;
}

export async function selfhostLogin(email: string, password: string) {
  const res = await selfhostFetch("/api/selfhost/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Неверный email или пароль");
  if (typeof data.csrf === "string") csrfToken = data.csrf;
  return data as { userId: string; role: "admin" | "client"; accessStatus: string | null };
}

export async function selfhostLogout() {
  await selfhostFetch("/api/selfhost/logout", { method: "POST", body: "{}" });
  csrfToken = null;
}

export async function selfhostMe() {
  const res = await fetch("/api/selfhost/me", { credentials: "include" });
  return (await res.json()) as {
    session: {
      userId: string;
      email: string | null;
      role: "admin" | "client";
      accessStatus: string | null;
      unlockSource: string | null;
    } | null;
  };
}

export async function selfhostCourses(clientId: string): Promise<ClientCourse[]> {
  const res = await fetch(`/api/selfhost/courses?clientId=${encodeURIComponent(clientId)}`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить курсы");
  return data.courses as ClientCourse[];
}

export async function selfhostGetCourse(courseId: string): Promise<ClientCourse | null> {
  const res = await fetch(`/api/selfhost/course?id=${encodeURIComponent(courseId)}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  const data = await readSelfhostJson(res);
  return (data.course as ClientCourse) ?? null;
}

export async function selfhostResolveCourse(
  clientId: string,
  courseId?: string | null,
): Promise<string | null> {
  const params = new URLSearchParams({ clientId });
  if (courseId) params.set("courseId", courseId);
  const res = await fetch(`/api/selfhost/resolve-course?${params}`, { credentials: "include" });
  const data = await readSelfhostJson(res);
  return (data.courseId as string | null) ?? null;
}

export async function selfhostNutritionDraft(clientId: string, courseId?: string | null) {
  const params = new URLSearchParams({ clientId });
  if (courseId) params.set("courseId", courseId);
  const res = await fetch(`/api/selfhost/admin/nutrition/draft?${params}`, {
    credentials: "include",
  });
  return readSelfhostJson(res) as Promise<{
    plan: import("@/lib/nutrition-constructor/repo").ConstructorPlanRow | null;
    days: import("@/lib/nutrition-constructor/repo").ConstructorDayRow[];
  }>;
}

export async function selfhostSaveNutritionDraft(payload: Record<string, unknown>) {
  const res = await selfhostFetch("/api/selfhost/admin/nutrition/draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return readSelfhostJson(res) as Promise<{
    plan: import("@/lib/nutrition-constructor/repo").ConstructorPlanRow;
    days: import("@/lib/nutrition-constructor/repo").ConstructorDayRow[];
  }>;
}

export async function selfhostGenerateNutrition(payload: Record<string, unknown>) {
  // 28 дней two_main_two_snacks могут занимать 1–3 мин; контролируемый abort вместо «вечного» зависания.
  const timeoutMs = 300_000;
  const res = await selfhostFetch("/api/selfhost/admin/nutrition/generate", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`Таймаут генерации рациона (${Math.round(timeoutMs / 1000)} с)`);
    }
    if (error instanceof Error && /aborted|timeout/i.test(error.message)) {
      throw new Error(`Таймаут генерации рациона (${Math.round(timeoutMs / 1000)} с)`);
    }
    throw error;
  });
  return readSelfhostJson(res);
}

export async function selfhostPublishNutrition(payload: {
  clientId: string;
  courseId?: string | null;
  reason?: string | null;
  idempotencyKey?: string;
}) {
  const res = await selfhostFetch("/api/selfhost/admin/nutrition/publish", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return readSelfhostJson(res) as Promise<{
    versionId: string;
    contentHash: string;
    idempotent: boolean;
  }>;
}

export async function selfhostDashboardOverview(clientId?: string | null) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const qs = params.toString();
  const res = await fetch(`/api/selfhost/dashboard${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  return readSelfhostJson(res) as Promise<{
    profile: {
      id: string;
      full_name: string | null;
      goal: string | null;
      height_cm: number | null;
    } | null;
    access: { status: string; unlock_source: string | null } | null;
    onboardingDone: boolean;
    measurements: Array<{
      id: string;
      measured_on: string;
      weight_kg: number | null;
      waist_cm: number | null;
    }>;
    accessNotif: { id: string; message: string } | null;
  }>;
}

export async function selfhostMarkNotificationRead(id: string, clientId?: string | null) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  const qs = params.toString();
  const res = await selfhostFetch(`/api/selfhost/notifications/read${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  await readSelfhostJson(res);
}

export async function selfhostUnmatchedExercises() {
  const res = await fetch("/api/selfhost/admin/unmatched-exercises", { credentials: "include" });
  return readSelfhostJson(res) as Promise<{
    items: Array<{
      original_exercise_id: string;
      source_url: string | null;
      title: string | null;
      source: string;
    }>;
  }>;
}

export async function selfhostNutritionCatalog() {
  const res = await fetch("/api/selfhost/admin/nutrition/catalog", { credentials: "include" });
  const data = await readSelfhostJson(res);
  return {
    products: data.products as import("@/lib/nutrition-constructor/types").FoodProduct[],
    recipes: data.recipes as import("@/lib/nutrition-constructor/types").Recipe[],
    recipeIngredients: (data.recipeIngredients ?? {}) as Record<
      string,
      import("@/lib/nutrition-constructor/types").RecipeIngredient[]
    >,
  };
}

export async function selfhostNutritionCatalogProducts() {
  const catalog = await selfhostNutritionCatalog();
  return catalog.products;
}

export async function selfhostNutritionPreference(clientId: string, courseId?: string | null) {
  const params = new URLSearchParams({ clientId });
  if (courseId) params.set("courseId", courseId);
  const res = await fetch(`/api/selfhost/nutrition/preference?${params}`, {
    credentials: "include",
  });
  const data = await readSelfhostJson(res);
  return data.preference as {
    mode: import("@/lib/nutrition-constructor/config").MealScheduleMode;
    primarySlot: import("@/lib/nutrition-constructor/config").PrimaryMealSlot;
  } | null;
}

export async function selfhostSaveNutritionPreference(payload: {
  courseId?: string | null;
  mode: string;
  primarySlot: string;
  publishedMode?: string | null;
}) {
  const res = await selfhostFetch("/api/selfhost/nutrition/preference", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await readSelfhostJson(res);
}

export async function selfhostNutrition(
  clientId: string,
  courseId?: string | null,
): Promise<PublishedNutritionView | null> {
  const params = new URLSearchParams({ clientId });
  if (courseId) params.set("courseId", courseId);
  const res = await fetch(`/api/selfhost/nutrition?${params}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить питание");
  return data.nutrition as PublishedNutritionView | null;
}

export async function selfhostTraining(
  clientId: string,
  courseId?: string | null,
): Promise<PublishedTrainingView | null> {
  const params = new URLSearchParams({ clientId });
  if (courseId) params.set("courseId", courseId);
  const res = await fetch(`/api/selfhost/training?${params}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить тренировки");
  return data.training as PublishedTrainingView | null;
}

export async function selfhostDownloadPdf(input: {
  kind: "nutrition" | "training";
  courseId?: string | null;
  clientId?: string | null;
}) {
  const res = await selfhostFetch("/api/selfhost/pdf", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Не удалось скачать PDF");
  return data as { filename: string; contentType: string; pdfBase64: string };
}

export function resetSelfhostClientCacheForTests() {
  cached = null;
  csrfToken = null;
}
