/**
 * Парсит 4-недельную вкладку (gid 37051087) → структура программы.
 * Колонки: Нед1 A–C | Нед2 D–F | Нед3 G–I | Нед4 J–L
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, slugify } from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIDEO_RE =
  /https?:\/\/(?:www\.)?(?:youtu\.be\/[\w-]+|youtube\.com\/(?:watch\?v=|shorts\/|embed\/)[\w-]+|rutube\.ru\/video\/(?:private\/)?[a-f0-9]+\/?(?:\?[^\s,]*)?)/i;

function normalizeYoutube(raw) {
  const m = String(raw).match(VIDEO_RE);
  if (!m) return null;
  let url = m[0].replace(/[.,;)\]]+$/, "");
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? `https://youtu.be/${id}` : null;
    }
    if (host.includes("youtube")) {
      const id =
        u.searchParams.get("v") ||
        u.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1];
      return id ? `https://youtu.be/${id}` : null;
    }
    return url;
  } catch {
    return null;
  }
}

function cleanName(raw) {
  return String(raw || "")
    .replace(/[\uFE0F]/g, "")
    .replace(/^[0-9️⃣▪️\s.\-–—]+/u, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSetsReps(text) {
  const t = (text || "").toLowerCase();
  const setsM = t.match(/(\d+)\s*подход/);
  const repsM =
    t.match(/по\s*(\d+\s*[-–]\s*\d+|\d+)\s*повтор/) ||
    t.match(/(\d+\s*[-–]\s*\d+|\d+)\s*повтор/) ||
    t.match(/по\s*(\d+)\s*сек/) ||
    t.match(/(\d+)\s*сек/);
  const sets = setsM ? Number(setsM[1]) : 3;
  let reps = "10-12";
  if (repsM) {
    reps = /сек/.test(t) ? `${repsM[1].replace(/\s/g, "")} сек` : repsM[1].replace(/\s/g, "");
  } else if (/разминк|заминк/.test(t)) {
    reps = "по видео";
  }
  return { sets, reps, rest_seconds: /разминк|заминк/.test(t) ? 0 : 45 };
}

/**
 * @returns {{ weeks: Array<{ weekIndex: number, workouts: Array<{ title: string, focus: string|null, exercises: Array<{name:string, video_url:string, sets:number, reps:string, rest_seconds:number, note:string|null}> }> }> }}
 */
export function parseFourWeekProgramCsv(text) {
  const rows = parseCsv(text);
  // week column starts: 0, 3, 6, 9
  const weekStarts = [0, 3, 6, 9];
  const weeks = weekStarts.map((start, weekIndex) => {
    /** @type {Array<{title:string, focus:string|null, items: any[]}>} */
    const workouts = [];
    let current = null;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const a = (row[start] || "").trim();
      const b = (row[start + 1] || "").trim();
      const c = (row[start + 2] || "").trim();

      const headerCell = `${a} ${b} ${c}`;
      if (/ТРЕНИРОВКА\s*1|спина\/ягодицы|ТРЕНИРОВКА\s*2|ноги\/ягодицы|ТРЕНИРОВКА\s*3/i.test(headerCell)) {
        const titleMatch = headerCell.match(/ТРЕНИРОВКА\s*(\d)/i);
        const title = titleMatch
          ? `Тренировка №${titleMatch[1]}`
          : /спина/i.test(headerCell)
            ? "Тренировка №1"
            : /ноги/i.test(headerCell)
              ? "Тренировка №2"
              : "Тренировка";
        current = {
          title,
          focus: headerCell.replace(/[🟥🟧\s]+/gu, " ").trim().slice(0, 80) || null,
          items: [],
        };
        workouts.push(current);
        continue;
      }

      if (!current) continue;

      const video = normalizeYoutube(a) || normalizeYoutube(b) || normalizeYoutube(c);
      if (video) {
        // name usually on next row in col start+2 or start
        let name = "";
        for (let k = 1; k <= 3 && r + k < rows.length; k++) {
          const nr = rows[r + k];
          const candidates = [nr[start + 2], nr[start], nr[start + 1]].map(cleanName);
          for (const cand of candidates) {
            if (
              cand &&
              cand.length > 2 &&
              !VIDEO_RE.test(cand) &&
              !/подход|повтор|сек|▪️/.test(cand) &&
              !/^[1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣]+$/u.test(cand)
            ) {
              name = cand;
              break;
            }
          }
          if (name) break;
        }
        if (!name) name = `Упражнение ${video.split("/").pop()}`;

        let timing = "";
        for (let k = 1; k <= 4 && r + k < rows.length; k++) {
          const nr = rows[r + k];
          for (const col of [start, start + 1, start + 2]) {
            const cell = (nr[col] || "").trim();
            if (/подход|повтор|сек/i.test(cell)) {
              timing = cell.replace(/^▪️\s*/, "");
              break;
            }
          }
          if (timing) break;
        }

        const { sets, reps, rest_seconds } = parseSetsReps(timing);
        const isWarm = /разминк/i.test(name);
        const isCool = /заминк/i.test(name);
        current.items.push({
          name,
          video_url: video,
          sets: isWarm || isCool ? 1 : sets,
          reps: isWarm || isCool ? "по видео" : reps,
          rest_seconds: isWarm || isCool ? 0 : rest_seconds,
          note: timing || null,
          section: isWarm ? "warmup" : isCool ? "cooldown" : "exercises",
        });
      }
    }

    // Deduplicate consecutive same video within workout
    for (const w of workouts) {
      const seen = new Set();
      w.items = w.items.filter((it) => {
        const key = it.video_url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return {
      weekIndex,
      workouts: workouts.filter((w) => w.items.length > 0),
    };
  });

  return { weeks };
}

export function buildSlugForVideo(name, videoUrl, used) {
  let base = `sheet-${slugify(name) || "exercise"}`;
  // Prefer stable slug by video id when name is generic
  const id = videoUrl.split("/").pop();
  if (name.startsWith("Упражнение ") && id) base = `sheet-yt-${id}`;
  let s = base;
  let i = 2;
  while (used.has(s)) s = `${base}-${i++}`;
  used.add(s);
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const csvPath = path.join(__dirname, "_sheet_tabs", "gid-37051087.csv");
  const text = fs.readFileSync(csvPath, "utf8");
  const program = parseFourWeekProgramCsv(text);
  const out = path.join(__dirname, "panova-4week-program.json");
  fs.writeFileSync(out, JSON.stringify(program, null, 2), "utf8");
  console.log(`Wrote ${out}`);
  for (const w of program.weeks) {
    console.log(`\n=== Week ${w.weekIndex + 1}: ${w.workouts.length} workouts`);
    for (const wo of w.workouts) {
      console.log(`  ${wo.title}: ${wo.items.length} exercises`);
      for (const it of wo.items.slice(0, 4)) {
        console.log(`    - [${it.section}] ${it.name} (${it.sets}×${it.reps})`);
      }
      if (wo.items.length > 4) console.log(`    … +${wo.items.length - 4}`);
    }
  }
}
