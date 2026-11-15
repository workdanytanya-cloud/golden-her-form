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
  startedAt: number | null;
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
  compute: (body: Body, signal: AbortSignal) => Promise<NutritionComputePayload>;
  save: (body: Body, payload: NutritionComputePayload) => Promise<Record<string, unknown>>;
  timeoutMs?: number;
  maxActive?: number;
  now?: () => number;
  createId?: () => string;
}) {
  const timeoutMs = options.timeoutMs ?? NUTRITION_JOB_TIMEOUT_MS;
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

  function view(job: JobRecord<Body>): NutritionJobView {
    const showResult = job.status === "completed" && job.result != null;
    return {
      job_id: job.job_id,
      status: job.status,
      progress: job.progress,
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
        job.progress = Math.min(
          95,
          Math.max(1, Math.round(((current - job.startedAt) / timeoutMs) * 100)),
        );
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
    job.progress = 1;
    ensureProgressTimer();
    const timer = setTimeout(() => {
      job.timedOut = true;
      job.abort.abort();
    }, timeoutMs);
    try {
      const payload = await options.compute(job.body, job.abort.signal);
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
        job.result = unsavedResult(
          payload,
          job.body.rebuild ? decision.message : payload.generated.message || decision.message,
        );
        job.status = "completed";
        job.progress = 100;
        return;
      }
      job.saving = true;
      job.result = await options.save(job.body, payload);
      job.status = "completed";
      job.progress = 100;
    } catch (error) {
      if (job.cancelRequested || (error as { code?: string }).code === "CANCELLED") {
        job.status = "cancelled";
        job.progress = 100;
        job.error = { code: "CANCELLED", message: "Расчёт отменён. Черновик не изменён." };
        return;
      }
      const timedOut = job.timedOut || (error as { code?: string }).code === "TIMEOUT";
      job.status = "failed";
      job.progress = 100;
      job.error = timedOut
        ? {
            code: "TIMEOUT",
            message: "Расчёт рациона прерван по времени. Прежний черновик сохранён.",
          }
        : {
            code: "GENERATE_FAILED",
            message:
              error instanceof Error && error.message
                ? error.message
                : "Не удалось рассчитать рацион. Черновик не изменён.",
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
        startedAt: null,
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
        job.error = { code: "CANCELLED", message: "Расчёт отменён. Черновик не изменён." };
      }
      return view(job);
    },
  };
}
