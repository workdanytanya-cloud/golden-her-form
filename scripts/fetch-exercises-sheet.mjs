/**
 * Скачать все вкладки Google Sheet тренера → scripts/_sheet_tabs/
 * Таблица: доступ по ссылке «Просматривающий»
 *
 * node scripts/fetch-exercises-sheet.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COACH_SHEET_ID, COACH_SHEET_URL } from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "_sheet_tabs");
fs.mkdirSync(outDir, { recursive: true });

const htmlview = `https://docs.google.com/spreadsheets/d/${COACH_SHEET_ID}/htmlview`;
console.log(`Discovering tabs via ${htmlview}`);
const htmlRes = await fetch(htmlview, { redirect: "follow" });
const html = await htmlRes.text();
const gids = [...new Set([...html.matchAll(/gid[=:\\"]+(\d+)/g)].map((m) => m[1]))];
if (!gids.includes("0")) gids.unshift("0");

console.log(`Found ${gids.length} tab ids`);

let ok = 0;
for (const gid of gids) {
  const url = `https://docs.google.com/spreadsheets/d/${COACH_SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text();
  if (!res.ok || text.includes("<!DOCTYPE html") || text.includes("accounts.google.com")) {
    console.warn(`skip gid=${gid} status=${res.status}`);
    continue;
  }
  fs.writeFileSync(path.join(outDir, `gid-${gid}.csv`), text.replace(/^\uFEFF/, ""), "utf8");
  const videos = (text.match(/youtu\.be\/|youtube\.com\/|rutube\.ru\//gi) || []).length;
  console.log(`✓ gid=${gid} lines=${text.split(/\r?\n/).length} videos≈${videos}`);
  ok++;
}

if (ok === 0) {
  console.error(`
Не удалось скачать таблицу.

1. Откройте: ${COACH_SHEET_URL}
2. Поделиться → доступ по ссылке → Просматривающий
3. Запустите снова: node scripts/fetch-exercises-sheet.mjs
`);
  process.exit(1);
}

// Основной каталог (gid 0) → exercises-sheet.csv для совместимости
const main = path.join(outDir, "gid-0.csv");
if (fs.existsSync(main)) {
  fs.copyFileSync(main, path.join(__dirname, "exercises-sheet.csv"));
  console.log("Copied gid-0 → exercises-sheet.csv");
}

console.log(`\nDone: ${ok} tabs in ${outDir}`);
console.log("Next: node scripts/collect-panova-exercises.mjs && node scripts/generate-exercises-from-sheet.mjs");
