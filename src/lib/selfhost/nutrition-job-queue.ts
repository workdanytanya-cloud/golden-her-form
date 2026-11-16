import { rebuildSaveDecision } from "@/lib/nutrition-constructor/meal-replace";

export const NUTRITION_JOB_TIMEOUT_MS = 180_000;
export const NUTRITION_MAX_ACTIVE_JOBS = 2;

export type NutritionJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type NutritionJobError = { message: string; code: string };

export type NutritionGenerateJobBody = {
  clientId?: string;
  courseId?: string | null;
  rebuild?: boolean;
};

export type NutritionComputePayload = {
  generated: {
    is_valid?: boolean;
    days?: unknown[];
    message?: string;
    [key: string]: unknown;
  };
  changed: number;
  total: number;
  hadDraft: boolean;
};

export type NutritionJobView = {
  job_id: string;
  status: NutritionJobStatus;
  progress: number;
  current_stage: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  error_code: string | null;
  error_message: string | null;
  error: NutritionJobError | null;
  result?: Record<string, unknown>;
};

type JobRecord<Body> = {
  job_id: string;
  status: NutritionJobStatus;
  progress: number;
  clientId: string;
  courseId: string | null;
  body: Body;
  error: NutritionJobError | null;
  result: Record<string, unknown> | null;
  abort: AbortController;
  cancelRequested: boolean;
  saving: boolean;
  timedOut: boolean;
  leaseExpired: boolean;
  workerRestart: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  lastHeartbeatAt: number | null;
  stage: string | null;
};

export function nutritionSaveDecision(
  body: { rebuild?: boolean },
  payload: NutritionComputePayload,
): { save: boolean; success: boolean; message: string } {
  const days = payload.generated.days ?? [];
  const valid = Boolean(payload.generated.is_valid && days.length > 0);
  if (body.rebuild) {
    return rebuildSaveDecision({
      valid,
      changed: payload.changed,
      total: payload.total,
      hadDraft: payload.hadDraft,
    });
  }
  return {
    save: valid,
    success: valid,
    message: payload.generated.message ?? (valid ? "" : "Черновик не изменён."),
  };
}

function unsavedResult(payload: NutritionComputePayload, message: string): Record<string, unknown> {
  return {
    ...payload.generated,
    saved: false,
    changed: payload.changed,
    total: payload.total,
    message,
  };
}

