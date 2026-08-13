/**
 * Собирает уникальные упражнения из всех вкладок Google Sheet тренера.
 * Форматы разные: библиотека, 4-недельные блоки, списки name+url.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classifyExercise,
  parseCsv,
  parseTiming,
  slugify,
} from "./exercises-sheet.lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tabsDir = path.join(__dirname, "_sheet_tabs");

const VIDEO_RE =
  /https?:\/\/(?:www\.)?(?:youtu\.be\/[\w-]+|youtube\.com\/(?:watch\?v=|shorts\/|embed\/)[\w-]+|rutube\.ru\/video\/(?:private\/)?[a-f0-9]+\/?(?:\?[^\s,]*)?)/i;

function normalizeVideoUrl(raw) {
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
    .replace(/^[0-9️⃣▪️🟥🟧\s.\-–—]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkName(name) {
  if (!name || name.length < 2) return true;
  if (/^https?:\/\//i.test(name)) return true;
  if (/^(неделя|тренировка|спина|грудь|ноги|ягодицы|целевая|упражнен|ссылка|день|подход|повторен|разминка\s*$|заминка\s*$)/i.test(name) && name.length < 12) {
    // keep exact Разминка/Заминка
  }
  if (/^(неделя\s*\d|тренировка\s*\d|целевая группа|упражнения|ссылка|день\s*\d|старые видео|новые видео)/i.test(name))
    return true;
  if (/^[▪️🟥🟧1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣]+$/u.test(name)) return true;
  if (/^переснять$/i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  return false;
}

function lookLikeTiming(s) {
  return /\d+\s*подход|\d+\s*повтор|\d+\s*мин|\d+\s*сек|разминка|заминка/i.test(s);
}

/**
 * Из произвольной CSV-ячейки: пары (имя, url) эвристикой.
 * - name,url в соседних колонках
 * - url над/под именем
 */
function extractPairsFromTable(rows, { tabLabel }) {
  /** @type {{name:string, video:string, timing:string|null, group:string|null}[]} */
  const pairs = [];
  let currentGroup = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] || "").trim();
      if (!cell) continue;

      // section headers without video
      if (
        !VIDEO_RE.test(cell) &&
        /^(ноги|ягодиц|спина|грудь|руки|плечи|пресс|кор|бег|низ|верх)/i.test(cell) &&
        cell.length < 40
      ) {
        currentGroup = cleanName(cell);
      }

      const video = normalizeVideoUrl(cell);
      if (!video) continue;

      // Prefer name in same row left, then right, then next row same col / left
      const candidates = [];
      if (c > 0) candidates.push(row[c - 1]);
      if (c + 1 < row.length) candidates.push(row[c + 1]);
      if (r + 1 < rows.length) {
        candidates.push(rows[r + 1][c]);
        if (c > 0) candidates.push(rows[r + 1][c - 1]);
        if (c + 1 < rows[r + 1].length) candidates.push(rows[r + 1][c + 1]);
      }
      if (r + 2 < rows.length) {
        candidates.push(rows[r + 2][c]);
        if (c > 0) candidates.push(rows[r + 2][c - 1]);
      }

      let name = null;
      let timing = null;
      for (const cand of candidates) {
        const n = cleanName(cand);
        if (!n || isJunkName(n)) continue;
        if (lookLikeTiming(n) && !name) {
          timing = n;
          continue;
        }
        if (VIDEO_RE.test(n)) continue;
        if (!name) name = n;
        else if (!timing && lookLikeTiming(n)) timing = n;
      }

      // Catalog format: col1 name, col2 video (gid 0)
      if (!name && c >= 1) {
        const left = cleanName(row[c - 1]);
        if (left && !isJunkName(left) && !VIDEO_RE.test(left)) name = left;
      }

      if (!name) {
        // last resort: slug from video id
        name = `Упражнение ${video.split("/").pop()}`;
      }

      pairs.push({
        name,
        video,
        timing,
        group: currentGroup,
        tab: tabLabel,
      });
    }
  }
  return pairs;
}

