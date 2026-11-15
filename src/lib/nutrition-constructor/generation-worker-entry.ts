import { setPriority } from "node:os";

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

if (process.env.NUTRITION_WORKER === "1") {
  try {
    setPriority(10);
  } catch {
    // Отдельный процесс уже не занимает цикл основного Node.
  }

  const { computeNutritionGenerate } = await import("@/lib/selfhost/nutrition-generate-service");

  process.on("message", (message: { body?: unknown }) => {
    void (async () => {
      try {
        const payload = await computeNutritionGenerate(message?.body);
        const safe = JSON.parse(JSON.stringify(payload)) as unknown;
        process.send?.({ ok: true, payload: safe });
      } catch (error) {
        const messageText = redact(
          error instanceof Error ? error.message : "Не удалось рассчитать рацион",
        );
        process.send?.({ ok: false, message: messageText });
      } finally {
        process.exit(0);
      }
    })();
  });
}
