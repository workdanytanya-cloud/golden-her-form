import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNutritionJobQueue,
  type NutritionComputePayload,
} from "@/lib/selfhost/nutrition-job-queue";
import {
  saveNutritionGenerateResult,
  type NutritionGenerateBody,
} from "@/lib/selfhost/nutrition-generate-service";

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

export function resolveNutritionWorkerEntry(): { entry: string; execArgv: string[] } {
  const builtBoot = path.resolve(process.cwd(), "selfhost/nutrition-worker-boot.mjs");
  const builtBundle = path.resolve(process.cwd(), "selfhost/nutrition-worker/index.mjs");
  if (!process.env.VITEST && existsSync(builtBoot) && existsSync(builtBundle)) {
    return { entry: builtBoot, execArgv: [] };
  }
  const source = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../nutrition-constructor/generation-worker-entry.ts",
  );
  return { entry: source, execArgv: ["--import", "tsx"] };
}

export function forkNutritionCompute(
  body: NutritionGenerateBody,
  signal: AbortSignal,
  report?: (update: { stage: string; progress: number; found?: number; total?: number }) => void,
): Promise<NutritionComputePayload> {
  const { entry, execArgv } = resolveNutritionWorkerEntry();
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NUTRITION_WORKER: "1" };
    delete env.NODE_OPTIONS;
    delete env.VITEST;
    const child: ChildProcess = fork(entry, [], {
      execArgv,
      env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let settled = false;
    let stderr = "";
    const finish = (error?: Error, payload?: NutritionComputePayload) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(payload as NutritionComputePayload);
    };
    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Процесс уже завершился.
      }
    };
    const onAbort = () => {
      kill();
      finish(Object.assign(new Error("Расчёт остановлен"), { code: "aborted" }));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = redact(`${stderr}${String(chunk)}`).slice(-400);
    });
    child.on(
      "message",
      (message: {
        type?: string;
        ok?: boolean;
        payload?: NutritionComputePayload;
        message?: string;
        stage?: string;
        progress?: number;
        found?: number;
        total?: number;
      }) => {
        if (message?.type === "progress" && message.stage) {
          report?.({
            stage: message.stage,
            progress: message.progress ?? 0,
            found: message.found,
            total: message.total,
          });
          return;
        }
        if (message?.ok && message.payload) finish(undefined, message.payload);
        else
          finish(new Error(redact(message?.message || "Расчёт рациона завершился без результата")));
      },
    );
    child.on("error", (error) => {
      finish(new Error(redact(error.message)));
    });
    child.on("exit", (code) => {
      if (settled || signal.aborted) return;
      const detail = stderr ? ` ${stderr}` : "";
      finish(
        Object.assign(
          new Error(
            redact(
              code === 0
                ? "Процесс расчёта закрылся без ответа"
                : `Процесс расчёта завершился с кодом ${code ?? "unknown"}.${detail}`,
            ),
          ),
          { code: "worker_restart" },
        ),
      );
    });
    child.send({ body });
  });
}

export const nutritionJobs = createNutritionJobQueue<NutritionGenerateBody>({
  compute: forkNutritionCompute,
  save: saveNutritionGenerateResult,
});
