import {
  getAuthBackend,
  getDataBackend,
  isLocalClientCircuit,
  publicRuntimeConfig,
} from "@/lib/selfhost/config";
import { checkPostgresHealth, getPostgresPool } from "@/lib/selfhost/db";
import {
  assertCsrf,
  assertLoginRateLimit,
  clearSessionCookieHeader,
  csrfCookieHeader,
  loadSession,
  loginWithPassword,
  readSessionToken,
  revokeSessionByToken,
  sessionCookieHeader,
  type LocalSession,
} from "@/lib/selfhost/local-auth";
import { newCsrfToken as issueCsrf } from "@/lib/selfhost/passwords";
import { resolvePdfClientId } from "@/lib/pdf/snapshot-content";
import { buildNutritionPdf, buildTrainingPdf, pdfDownloadHeaders } from "@/lib/pdf/render-pdf";
import {
  getActivePublishedNutritionPg,
  getActivePublishedTrainingPg,
  getClientAccessPg,
  getPdfAccessMetaPg,
  getProfilePg,
  listClientCoursesPg,
  loadMediaBindings,
  loadSnapshotMediaBindings,
  toPublishedNutritionView,
  toPublishedTrainingView,
  videoOverlayFromBindings,
} from "@/lib/selfhost/postgres-published";
import { mediaExerciseIdsFromBindings } from "@/lib/selfhost/media";

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}