export function createNutritionJobQueue<Body extends NutritionGenerateJobBody>(options: {
  compute: (
    body: Body,
    signal: AbortSignal,
    report?: (update: {
      stage: string;
      progress: number;
      found?: number;
      total?: number;
    }) => void,
  ) => Promise<NutritionComputePayload>;
  save: (body: Body, payload: NutritionComputePayload) => Promise<Record<string, unknown>>;
  timeoutMs?: number;
  leaseMs?: number;
  maxActive?: number;
  now?: () => number;
  createId?: () => string;
}) {
  const timeoutMs = options.timeoutMs ?? NUTRITION_JOB_TIMEOUT_MS;
  const leaseMs = options.leaseMs ?? 25_000;
  const maxActive = options.maxActive ?? NUTRITION_MAX_ACTIVE_JOBS;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const jobs = new Map<string, JobRecord<Body>>();
  let running = false;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  function courseOf(body: NutritionGenerateJobBody): { clientId: string; courseId: string | null } {
    if (!body.clientId) {
      throw Object.assign(new Error("Не указан clientId для расчёта рациона"), { statusCode: 400 });
    }
    return { clientId: body.clientId, courseId: body.courseId ?? null };
  }

  const iso = (value: number | null) => (value == null ? null : new Date(value).toISOString());

  function view(job: JobRecord<Body>): NutritionJobView {
    const showResult = job.status === "completed" && job.result != null;
    return {
      job_id: job.job_id,
      status: job.status,
      progress: job.progress,
      current_stage: job.stage,
      started_at: iso(job.startedAt),
      finished_at: iso(job.finishedAt),
      last_heartbeat_at: iso(job.lastHeartbeatAt),
      error_code: job.error?.code ?? null,
      error_message: job.error?.message ?? null,
      error: job.error,
      ...(showResult ? { result: job.result ?? undefined } : {}),
    };
  }

  function activeCount(): number {
    let count = 0;
    for (const job of jobs.values()) {
      if (job.status === "queued" || job.status === "running") count += 1;
    }
    return count;
  }

  function findActive(clientId: string, courseId: string | null): JobRecord<Body> | null {
    for (const job of jobs.values()) {
      if (job.clientId !== clientId || job.courseId !== courseId) continue;
      if (job.status === "queued" || job.status === "running") return job;
    }
    return null;
  }

  function ensureProgressTimer(): void {
    if (progressTimer) return;
    progressTimer = setInterval(() => {
      const current = now();
      let busy = false;
      for (const job of jobs.values()) {
        if (job.status !== "running" || job.startedAt == null) continue;
        busy = true;
        if (job.stage == null) {
          job.progress = Math.min(
            95,
            Math.max(job.progress, Math.round(((current - job.startedAt) / timeoutMs) * 100)),
          );
        }
        const heartbeat = job.lastHeartbeatAt ?? job.startedAt;
        if (!job.leaseExpired && current - heartbeat > leaseMs) {
          job.leaseExpired = true;
          job.status = "failed";
          job.progress = 100;
          job.finishedAt = current;
          job.error = {
            code: "lease_expired",
            message: "Расчёт перестал отвечать и был остановлен. Черновик не изменён.",
          };
          job.abort.abort();
        }
      }
      if (!busy && progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    }, 1000);
    if (typeof progressTimer === "object" && progressTimer && "unref" in progressTimer) {
      progressTimer.unref();
    }
  }

  function pump(): void {
    if (running) return;
    const next = [...jobs.values()].find((job) => job.status === "queued");
    if (!next) return;
    running = true;
    void runJob(next).finally(() => {
      running = false;
      pump();
    });
  }

  async function runJob(job: JobRecord<Body>): Promise<void> {
    if (job.status !== "queued") return;
    job.status = "running";
    job.startedAt = now();
    job.lastHeartbeatAt = now();
    job.stage = "Подготовка каталога";
    job.progress = 1;
    ensureProgressTimer();
    const timer = setTimeout(() => {
      job.timedOut = true;
      job.abort.abort();
    }, timeoutMs);
    try {
      const payload = await options.compute(job.body, job.abort.signal, (update) => {
        if (job.status !== "running") return;
        job.lastHeartbeatAt = now();
        if (update.stage) job.stage = update.stage;
        if (typeof update.progress === "number") job.progress = update.progress;
        if (update.found != null && update.total != null) {
          job.stage = `${update.stage}: ${update.found} из ${update.total}`;
        }
      });
      if (job.status !== "running") return;
      if (job.cancelRequested || job.timedOut || job.abort.signal.aborted) {
        throw Object.assign(new Error("cancelled"), {
          code: job.cancelRequested ? "CANCELLED" : "TIMEOUT",
        });
      }
      const decision = nutritionSaveDecision(job.body, payload);
      if (job.cancelRequested || job.timedOut) {
        throw Object.assign(new Error("cancelled"), {
          code: job.cancelRequested ? "CANCELLED" : "TIMEOUT",
        });
      }
      if (!decision.save) {
        const reason = String(payload.generated.reason_code ?? "");
        if (reason === "INSUFFICIENT_VARIETY" || reason === "TIMEOUT" || reason === "INFEASIBLE") {
          job.status = "failed";
          job.progress = 100;
          job.finishedAt = now();
          job.error = {
            code:
              reason === "TIMEOUT"
                ? "timeout"
                : reason === "INSUFFICIENT_VARIETY"
                  ? "insufficient_variety"
                  : "generation_failed",
            message:
              payload.generated.message ||
              (reason === "TIMEOUT"
                ? "Расчёт прерван по времени. Прежний черновик сохранён."
                : "Не удалось рассчитать рацион. Черновик не изменён."),
          };
          return;
        }
        job.result = unsavedResult(
          payload,
          job.body.rebuild ? decision.message : payload.generated.message || decision.message,
        );
        job.status = "completed";
        job.progress = 100;
        job.finishedAt = now();
        job.stage = "Сохранение черновика";
        return;
      }
      job.saving = true;
      job.stage = "Сохранение черновика";
      job.result = await options.save(job.body, payload);
      job.status = "completed";
      job.progress = 100;
      job.finishedAt = now();
    } catch (error) {
      const code = (error as { code?: string }).code;
      job.progress = 100;
      job.finishedAt = now();
      if (job.cancelRequested || code === "cancelled_by_user") {
        job.status = "cancelled";
        job.error = {
          code: "cancelled_by_user",
          message: "Расчёт отменён. Черновик не изменён.",
        };
        return;
      }
      if (job.leaseExpired || code === "lease_expired") {
        job.status = "failed";
        job.error = {
          code: "lease_expired",
          message: "Расчёт перестал отвечать и был остановлен. Черновик не изменён.",
        };
        return;
      }
      if (job.timedOut || code === "timeout" || code === "TIMEOUT") {
        job.status = "failed";
        job.error = {
          code: "timeout",
          message: "Расчёт прерван по времени. Прежний черновик сохранён.",
        };
        return;
      }
      if (job.workerRestart || code === "worker_restart") {
        job.status = "failed";
        job.error = {
          code: "worker_restart",
          message: "Процесс расчёта остановился. Черновик не изменён.",
        };
        return;
      }
      const message = error instanceof Error ? error.message : "";
      job.status = "failed";
      job.error = /INSUFFICIENT_VARIETY|не хватило разных|без повтора/i.test(message)
        ? {
            code: "insufficient_variety",
            message: message || "Не хватило разных блюд. Черновик не изменён.",
          }
        : {
            code: "generation_failed",
            message: message || "Не удалось рассчитать рацион. Черновик не изменён.",
          };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enqueue(body: Body): NutritionJobView {
      const scope = courseOf(body);
      const existing = findActive(scope.clientId, scope.courseId);
      if (existing) return view(existing);
      if (activeCount() >= maxActive) {
        throw Object.assign(new Error("Слишком много расчётов. Дождитесь завершения текущего."), {
          statusCode: 429,
          code: "JOB_LIMIT",
        });
      }
      const job: JobRecord<Body> = {
        job_id: createId(),
        status: "queued",
        progress: 0,
        clientId: scope.clientId,
        courseId: scope.courseId,
        body,
        error: null,
        result: null,
        abort: new AbortController(),
        cancelRequested: false,
        saving: false,
        timedOut: false,
        leaseExpired: false,
        workerRestart: false,
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        stage: null,
      };
      jobs.set(job.job_id, job);
      pump();
      return view(job);
    },
    get(jobId: string): NutritionJobView | null {
      const job = jobs.get(jobId);
      return job ? view(job) : null;
    },
    active(clientId: string, courseId?: string | null): NutritionJobView | null {
      const job = findActive(clientId, courseId ?? null);
      return job ? view(job) : null;
    },
    cancel(jobId: string): NutritionJobView | null {
      const job = jobs.get(jobId);
      if (!job) return null;
      if ((job.status === "queued" || job.status === "running") && !job.saving) {
        job.cancelRequested = true;
        job.abort.abort();
        job.status = "cancelled";
        job.progress = 100;
        job.finishedAt = now();
        job.error = {
          code: "cancelled_by_user",
          message: "Расчёт отменён. Черновик не изменён.",
        };
      }
      return view(job);
    },
  };
}
