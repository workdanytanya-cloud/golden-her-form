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
  const { setNutritionProgressSink } = await import("@/lib/nutrition-constructor/nutrition-progress");

  process.on("message", (message: { body?: unknown }) => {
    void (async () => {
      let stage = "Подготовка каталога";
      let progress = 1;
      setNutritionProgressSink((update) => {
        stage = update.stage;
        progress = update.progress;
        process.send?.({ type: "progress", ...update });
      });
      const beat = setInterval(() => {
        process.send?.({ type: "progress", stage, progress });
      }, 4000);
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
        clearInterval(beat);
        process.exit(0);
      }
    })();
  });
}
