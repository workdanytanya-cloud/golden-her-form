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
import { checkPostgresHealth, getPostgresPool, withTransaction } from "@/lib/selfhost/db";
import {
  listAdminNotificationsPg,
  listClientNotificationsPg,
  markAllAdminNotificationsReadPg,
  markAllClientNotificationsReadPg,
  markAdminNotificationReadPg,
  markClientNotificationReadPg,
  deleteAdminNotificationPg,
  deleteClientNotificationPg,
} from "@/lib/selfhost/postgres-notifications";
import {
  assertCsrf,
  assertLoginRateLimit,
  clearLoginRateLimit,
  clearSessionCookieHeader,
  csrfCookieHeader,
  loadSession,
  loginWithPassword,
  readSessionToken,
  recordFailedLoginAttempt,
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
  getDashboardOverviewPg,
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
  createMeasurementPg,
  deleteMeasurementPg,
  listMeasurementsPg,
  loadLatestWeightKgPg,
  measurementCreateSchema,
} from "@/lib/selfhost/postgres-measurements";
import {
  loadOnboardingPg,
  onboardingSaveSchema,
  saveOnboardingPg,
} from "@/lib/selfhost/postgres-onboarding";
import {
  countWorkoutsCompletedThisWeekPg,
  getWeeklyCheckInPg,
  saveWeeklyCheckInPg,
  weeklyCheckInSaveSchema,
} from "@/lib/selfhost/postgres-checkins";
import {
  adminCreatePromosSchema,
  createPromoCodesPg,
  listPromoCodesPg,
  redeemPromoForUserPg,
  redeemPromoSchema,
  revokePromoCodePg,
  signupOrLoginWithPromoPg,
  signupPromoSchema,
} from "@/lib/selfhost/postgres-promos";
import {
  confirmPasswordResetPg,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  requestPasswordResetPg,
} from "@/lib/selfhost/postgres-password-reset";
import { describeMailConfigForOps } from "@/lib/selfhost/mail";
import {
  assertLeadSubmitRateLimit,
  createLeadPg,
  leadCreateSchema,
  leadStatusSchema,
  listLeadsPg,
  updateLeadStatusPg,
} from "@/lib/selfhost/postgres-leads";
import {
  PostgresAdminClientRepository,
  adminClientAccessSchema,
  adminClientListQuerySchema,
  adminClientPasswordSchema,
  adminClientProfileSchema,
} from "@/lib/selfhost/postgres-admin-clients";
import {
  PostgresDishRepository,
  adminDishListQuerySchema,
  adminDishUpsertSchema,
} from "@/lib/selfhost/postgres-dishes";
import {
  describeMediaRootForOps,
  publicMediaUrl,
  readMediaFile,
  saveDishMediaUpload,
} from "@/lib/selfhost/local-media-store";
import {
  PostgresClientCourseRepository,
  adminCourseCreateSchema,
  adminCourseUpdateSchema,
  resolveClientCourseIdPg,
} from "@/lib/selfhost/postgres-courses";
import {
  loadConstructorPlanPg,
  loadMealPreferencePg,
  loadOptimizerContextPg,
  nutritionDraftSaveSchema,
  nutritionGenerateSchema,
  nutritionPreferenceSchema,
  nutritionPublishSchema,
  publishNutritionVersionPg,
  saveConstructorPlanPg,
  saveMealPreferencePg,
} from "@/lib/selfhost/postgres-nutrition";
import {
  listTrainingExercisesPg,
  loadTrainingDraftPg,
  loadTrainingProfilePg,
  patchTrainingDayPg,
  patchTrainingProgramPg,
  publishTrainingVersionPg,
  saveTrainingDraftPg,
  trainingDayPatchSchema,
  trainingDraftSaveSchema,
  trainingProgramPatchSchema,
  trainingPublishSchema,
} from "@/lib/selfhost/postgres-training";
import { generateAndValidateConstructorPlan } from "@/lib/nutrition-constructor/repo";

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

