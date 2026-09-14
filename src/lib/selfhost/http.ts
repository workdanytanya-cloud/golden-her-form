import { ZodError } from "zod";
import {
  getAuthBackend,
  getDataBackend,
  getMediaBackend,
  isLocalClientCircuit,
  publicRuntimeConfig,
} from "@/lib/selfhost/config";
import {
  PostgresExerciseRepository,
  adminExerciseListQuerySchema,
  adminExerciseMediaSchema,
  adminExerciseUpsertSchema,
} from "@/lib/selfhost/postgres-exercises";
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
import { mediaExerciseIdsFromBindings } from "@/lib/selfhost/media";
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
import {
  PostgresAdminClientRepository,
  adminClientAccessSchema,
  adminClientListQuerySchema,
  adminClientProfileSchema,
} from "@/lib/selfhost/postgres-admin-clients";
import {
  PostgresClientCourseRepository,
  adminCourseCreateSchema,
  adminCourseUpdateSchema,
  resolveClientCourseIdPg,
} from "@/lib/selfhost/postgres-courses";

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
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

function requireAdmin(session: LocalSession): void {
  if (session.role !== "admin") {
    throw Object.assign(new Error("Недостаточно прав"), { statusCode: 403 });
  }
}

function exerciseRepo(): PostgresExerciseRepository {
  return new PostgresExerciseRepository(getPostgresPool());
}

function adminClients(): PostgresAdminClientRepository {
  return new PostgresAdminClientRepository(getPostgresPool());
}

