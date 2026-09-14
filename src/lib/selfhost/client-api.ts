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
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Ошибка сервера");
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

export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/selfhost/csrf", { credentials: "include" });
  const data = (await res.json()) as { csrf?: string };
  csrfToken = data.csrf ?? "";
  return csrfToken;
}

async function selfhostFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("x-csrf-token", await ensureCsrfToken());
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return fetch(path, { ...init, headers, credentials: "include" });
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