function dishesRepo(): PostgresDishRepository {
  return new PostgresDishRepository(getPostgresPool());
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
        const mail = authBackend === "local" ? describeMailConfigForOps() : null;
        return json(
          {
            ok: postgres.status === "up",
            authBackend,
            dataBackend,
            mediaBackend: getMediaBackend(),
            mediaStore: describeMediaRootForOps(),
            postgres: postgres.status,
            reason: postgres.reason ?? null,
            passwordReset: mail
              ? {
                  transport: mail.transport,
                  publicAppUrlConfigured: mail.publicAppUrlConfigured,
                  productionReady: mail.productionReady,
                  blocker: mail.blocker,
                }
              : null,
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
      let result: Awaited<ReturnType<typeof loginWithPassword>>;
      try {
        result = await loginWithPassword(getPostgresPool(), email, password);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401) recordFailedLoginAttempt(request);
        throw error;
      }
      clearLoginRateLimit(request);
      const csrf = issueCsrf();
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      headers.append("set-cookie", sessionCookieHeader(result.token));
      headers.append("set-cookie", csrfCookieHeader(csrf));
      return new Response(
        JSON.stringify({
          userId: result.session.userId,
          role: result.session.role,
          accessStatus: result.session.accessStatus,
          unlockSource: result.session.unlockSource,
          csrf,
        }),
        { status: 200, headers },
      );
    }

    if (url.pathname === "/api/selfhost/signup-promo" && request.method === "POST") {
      if (getAuthBackend() !== "local") {
        return errorJson("Локальная авторизация выключена", 503);
      }
      requirePostgres();
      assertCsrf(request);
      assertLoginRateLimit(request);
      const body = await readJson(request);
      const parsed = signupPromoSchema.parse(body);
      let result: Awaited<ReturnType<typeof signupOrLoginWithPromoPg>>;
      try {
        result = await signupOrLoginWithPromoPg(getPostgresPool(), parsed);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401) recordFailedLoginAttempt(request);
        throw error;
      }
      clearLoginRateLimit(request);
      const csrf = issueCsrf();
      const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
      headers.append("set-cookie", sessionCookieHeader(result.token));
      headers.append("set-cookie", csrfCookieHeader(csrf));
      return new Response(
        JSON.stringify({
          ok: true,
          userId: result.session.userId,
          role: result.session.role,
          accessStatus: result.session.accessStatus,
          unlockSource: result.session.unlockSource,
          already: result.already,
          createdUser: result.createdUser,
          program_title: result.program_title,
          csrf,
        }),
        { status: 200, headers },
      );
    }

    if (url.pathname === "/api/selfhost/password-reset/request" && request.method === "POST") {
      if (getAuthBackend() !== "local") {
        return errorJson("Локальная авторизация выключена", 503);
      }
      requirePostgres();
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = passwordResetRequestSchema.parse(body);
      const result = await requestPasswordResetPg(getPostgresPool(), parsed, request);
      // Uniform body — never include token, email existence, or mail internals.
      return json({ ok: true, message: result.message });
    }

    if (url.pathname === "/api/selfhost/password-reset/confirm" && request.method === "POST") {
      if (getAuthBackend() !== "local") {
        return errorJson("Локальная авторизация выключена", 503);
      }
      requirePostgres();
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = passwordResetConfirmSchema.parse(body);
      await confirmPasswordResetPg(getPostgresPool(), parsed);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/leads") {
      // Public lead intake only — never expose a leads list on this path.
      if (request.method !== "POST") {
        return errorJson("Not found", 404);
      }
      if (!isLocalClientCircuit()) {
        return errorJson("Клиентский PostgreSQL-контур выключен", 404);
      }
      assertCsrf(request);
      assertLeadSubmitRateLimit(request);
      const body = await readJson(request);
      const parsed = leadCreateSchema.parse({
        ...body,
        idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
      });
      const created = await createLeadPg(getPostgresPool(), parsed);
      if (created.honeypot) {
        return json({ ok: true, id: null, build: "selfhost-leads-v1", notified: false });
      }
      let notified = false;
      let notify: Record<string, unknown> | undefined;
      if (created.lead && !created.idempotent) {
        try {
          const { dispatchLeadNotifications } = await import("@/lib/leads.functions");
          const dispatch = await dispatchLeadNotifications(
            {
              full_name: created.lead.full_name,
              age: created.lead.age,
              phone: created.lead.phone,
              email: created.lead.email,
              messenger: created.lead.messenger as "telegram" | "max" | "whatsapp" | "any",
              source: created.lead.source as "general" | "program" | "question",
              program_slug: created.lead.program_slug,
              program_title: created.lead.program_title,
              message: created.lead.message,
            },
            created.lead.id,
          );
          notified = dispatch.notified;
          notify = dispatch.notify;
        } catch {
          notified = false;
        }
      }
      return json({
        ok: true,
        id: created.lead?.id ?? null,
        idempotent: created.idempotent,
        build: "selfhost-leads-v1",
        notified,
        notify,
      });
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

    // Public opaque media URLs. Prefer ?p=… — paths ending in .png/.jpg are often
    // intercepted as static assets by the Vite/Nitro stack and never reach this handler.
    if (
      (url.pathname === "/api/selfhost/media" || url.pathname.startsWith("/api/selfhost/media/")) &&
      request.method === "GET"
    ) {
      if (!isLocalClientCircuit()) {
        return errorJson("Клиентский PostgreSQL-контур выключен", 404);
      }
      const fromQuery = url.searchParams.get("p") ?? url.searchParams.get("path");
      const relative = fromQuery
        ? decodeURIComponent(fromQuery)
        : decodeURIComponent(url.pathname.slice("/api/selfhost/media/".length));
      if (!relative) return errorJson("Не указан путь медиа", 400);
      const file = readMediaFile(relative);
      return new Response(file.bytes, {
        status: 200,
        headers: {
          "content-type": file.contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
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
      const [profile, access, latestWeight] = await Promise.all([
        getProfilePg(getPostgresPool(), clientId),
        getClientAccessPg(getPostgresPool(), clientId),
        loadLatestWeightKgPg(getPostgresPool(), clientId),
      ]);
      return json({ profile, access, latestWeightKg: latestWeight });
    }

    if (url.pathname === "/api/selfhost/profile" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const clientId = scopedClientId(session, body.clientId ?? null);
      const hasProfilePatch =
        body.full_name !== undefined ||
        body.phone !== undefined ||
        body.goal !== undefined ||
        body.height_cm !== undefined ||
        body.birth_date !== undefined ||
        body.gender !== undefined;
      if (hasProfilePatch) {
        const patch = adminClientProfileSchema.parse(body);
        await adminClients().updateProfile(clientId, patch);
      }
      let measurement = null as Awaited<ReturnType<typeof createMeasurementPg>>["measurement"] | null;
      const weight =
        body.weight_kg === undefined || body.weight_kg === null || body.weight_kg === ""
          ? null
          : Number(body.weight_kg);
      if (weight != null && Number.isFinite(weight)) {
        const created = await createMeasurementPg(getPostgresPool(), {
          clientId,
          measured_on: new Date().toISOString().slice(0, 10),
          weight_kg: weight,
          waist_cm: null,
          hips_cm: null,
          chest_cm: null,
          note: session.role === "admin" ? "Из профиля (тренер)" : "Из профиля",
          idempotencyKey:
            typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
        });
        measurement = created.measurement;
      }
      const latestWeightKg = await loadLatestWeightKgPg(getPostgresPool(), clientId);
      return json({ ok: true, measurement, latestWeightKg });
    }

    if (url.pathname === "/api/selfhost/measurements" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const items = await listMeasurementsPg(getPostgresPool(), clientId);
      const latestWeightKg = await loadLatestWeightKgPg(getPostgresPool(), clientId);
      return json({ items, latestWeightKg });
    }

    if (url.pathname === "/api/selfhost/measurements" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = measurementCreateSchema.parse({
        ...body,
        clientId: scopedClientId(session, body.clientId ?? null),
        idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
      });
      const result = await createMeasurementPg(getPostgresPool(), parsed);
      const latestWeightKg = await loadLatestWeightKgPg(getPostgresPool(), parsed.clientId);
      return json({ ...result, latestWeightKg });
    }

    {
      const measMatch = url.pathname.match(/^\/api\/selfhost\/measurements\/([^/]+)$/);
      if (measMatch && request.method === "DELETE") {
        assertCsrf(request);
        const measurementId = measMatch[1];
        const body = await readJson(request).catch(() => ({}));
        const clientId = scopedClientId(
          session,
          (body as { clientId?: string }).clientId ?? url.searchParams.get("clientId"),
        );
        await deleteMeasurementPg(getPostgresPool(), measurementId, clientId);
        const latestWeightKg = await loadLatestWeightKgPg(getPostgresPool(), clientId);
        return json({ ok: true, latestWeightKg });
      }
    }

    if (url.pathname === "/api/selfhost/onboarding" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const loaded = await loadOnboardingPg(getPostgresPool(), clientId);
      return json(loaded);
    }

    if (url.pathname === "/api/selfhost/onboarding" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = onboardingSaveSchema.parse({
        ...body,
        clientId: scopedClientId(session, body.clientId ?? null),
      });
      const saved = await saveOnboardingPg(getPostgresPool(), parsed);
      return json(saved);
    }

    if (url.pathname === "/api/selfhost/checkins/weekly" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const weekStart = url.searchParams.get("weekStart");
      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return errorJson("Некорректный weekStart", 400);
      }
      const row = await getWeeklyCheckInPg(getPostgresPool(), clientId, weekStart);
      const workoutsCompleted = await countWorkoutsCompletedThisWeekPg(
        getPostgresPool(),
        clientId,
        weekStart,
      );
      return json({ row, workoutsCompleted });
    }

    if (url.pathname === "/api/selfhost/checkins/weekly" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = weeklyCheckInSaveSchema.parse({
        ...body,
        clientId: scopedClientId(session, body.clientId ?? null),
      });
      const saved = await saveWeeklyCheckInPg(getPostgresPool(), parsed);
      return json(saved);
    }

    if (url.pathname === "/api/selfhost/promo/redeem" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = redeemPromoSchema.parse(body);
      const result = await redeemPromoForUserPg(getPostgresPool(), session.userId, parsed.code);
      return json({ ok: true, ...result });
    }

    if (url.pathname === "/api/selfhost/dashboard" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const overview = await getDashboardOverviewPg(getPostgresPool(), clientId);
      return json(overview);
    }

    if (url.pathname === "/api/selfhost/notifications" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const data = await listClientNotificationsPg(getPostgresPool(), clientId);
      return json(data);
    }

    if (url.pathname === "/api/selfhost/notifications/read" && request.method === "POST") {
      assertCsrf(request);
      const body = await readJson(request);
      const id = String(body.id ?? "");
      if (!id) return errorJson("Не указан id уведомления", 400);
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const result = await markClientNotificationReadPg(getPostgresPool(), clientId, id);
      if (!result.found) return errorJson("Уведомление не найдено", 404);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/notifications/read-all" && request.method === "POST") {
      assertCsrf(request);
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const result = await markAllClientNotificationsReadPg(getPostgresPool(), clientId);
      return json(result);
    }

    {
      const delMatch = url.pathname.match(/^\/api\/selfhost\/notifications\/([^/]+)$/);
      if (delMatch && request.method === "DELETE") {
        assertCsrf(request);
        const clientId = scopedClientId(session, url.searchParams.get("clientId"));
        await deleteClientNotificationPg(getPostgresPool(), clientId, delMatch[1]);
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/selfhost/courses" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const courses = await listClientCoursesPg(getPostgresPool(), clientId);
      return json({ courses });
    }

    if (url.pathname === "/api/selfhost/courses/renew" && request.method === "POST") {
      // Client renew: only own course continuum. Never activate / expand access.
      assertCsrf(request);
      if (session.role === "admin") {
        return errorJson("Продление курса доступно клиенту из кабинета", 403);
      }
      const body = await readJson(request);
      if (body.clientId != null && String(body.clientId) !== session.userId) {
        return errorJson("Можно продлить только свой курс", 403);
      }
      const result = await coursesRepo().renewForClient(session.userId);
      return json({ course: result, idempotent: result.idempotent });
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

    if (url.pathname === "/api/selfhost/nutrition/preference" && request.method === "GET") {
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      const preference = await loadMealPreferencePg(
        getPostgresPool(),
        clientId,
        url.searchParams.get("courseId"),
      );
      return json({ preference });
    }

    if (url.pathname === "/api/selfhost/nutrition/preference" && request.method === "POST") {
      assertCsrf(request);
      const body = nutritionPreferenceSchema.parse(await readJson(request));
      const clientId = scopedClientId(session, url.searchParams.get("clientId"));
      await saveMealPreferencePg(getPostgresPool(), {
        clientId,
        courseId: body.courseId,
        mode: body.mode,
        primarySlot: body.primarySlot,
        publishedMode: body.publishedMode,
      });
      return json({ ok: true });
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

    if (url.pathname === "/api/selfhost/admin/dishes" && request.method === "GET") {
      requireAdmin(session);
      const query = adminDishListQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
      return json(await dishesRepo().list(query));
    }

    if (url.pathname === "/api/selfhost/admin/dishes" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const saved = await dishesRepo().upsert(adminDishUpsertSchema.parse(body));
      return json({ ok: true, dish: saved });
    }

    const dishMatch = url.pathname.match(/^\/api\/selfhost\/admin\/dishes\/([^/]+)$/);
    if (dishMatch) {
      requireAdmin(session);
      const dishId = dishMatch[1]!;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dishId)) {
        return errorJson("Некорректный идентификатор блюда", 400);
      }
      if (request.method === "GET") {
        const dish = await dishesRepo().get(dishId);
        if (!dish) return errorJson("Блюдо не найдено", 404);
        return json({ dish });
      }
      if (request.method === "PATCH" || request.method === "PUT") {
        assertCsrf(request);
        const body = await readJson(request);
        const saved = await dishesRepo().upsert(
          adminDishUpsertSchema.parse({ ...body, id: dishId }),
        );
        return json({ ok: true, dish: saved });
      }
      if (request.method === "DELETE") {
        assertCsrf(request);
        await dishesRepo().remove(dishId);
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/selfhost/admin/media/upload" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const form = await request.formData();
      const folderRaw = form.get("folder");
      const file = form.get("file");
      if (typeof folderRaw !== "string") {
        return errorJson("Не указана папка загрузки", 400);
      }
      if (!file || typeof (file as Blob).arrayBuffer !== "function") {
        return errorJson("Файл не передан", 400);
      }
      const blob = file as Blob;
      const contentType =
        blob.type ||
        (typeof form.get("contentType") === "string" ? String(form.get("contentType")) : "");
      const bytes = Buffer.from(await blob.arrayBuffer());
      const saved = await saveDishMediaUpload({
        folder: folderRaw,
        bytes,
        contentType,
        originalName: file instanceof File ? file.name : undefined,
      });
      return json({
        ok: true,
        url: saved.url,
        path: saved.relativePath,
        bytes: saved.bytes,
        publicUrl: publicMediaUrl(saved.relativePath),
      });
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

    if (url.pathname === "/api/selfhost/admin/nutrition/catalog" && request.method === "GET") {
      requireAdmin(session);
      const ctx = await loadOptimizerContextPg(getPostgresPool());
      return json({
        products: [...ctx.products.values()],
        recipes: ctx.recipes,
        recipeIngredients: Object.fromEntries(ctx.recipeIngredients),
      });
    }

    if (url.pathname === "/api/selfhost/admin/nutrition/draft" && request.method === "GET") {
      requireAdmin(session);
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return errorJson("Не указан clientId", 400);
      const loaded = await loadConstructorPlanPg(
        getPostgresPool(),
        clientId,
        url.searchParams.get("courseId"),
      );
      return json(loaded);
    }

    if (url.pathname === "/api/selfhost/admin/nutrition/draft" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const raw = await readJson(request);
      const body = nutritionDraftSaveSchema.parse(raw);
      const userId = body.userId ?? body.clientId;
      if (!userId) return errorJson("Не указан clientId", 400);
      const saved = await saveConstructorPlanPg(getPostgresPool(), {
        userId,
        courseId: body.courseId,
        days: (body.days as never) ?? [],
        targets: body.targets,
        plan_days_count: body.plan_days_count,
        plan_status: body.plan_status,
        bmr: body.bmr ?? undefined,
        tdee: body.tdee ?? undefined,
        calorie_adjustment_pct: body.calorie_adjustment_pct ?? undefined,
        notes: body.notes ?? null,
        excluded_products: body.excluded_products ?? [],
        targets_manual: body.targets_manual !== false,
        meal_schedule_mode: body.meal_schedule_mode,
        primary_meal_slot: body.primary_meal_slot,
        requires_manual_review: body.requires_manual_review,
        review_reason: body.review_reason,
      });
      return json(saved);
    }

    if (url.pathname === "/api/selfhost/admin/nutrition/generate" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = nutritionGenerateSchema.parse(await readJson(request));
      const generated = await generateAndValidateConstructorPlan({
        profile: body.profile as never,
        days_count: body.days_count,
        excluded_product_ids: body.excluded_product_ids,
        meal_schedule_mode: body.meal_schedule_mode,
        primary_meal_slot: body.primary_meal_slot,
        targets_override: body.targets_override,
      });
      return json(generated);
    }

    if (url.pathname === "/api/selfhost/admin/nutrition/publish" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = nutritionPublishSchema.parse(await readJson(request));
      const loaded = await loadConstructorPlanPg(getPostgresPool(), body.clientId, body.courseId);
      if (!loaded.plan || loaded.days.length === 0) {
        return errorJson("Нет черновика для публикации", 400);
      }
      const published = await publishNutritionVersionPg(getPostgresPool(), {
        clientId: body.clientId,
        courseId: body.courseId,
        actorId: session.userId,
        reason: body.reason ?? null,
        idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
        days: loaded.days,
        plan: loaded.plan,
      });
      return json(published);
    }

    if (url.pathname === "/api/selfhost/admin/training/exercises" && request.method === "GET") {
      requireAdmin(session);
      const items = await listTrainingExercisesPg(getPostgresPool());
      return json({ items });
    }

    if (url.pathname === "/api/selfhost/admin/training/profile" && request.method === "GET") {
      requireAdmin(session);
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return errorJson("Не указан clientId", 400);
      const profile = await loadTrainingProfilePg(getPostgresPool(), clientId);
      return json({ profile });
    }

    if (url.pathname === "/api/selfhost/admin/training/draft" && request.method === "GET") {
      requireAdmin(session);
      const clientId = url.searchParams.get("clientId");
      if (!clientId) return errorJson("Не указан clientId", 400);
      const loaded = await loadTrainingDraftPg(
        getPostgresPool(),
        clientId,
        url.searchParams.get("courseId"),
      );
      return json(loaded);
    }

    if (url.pathname === "/api/selfhost/admin/training/draft" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = trainingDraftSaveSchema.parse(await readJson(request));
      const saved = await saveTrainingDraftPg(getPostgresPool(), body);
      return json(saved);
    }

    if (url.pathname === "/api/selfhost/admin/training/day" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = trainingDayPatchSchema.parse(await readJson(request));
      const result = await patchTrainingDayPg(getPostgresPool(), body);
      return json(result);
    }

    if (url.pathname === "/api/selfhost/admin/training/program" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = trainingProgramPatchSchema.parse(await readJson(request));
      const result = await patchTrainingProgramPg(getPostgresPool(), body);
      return json(result);
    }

    if (url.pathname === "/api/selfhost/admin/training/publish" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = trainingPublishSchema.parse(await readJson(request));
      const published = await publishTrainingVersionPg(getPostgresPool(), {
        clientId: body.clientId,
        courseId: body.courseId,
        actorId: session.userId,
        reason: body.reason ?? null,
        idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
      });
      return json(published);
    }

    if (url.pathname === "/api/selfhost/admin/unmatched-exercises" && request.method === "GET") {
      requireAdmin(session);
      const { rows } = await getPostgresPool().query(
        `SELECT original_exercise_id, provider, source_url, title, status, resolved_exercise_id, source
           FROM public.unmatched_exercise_media
          WHERE resolved_exercise_id IS NULL
          ORDER BY created_at`,
      );
      return json({ items: rows });
    }

    if (
      url.pathname === "/api/selfhost/admin/unmatched-exercises/map" &&
      request.method === "POST"
    ) {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const originalId = String(body.original_exercise_id ?? "");
      const resolvedId = String(body.resolved_exercise_id ?? "");
      if (!originalId || !resolvedId) return errorJson("Нужны original и resolved id", 400);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE public.unmatched_exercise_media
              SET resolved_exercise_id = $2, updated_at = (now() AT TIME ZONE 'utc')
            WHERE original_exercise_id = $1`,
          [originalId, resolvedId],
        );
        await client.query(
          `INSERT INTO public.exercise_media_bindings (exercise_id, provider, source_url, embed_url, title, status, fallback_text)
           SELECT $2, provider, source_url, embed_url, title, status, fallback_text
             FROM public.unmatched_exercise_media WHERE original_exercise_id = $1
           ON CONFLICT (exercise_id) DO UPDATE SET
             source_url = EXCLUDED.source_url, provider = EXCLUDED.provider, status = EXCLUDED.status`,
          [originalId, resolvedId],
        );
      });
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/admin/promos" && request.method === "GET") {
      requireAdmin(session);
      const items = await listPromoCodesPg(getPostgresPool());
      return json({ items });
    }

    if (url.pathname === "/api/selfhost/admin/leads" && request.method === "GET") {
      requireAdmin(session);
      const items = await listLeadsPg(getPostgresPool());
      return json({ items });
    }

    if (url.pathname === "/api/selfhost/admin/notifications" && request.method === "GET") {
      requireAdmin(session);
      const data = await listAdminNotificationsPg(getPostgresPool());
      return json(data);
    }

    if (url.pathname === "/api/selfhost/admin/notifications/read" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return errorJson("Не указан id уведомления", 400);
      const result = await markAdminNotificationReadPg(getPostgresPool(), id);
      if (!result.found) return errorJson("Уведомление не найдено", 404);
      return json({ ok: true });
    }

    if (url.pathname === "/api/selfhost/admin/notifications/read-all" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const result = await markAllAdminNotificationsReadPg(getPostgresPool());
      return json(result);
    }

    {
      const delAdminNotif = url.pathname.match(/^\/api\/selfhost\/admin\/notifications\/([^/]+)$/);
      if (delAdminNotif && request.method === "DELETE") {
        requireAdmin(session);
        assertCsrf(request);
        await deleteAdminNotificationPg(getPostgresPool(), delAdminNotif[1]);
        return json({ ok: true });
      }
    }

    {
      const leadStatusMatch = url.pathname.match(
        /^\/api\/selfhost\/admin\/leads\/([^/]+)\/status$/,
      );
      if (leadStatusMatch && request.method === "POST") {
        requireAdmin(session);
        assertCsrf(request);
        const id = leadStatusMatch[1];
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          return errorJson("Некорректный id заявки", 400);
        }
        const body = await readJson(request);
        const status = leadStatusSchema.parse(body.status);
        const lead = await updateLeadStatusPg(getPostgresPool(), id, status);
        return json({ ok: true, lead });
      }
    }

    if (url.pathname === "/api/selfhost/admin/promos" && request.method === "POST") {
      requireAdmin(session);
      assertCsrf(request);
      const body = await readJson(request);
      const parsed = adminCreatePromosSchema.parse(body);
      const codes = await createPromoCodesPg(getPostgresPool(), parsed, session.userId);
      return json({ ok: true, codes });
    }

    {
      const revokeMatch = url.pathname.match(/^\/api\/selfhost\/admin\/promos\/([^/]+)\/revoke$/);
      if (revokeMatch && request.method === "POST") {
        requireAdmin(session);
        assertCsrf(request);
        const id = revokeMatch[1];
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          return errorJson("Некорректный id промокода", 400);
        }
        await revokePromoCodePg(getPostgresPool(), id);
        return json({ ok: true });
      }
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

      if (action === "password" && request.method === "POST") {
        assertCsrf(request);
        const body = await readJson(request);
        await adminClients().setPassword(clientId, adminClientPasswordSchema.parse(body));
        return json({ ok: true });
      }

      if (action === "archive" && request.method === "POST") {
        assertCsrf(request);
        await adminClients().archive(clientId, session.userId);
        return json({ ok: true });
      }

      if (action === "restore" && request.method === "POST") {
        assertCsrf(request);
        await adminClients().restore(clientId);
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
    const pg = error as { code?: string; message?: string; statusCode?: number; name?: string };
    if (
      !pg.statusCode &&
      (pg.name === "InvalidIngredientGramsError" ||
        /некорректн.*граммовк|не может быть сохран/i.test(String(pg.message ?? "")))
    ) {
      return errorJson(pg.message ?? "Некорректные граммовки", 400);
    }
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