function coursesRepo(): PostgresClientCourseRepository {
  return new PostgresClientCourseRepository(getPostgresPool());
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
          {
            ok: postgres.status === "up",
            authBackend,
            dataBackend,
            mediaBackend: getMediaBackend(),
            postgres: postgres.status,
            reason: postgres.reason ?? null,
          },
          postgres.status === "up" ? 200 : 503,
        );
      }
      return json({
        ok: true,
        authBackend,
        dataBackend,
        mediaBackend: getMediaBackend(),
        postgres: "skipped",
      });
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

    if (url.pathname === "/api/selfhost/course" && request.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return errorJson("Не указан id курса", 400);
      const course = await coursesRepo().get(id);
      if (!course) return errorJson("Курс не найден", 404);
      scopedClientId(session, course.client_id);
      return json({ course });
    }

    if (url.pathname === "/api/selfhost/resolve-course" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const courseId = await resolveClientCourseIdPg(
        getPostgresPool(),
        clientId,
        url.searchParams.get("courseId"),
      );
      return json({ courseId });
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

    if (url.pathname === "/api/selfhost/admin/exercises" && request.method === "GET") {
      requireAdmin(session);
      const query = adminExerciseListQuerySchema.parse({
        q: url.searchParams.get("q") ?? "",
        category: url.searchParams.get("category") ?? "all",
        media: url.searchParams.get("media") ?? "all",
      });
      const result = await exerciseRepo().search(query);
      return json(result);
    }

    if (url.pathname === "/api/selfhost/admin/exercises" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const saved = await exerciseRepo().save(
        adminExerciseUpsertSchema.parse(body),
        session.userId,
      );
      return json({ ok: true, id: saved.id, video: saved.video });
    }

    if (url.pathname === "/api/selfhost/admin/exercises" && request.method === "DELETE") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const id = url.searchParams.get("id") ?? (typeof body.id === "string" ? body.id : "");
      if (!id) return errorJson("Не указан id упражнения", 400);
      await exerciseRepo().remove(id, session.userId);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/admin/exercises/media" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const saved = await exerciseRepo().setMedia(
        adminExerciseMediaSchema.parse(body),
        session.userId,
      );
      return json({ ok: true, id: saved.id, video: saved.video });
    }

    if (url.pathname === "/api/selfhost/admin/exercises/media" && request.method === "DELETE") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const id =
        url.searchParams.get("id") ??
        (typeof body.exercise_id === "string"
          ? body.exercise_id
          : typeof body.id === "string"
            ? body.id
            : "");
      if (!id) return errorJson("Не указан id упражнения", 400);
      await exerciseRepo().deleteBinding(id, session.userId);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/pdf" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const kind = body.kind === "training" ? "training" : "nutrition";
      const clientId = scopedClientId(
        session,
        typeof body.clientId === "string" ? body.clientId : null,
      );
      const courseId = typeof body.courseId === "string" ? body.courseId : null;
      const meta = await getPdfAccessMetaPg(getPostgresPool(), clientId, courseId);
      if (kind === "nutrition") {
        const record = await getActivePublishedNutritionPg(getPostgresPool(), clientId, courseId);
        if (!record || record.version.status !== "published") {
          return errorJson("Опубликованная программа ещё не выдана", 404);
        }
        const issuedAt =
          record.version.published_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
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
      const snapshotBindings = await loadSnapshotMediaBindings(
        getPostgresPool(),
        record.version.id,
      );
      const overlay = videoOverlayFromBindings(
        record.snapshot,
        await loadMediaBindings(
          getPostgresPool(),
          mediaExerciseIdsFromBindings(record.snapshot, snapshotBindings),
        ),
        snapshotBindings,
      );
      const issuedAt =
        record.version.published_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const buffer = await buildTrainingPdf(record.snapshot, { ...meta, issuedAt }, overlay);
      const headers = pdfDownloadHeaders(kind, issuedAt);
      return json({
        filename: headers["Content-Disposition"].match(/filename="([^"]+)"/)?.[1],
        contentType: headers["Content-Type"],
        pdfBase64: buffer.toString("base64"),
      });
    }

    if (url.pathname === "/api/selfhost/admin/exercises/restore" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const id = typeof body.id === "string" ? body.id : url.searchParams.get("id");
      if (!id) return errorJson("Не указан id упражнения", 400);
      await exerciseRepo().restore(id);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/admin/clients" && request.method === "GET") {
      requireAdmin(session);
      const query = adminClientListQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
      const result = await adminClients().list(query);
      return json(result);
    }

    if (url.pathname === "/api/selfhost/admin/clients/export" && request.method === "GET") {
      requireAdmin(session);
      const rows = await adminClients().exportContacts();
      return json({ rows });
    }

    if (url.pathname === "/api/selfhost/admin/resolve-course" && request.method === "GET") {
      requireAdmin(session);
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return errorJson("Не указан clientId", 400);
      const courseId = await resolveClientCourseIdPg(
        getPostgresPool(),
        clientId,
        url.searchParams.get("courseId"),
      );
      return json({ courseId });
    }

    const clientMatch = url.pathname.match(
      /^\/api\/selfhost\/admin\/clients\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/,
    );
    if (clientMatch) {
      requireAdmin(session);
      const clientId = clientMatch[1];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
        return errorJson("Некорректный идентификатор клиента", 400);
      }
      const action = clientMatch[2];
      const extra = clientMatch[3];

      if (!action && request.method === "GET") {
        const card = await adminClients().get(clientId);
        if (!card) return errorJson("Клиент не найден", 404);
        return json({ client: card });
      }

      if (action === "profile" && request.method === "POST") {
        assertCsrf(request);
        const body = await readJson(request);
        await adminClients().updateProfile(clientId, adminClientProfileSchema.parse(body));
        return json({ ok: true });
      }

      if (action === "access" && request.method === "POST") {
        assertCsrf(request);
        const body = await readJson(request);
        await adminClients().setAccess(
          clientId,
          adminClientAccessSchema.parse(body),
          session.userId,
        );
        return json({ ok: true });
      }

      if (action === "onboarding" && request.method === "GET") {
        const card = await adminClients().get(clientId);
        if (!card) return errorJson("Клиент не найден", 404);
        return json({ onboarding: card.onboarding, profile: card });
      }

      if (action === "measurements" && request.method === "GET") {
        const card = await adminClients().get(clientId);
        if (!card) return errorJson("Клиент не найден", 404);
        return json({ measurements: card.measurements });
      }

      if (action === "courses" && !extra && request.method === "GET") {
        const courses = await coursesRepo().list(clientId);
        return json({ courses });
      }

      if (action === "courses" && !extra && request.method === "POST") {
        assertCsrf(request);
        const body = await readJson(request);
        const created = await coursesRepo().create(
          adminCourseCreateSchema.parse({ ...body, clientId, createdBy: session.userId }),
          session.userId,
        );
        return json({ course: created });
      }

      if (action === "courses" && extra && request.method === "PATCH") {
        assertCsrf(request);
        const body = await readJson(request);
        const course = await coursesRepo().update(
          extra,
          clientId,
          adminCourseUpdateSchema.parse(body),
        );
        return json({ course });
      }

      if (action === "courses" && extra === undefined) {
        /* fall through */
      }

      if (action === "courses" && extra && request.method === "POST") {
        assertCsrf(request);
        const body = await readJson(request);
        const op = typeof body.op === "string" ? body.op : url.searchParams.get("op");
        if (op === "activate") {
          await coursesRepo().activate(extra, clientId);
          return json({ ok: true });
        }
        if (op === "archive") {
          await coursesRepo().archive(extra, clientId);
          return json({ ok: true });
        }
        return errorJson("Неизвестная операция курса", 400);
      }

      if (action === "courses" && extra && request.method === "DELETE") {
        assertCsrf(request);
        await coursesRepo().removeDraft(extra, clientId);
        return json({ ok: true });
      }
    }

    return errorJson("Не найден маршрут", 404);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorJson(error.issues[0]?.message ?? "Некорректные данные", 400);
    }
    const pg = error as { code?: string; message?: string; statusCode?: number };
    if (
      !pg.statusCode &&
      (pg.code === "ECONNREFUSED" ||
        pg.code === "ENOTFOUND" ||
        pg.code === "ETIMEDOUT" ||
        pg.code === "ECONNRESET" ||
        /ECONNREFUSED|timeout expired|connect/i.test(String(pg.message ?? "")))
    ) {
      return errorJson("PostgreSQL недоступен", 503);
    }
    const status = pg.statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Ошибка сервера";
    if (status >= 500) console.error("[selfhost]", message);
    return errorJson(message, status);
  }
}
