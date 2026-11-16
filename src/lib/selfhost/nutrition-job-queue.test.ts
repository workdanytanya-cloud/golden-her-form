import { describe, expect, it, vi } from "vitest";
import {
  createNutritionJobQueue,
  nutritionSaveDecision,
  type NutritionComputePayload,
} from "@/lib/selfhost/nutrition-job-queue";

function payload(
  partial: Partial<NutritionComputePayload["generated"]> = {},
): NutritionComputePayload {
  return {
    generated: {
      is_valid: true,
      days: [{ day_index: 0 }],
      message: "ok",
      ...partial,
    },
    changed: 4,
    total: 4,
    hadDraft: false,
  };
}

describe("nutrition job queue", () => {
  it("returns the same job when the course already has an active calculation", async () => {
    let release: (value: NutritionComputePayload) => void = () => {};
    const compute = vi.fn(
      () =>
        new Promise<NutritionComputePayload>((resolve) => {
          release = resolve;
        }),
    );
    const save = vi.fn(async () => ({ saved: true }));
    const queue = createNutritionJobQueue({ compute, save });
    const body = {
      clientId: "11111111-1111-4111-8111-111111111111",
      courseId: "22222222-2222-4222-8222-222222222222",
    };
    const first = queue.enqueue(body);
    const second = queue.enqueue({ ...body, rebuild: true });
    expect(second.job_id).toBe(first.job_id);
    expect(compute).toHaveBeenCalledTimes(1);
    release(payload());
    await vi.waitFor(() => expect(queue.get(first.job_id)?.status).toBe("completed"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("refuses a third active job", () => {
    const queue = createNutritionJobQueue({
      compute: () => new Promise(() => {}),
      save: vi.fn(),
      maxActive: 2,
    });
    queue.enqueue({ clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", courseId: null });
    queue.enqueue({ clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", courseId: null });
    expect(() =>
      queue.enqueue({ clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", courseId: null }),
    ).toThrow(/Слишком много расчётов/);
  });

  it("does not save the draft when generation fails or times out", async () => {
    const save = vi.fn();
    const failed = createNutritionJobQueue({
      compute: async () => {
        throw new Error("каталог недоступен");
      },
      save,
    });
    const failedJob = failed.enqueue({
      clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      courseId: null,
    });
    await vi.waitFor(() => expect(failed.get(failedJob.job_id)?.status).toBe("failed"));
    expect(failed.get(failedJob.job_id)?.error?.message).toMatch(/каталог недоступен/);
    expect(save).not.toHaveBeenCalled();

    const timed = createNutritionJobQueue({
      compute: (_body, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("abort"), { code: "TIMEOUT" })),
          );
        }),
      save,
      timeoutMs: 20,
    });
    const timedJob = timed.enqueue({
      clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      courseId: null,
    });
    await vi.waitFor(() => expect(timed.get(timedJob.job_id)?.status).toBe("failed"));
    expect(timed.get(timedJob.job_id)?.error?.code).toBe("timeout");
    expect(save).not.toHaveBeenCalled();
  });

  it("does not save a partial or invalid ration", async () => {
    const save = vi.fn();
    const queue = createNutritionJobQueue({
      compute: async () =>
        payload({ is_valid: false, days: [{ day_index: 0 }], message: "неполный" }),
      save,
    });
    const job = queue.enqueue({ clientId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", courseId: null });
    await vi.waitFor(() => expect(queue.get(job.job_id)?.status).toBe("completed"));
    expect(save).not.toHaveBeenCalled();
    expect(queue.get(job.job_id)?.result).toMatchObject({ saved: false });
  });

  it("cancels a queued job before it starts", async () => {
    const save = vi.fn();
    const compute = vi.fn(() => new Promise<NutritionComputePayload>(() => {}));
    const queue = createNutritionJobQueue({ compute, save, maxActive: 2 });
    queue.enqueue({ clientId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", courseId: null });
    const queued = queue.enqueue({
      clientId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      courseId: null,
    });
    expect(queued.status).toBe("queued");
    const cancelled = queue.cancel(queued.job_id);
    expect(cancelled?.status).toBe("cancelled");
    expect(save).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("names cancel, restart, variety and a lost worker separately", async () => {
    const save = vi.fn();
    const cancelled = createNutritionJobQueue({
      compute: (_body, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("stop"), { code: "aborted" })));
      }),
      save,
    });
    const running = cancelled.enqueue({
      clientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      courseId: null,
    });
    await vi.waitFor(() => expect(cancelled.get(running.job_id)?.status).toBe("running"));
    expect(cancelled.cancel(running.job_id)?.error?.code).toBe("cancelled_by_user");

    const restarted = createNutritionJobQueue({
      compute: async () => {
        throw Object.assign(new Error("процесс закрылся"), { code: "worker_restart" });
      },
      save,
    });
    const restartJob = restarted.enqueue({
      clientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      courseId: null,
    });
    await vi.waitFor(() => expect(restarted.get(restartJob.job_id)?.status).toBe("failed"));
    expect(restarted.get(restartJob.job_id)?.error?.code).toBe("worker_restart");

    const variety = createNutritionJobQueue({
      compute: async () =>
        payload({
          is_valid: false,
          days: [],
          reason_code: "INSUFFICIENT_VARIETY",
          message: "Точных дней без повтора блюда: 7 из 28",
        }),
      save,
    });
    const varietyJob = variety.enqueue({
      clientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
      courseId: null,
    });
    await vi.waitFor(() => expect(variety.get(varietyJob.job_id)?.status).toBe("failed"));
    expect(variety.get(varietyJob.job_id)?.error?.code).toBe("insufficient_variety");

    const lost = createNutritionJobQueue({
      compute: () => new Promise(() => {}),
      save,
      leaseMs: 20,
    });
    const lostJob = lost.enqueue({
      clientId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
      courseId: null,
    });
    await vi.waitFor(() => expect(lost.get(lostJob.job_id)?.error?.code).toBe("lease_expired"), {
      timeout: 4000,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps an invalid result out of the draft decision", () => {
    expect(
      nutritionSaveDecision({ rebuild: false }, payload({ is_valid: false, days: [] })).save,
    ).toBe(false);
  });
});