function cookiesFrom(responseHeaders: Headers, setCookies: string[]): void {
  for (const cookie of setCookies) responseHeaders.append("set-cookie", cookie);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requirePostgres(): void {
  if (getDataBackend() !== "postgres") {
    throw Object.assign(new Error("DATA_BACKEND≠postgres"), { statusCode: 503 });
  }
}

async function requireSession(request: Request): Promise<LocalSession> {
  requirePostgres();
  const session = await loadSession(getPostgresPool(), readSessionToken(request));
  if (!session) {
    throw Object.assign(new Error("Нужно войти в кабинет"), { statusCode: 401 });
  }
  return session;
}

function scopedClientId(session: LocalSession, requested?: string | null): string {
  const access = resolvePdfClientId({
    sessionUserId: session.userId,
    isAdmin: session.role === "admin",
    requestedClientId: requested,
  });
  if (!access.ok) {
    throw Object.assign(new Error(access.message), { statusCode: access.status });
  }
  return access.clientId;
}

export async function handleSelfhostRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/selfhost")) return null;

  try {
    if (url.pathname === "/api/selfhost/runtime" && request.method === "GET") {
      return json(publicRuntimeConfig());
    }

    if (url.pathname === "/api/selfhost/health" && request.method === "GET") {
      const authBackend = getAuthBackend();
      const dataBackend = getDataBackend();
      if (dataBackend === "postgres") {
        const postgres = await checkPostgresHealth();
        return json(
          { ok: postgres === "up", authBackend, dataBackend, postgres },
          postgres === "up" ? 200 : 503,
        );
      }
      return json({ ok: true, authBackend, dataBackend, postgres: "skipped" });
    }

    if (url.pathname === "/api/selfhost/csrf" && request.method === "GET") {
      const token = issueCsrf();
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      headers.append("set-cookie", csrfCookieHeader(token));
      return new Response(JSON.stringify({ csrf: token }), { status: 200, headers });
    }

    if (url.pathname === "/api/selfhost/login" && request.method === "POST") {
      if (getAuthBackend() !== "local") {
        return errorJson("Локальная авторизация выключена", 503);
      }
      requirePostgres();
      assertCsrf(request);
      assertLoginRateLimit(request);
      const body = await readJson(request);
      const email = String(body.email ?? "");
      const password = String(body.password ?? "");
      const result = await loginWithPassword(getPostgresPool(), email, password);
      const csrf = issueCsrf();
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      headers.append("set-cookie", sessionCookieHeader(result.token));
      headers.append("set-cookie", csrfCookieHeader(csrf));
      return new Response(
        JSON.stringify({
          userId: result.session.userId,
          role: result.session.role,
          accessStatus: result.session.accessStatus,
          csrf,
        }),
        { status: 200, headers },
      );
    }

    if (url.pathname === "/api/selfhost/logout" && request.method === "POST") {
      if (getAuthBackend() === "local") {
        assertCsrf(request);
        await revokeSessionByToken(getPostgresPool(), readSessionToken(request));
      }
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      headers.append("set-cookie", clearSessionCookieHeader());
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (url.pathname === "/api/selfhost/me" && request.method === "GET") {
      if (!isLocalClientCircuit()) {
        return json({ session: null, mode: "supabase" });
      }
      const session = await loadSession(getPostgresPool(), readSessionToken(request));
      return json({
        session: session
          ? {
              userId: session.userId,
              email: session.email,
              role: session.role,
              accessStatus: session.accessStatus,
              unlockSource: session.unlockSource,
            }
          : null,
      });
    }

    if (!isLocalClientCircuit()) {
      return errorJson("Клиентский PostgreSQL-контур выключен", 404);
    }

    const session = await requireSession(request);
    if (
      session.role !== "admin" &&
      session.accessStatus !== "active" &&
      (url.pathname === "/api/selfhost/nutrition" ||
        url.pathname === "/api/selfhost/training" ||
        url.pathname === "/api/selfhost/pdf")
    ) {
      return errorJson("Доступ к курсу ещё не открыт", 403);
    }

    if (url.pathname === "/api/selfhost/profile" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const [profile, access] = await Promise.all([
        getProfilePg(getPostgresPool(), clientId),
        getClientAccessPg(getPostgresPool(), clientId),
      ]);
      return json({ profile, access });
    }

    if (url.pathname === "/api/selfhost/courses" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const courses = await listClientCoursesPg(getPostgresPool(), clientId);
      return json({ courses });
    }

    if (url.pathname === "/api/selfhost/nutrition" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const courseId = url.searchParams.get("courseId");
      const record = await getActivePublishedNutritionPg(getPostgresPool(), clientId, courseId);
      const view = await toPublishedNutritionView(record);
      return json({ nutrition: view });
    }

    if (url.pathname === "/api/selfhost/training" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const courseId = url.searchParams.get("courseId");
      const record = await getActivePublishedTrainingPg(getPostgresPool(), clientId, courseId);
      const view = await toPublishedTrainingView(getPostgresPool(), record);
      return json({ training: view });
    }

    if (url.pathname === "/api/selfhost/pdf" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const kind = body.kind === "training" ? "training" : "nutrition";
      const clientId = scopedClientId(session, typeof body.clientId === "string" ? body.clientId : null);
      const courseId = typeof body.courseId === "string" ? body.courseId : null;
      const meta = await getPdfAccessMetaPg(getPostgresPool(), clientId, courseId);
      if (kind === "nutrition") {
        const record = await getActivePublishedNutritionPg(getPostgresPool(), clientId, courseId);
        if (!record || record.version.status !== "published") {
          return errorJson("Опубликованная программа ещё не выдана", 404);
        }
        const issuedAt = record.version.published_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
        const buffer = await buildNutritionPdf(record.snapshot, { ...meta, issuedAt });
        const headers = pdfDownloadHeaders(kind, issuedAt);
        return json({
          filename: headers["Content-Disposition"].match(/filename="([^"]+)"/)?.[1],
          contentType: headers["Content-Type"],
          pdfBase64: buffer.toString("base64"),
        });
      }
      const record = await getActivePublishedTrainingPg(getPostgresPool(), clientId, courseId);
      if (!record || record.version.status !== "published") {
        return errorJson("Опубликованная программа ещё не выдана", 404);
      }
      const snapshotBindings = await loadSnapshotMediaBindings(getPostgresPool(), record.version.id);
      const overlay = videoOverlayFromBindings(
        record.snapshot,
        await loadMediaBindings(
          getPostgresPool(),
          mediaExerciseIdsFromBindings(record.snapshot, snapshotBindings),
        ),
        snapshotBindings,
      );
      const issuedAt = record.version.published_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const buffer = await buildTrainingPdf(record.snapshot, { ...meta, issuedAt }, overlay);
      const headers = pdfDownloadHeaders(kind, issuedAt);
      return json({
        filename: headers["Content-Disposition"].match(/filename="([^"]+)"/)?.[1],
        contentType: headers["Content-Type"],
        pdfBase64: buffer.toString("base64"),
      });
    }

    return errorJson("Не найден маршрут", 404);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Ошибка сервера";
    if (status >= 500) console.error("[selfhost]", message);
    return errorJson(message, status);
  }
}