function mergeExercises(allPairs) {
  /** @type {Map<string, any>} */
  const byVideo = new Map();

  for (const p of allPairs) {
    const key = p.video.toLowerCase();
    const existing = byVideo.get(key);
    const meta = classifyExercise(p.name);
    if (p.group) {
      // refine category from group
      const g = p.group.toLowerCase();
      if (/ног|ягодиц/.test(g)) {
        meta.category = "strength_lower";
        meta.muscles = ["ягодицы", "квадрицепс", "задняя поверхность бедра"];
      } else if (/спин/.test(g)) {
        meta.category = "strength_upper";
        meta.muscles = ["спина"];
      } else if (/груд/.test(g)) {
        meta.category = "strength_upper";
        meta.muscles = ["грудные"];
      } else if (/пресс|кор/.test(g)) {
        meta.category = "core";
        meta.muscles = ["кор", "пресс"];
      }
    }

    // Prefer human names over "Упражнение xyz"
    const preferName =
      !existing ||
      (existing.name.startsWith("Упражнение ") && !p.name.startsWith("Упражнение ")) ||
      (p.name.length > existing.name.length && !p.name.startsWith("Упражнение "));

    if (!existing) {
      const timingParsed = parseTiming(p.timing || "");
      byVideo.set(key, {
        name: p.name.replace(/\s+/g, " ").trim(),
        video_url: p.video,
        ...meta,
        default_sets: timingParsed.sets,
        default_reps: timingParsed.reps,
        rest_seconds: timingParsed.rest,
        timingNote: p.timing,
        sources: [p.tab],
        groups: p.group ? [p.group] : [],
      });
    } else {
      if (preferName) existing.name = p.name.replace(/\s+/g, " ").trim();
      if (p.timing && !existing.timingNote) {
        existing.timingNote = p.timing;
        const t = parseTiming(p.timing);
        existing.default_sets = t.sets;
        existing.default_reps = t.reps;
        existing.rest_seconds = t.rest;
      }
      if (!existing.sources.includes(p.tab)) existing.sources.push(p.tab);
      if (p.group && !existing.groups.includes(p.group)) existing.groups.push(p.group);
    }
  }

  const used = new Set();
  const out = [];
  for (const ex of byVideo.values()) {
    let base = `sheet-${slugify(ex.name) || "exercise"}`;
    let s = base;
    let i = 2;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);

    const tags = new Set(ex.tags || []);
    tags.add("sheet");
    tags.add("panova");
    tags.add("home");
    if (/прыж|jump|табата/i.test(ex.name)) {
      tags.add("jumping");
      tags.add("high_impact");
    } else {
      tags.add("low_impact");
    }

    if (/разминк/i.test(ex.name)) {
      ex.category = "warmup";
      tags.add("warmup");
    }
    if (/заминк/i.test(ex.name)) {
      ex.category = "cooldown";
      tags.add("cooldown");
    }

    const description = [
      "Упражнение из личной библиотеки тренера.",
      ex.timingNote ? `Ориентир: ${ex.timingNote}.` : null,
      ex.groups.length ? `Группа: ${ex.groups.join(", ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    out.push({
      slug: s,
      name: ex.name,
      category: ex.category,
      muscle_groups: ex.muscles,
      equipment: ex.equipment,
      difficulty: ex.difficulty,
      tags: [...tags],
      description,
      cues: ["Смотрите технику на видео тренера", "Дышите ровно, без задержек"],
      common_mistakes: ["Спешка и потеря контроля", "Выполнение через боль"],
      video_url: ex.video_url,
      default_sets: ex.default_sets,
      default_reps: ex.default_reps,
      tempo: null,
      rest_seconds: ex.rest_seconds,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
}

export function collectExercisesFromTabsDir(dir = tabsDir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Нет папки ${dir}. Сначала скачайте вкладки.`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));
  const allPairs = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const rows = parseCsv(text);
    const pairs = extractPairsFromTable(rows, { tabLabel: file });
    allPairs.push(...pairs);
  }
  return { pairs: allPairs, exercises: mergeExercises(allPairs) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pairs, exercises } = collectExercisesFromTabsDir();
  console.log(`Pairs found: ${pairs.length}`);
  console.log(`Unique exercises: ${exercises.length}`);
  const out = path.join(__dirname, "panova-exercises.json");
  fs.writeFileSync(out, JSON.stringify(exercises, null, 2), "utf8");
  console.log(`Wrote ${out}`);
  for (const ex of exercises.slice(0, 30)) {
    console.log(`- [${ex.category}] ${ex.name} → ${ex.video_url}`);
  }
  if (exercises.length > 30) console.log(`… +${exercises.length - 30} more`);
}
