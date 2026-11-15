import { setPriority } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  setPriority(10);
} catch {
  // Пониженный приоритет недоступен: процесс всё равно отдельный от SSR.
}

const bundle = pathToFileURL(path.resolve(process.cwd(), "selfhost/nutrition-worker/index.mjs")).href;
await import(bundle);
