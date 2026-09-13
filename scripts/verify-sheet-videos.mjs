/**
 * Проверка видео-ссылок из panova-exercises.json (YouTube / Rutube embed).
 * node scripts/verify-sheet-videos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVideoEmbedUrl } from "./exercises-sheet.lib.mjs";
import { collectExercisesFromTabsDir } from "./collect-panova-exercises.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, "panova-exercises.json");
const tabsDir = path.join(__dirname, "_sheet_tabs");

let exercises;
if (fs.existsSync(tabsDir) && fs.readdirSync(tabsDir).some((f) => f.endsWith(".csv"))) {
  exercises = collectExercisesFromTabsDir(tabsDir).exercises;
} else {
  exercises = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

let ok = 0;
let bad = 0;

for (const ex of exercises) {
  const embed = getVideoEmbedUrl(ex.video_url);
  if (!embed) {
    console.log(`✗ ${ex.name}: не удалось построить embed`);
    console.log(`  ${ex.video_url}`);
    bad++;
    continue;
  }
  ok++;
}

console.log(`\nИтого: ${ok} с embed, ${bad} без embed из ${exercises.length}`);
process.exit(bad > 0 ? 1 : 0);
