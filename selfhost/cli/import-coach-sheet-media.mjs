/**
 * Standalone (no tsx path aliases) import for VDS staging/production.
 * Input: parsed-sheet-rows.json from scripts/_parse-coach-xlsx.mjs
 * Env: DATABASE_URL
 *
 * node selfhost/cli/import-coach-sheet-media.mjs --input=parsed-sheet-rows.json
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function loadEnvFiles() {
  const configuredFiles = (process.env.PANOVAPRO_ENV_FILES || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  if (process.env.PANOVAPRO_DATABASE_URL_FILE) {
    configuredFiles.push(path.resolve(process.env.PANOVAPRO_DATABASE_URL_FILE));
  }
  for (const rel of configuredFiles) {
    const p = path.resolve(rel);
    if (!fs.existsSync(p)) continue;
    if (path.resolve(process.env.PANOVAPRO_DATABASE_URL_FILE || ".") === p) {
      process.env.DATABASE_URL = fs.readFileSync(p, "utf8").trim();
      continue;
    }
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

loadEnvFiles();

const dryRun = process.argv.includes("--dry-run");
const inputArg = process.argv.find((a) => a.startsWith("--input="));
const inputPath = path.resolve(
  inputArg ? inputArg.slice("--input=".length) : path.join(root, "_tmp-exercise-videos/parsed-sheet-rows.json"),
);

function normalizeExerciseName(name) {
  return name
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/[ёЁ]/g, (ch) => (ch === "ё" ? "е" : "Е"))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.includes("youtube")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/);
      return m?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function rutubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "rutube.ru" && host !== "rutube.com") return null;
    const m =
      u.pathname.match(/\/video\/(?:private\/)?([a-f0-9]{32})\/?/i) ||
      u.pathname.match(/\/play\/embed\/([a-f0-9]{32})\/?/i);
    return m?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function normalizeVideo(url, title) {
  const yt = youtubeId(url);
  if (yt) {
    return {
      provider: "youtube",
      source_url: `https://www.youtube.com/watch?v=${yt}`,
      embed_url: `https://www.youtube.com/embed/${yt}`,
      title: title || null,
      status: "ok",
      fallback_text: null,
    };
  }
  const rt = rutubeId(url);
  if (rt) {
    let embed = `https://rutube.ru/play/embed/${rt}/`;
    try {
      const u = new URL(url);
      const p = u.searchParams.get("p");
      if (p) embed += `?p=${encodeURIComponent(p)}&skinColor=000000`;
      else embed += "?skinColor=000000";
    } catch {
      embed += "?skinColor=000000";
    }
    return {
      provider: "rutube",
      source_url: url,
      embed_url: embed,
      title: title || null,
      status: "ok",
      fallback_text: null,
    };
  }
  return null;
}

const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const byNorm = new Map();
let skippedNoName = 0;
for (const row of parsed.rows || []) {
  const name = (row.name || "").replace(/\s+/g, " ").trim();
  if (!name) {
    skippedNoName++;
    continue;
  }
  const norm = normalizeExerciseName(name);
  let b = byNorm.get(norm);
  if (!b) {
    b = { name, urls: new Map(), sheets: new Set(), idHint: row.idHint || null };
    byNorm.set(norm, b);
  }
  b.urls.set(row.url, (b.urls.get(row.url) || 0) + 1);
  b.sheets.add(row.sheet);
  if (!b.idHint && row.idHint) b.idHint = row.idHint;
}

const candidates = [];
const urlConflicts = [];
for (const b of byNorm.values()) {
  const ranked = [...b.urls.entries()].sort((a, c) => c[1] - a[1]);
  if (ranked.length > 1) urlConflicts.push({ name: b.name, urls: ranked.map(([u]) => u) });
  candidates.push({
    name: b.name,
    norm: normalizeExerciseName(b.name),
    url: ranked[0][0],
    idHint: b.idHint,
    sheets: [...b.sheets],
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

const beforePub = await pool.query(
  `SELECT count(*)::int AS n, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
   FROM public.training_program_versions WHERE status='published'`,
);
const beforeAll = await pool.query(
  `SELECT count(*)::int AS n, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
   FROM public.training_program_versions`,
);

const exRes = await pool.query(`SELECT id, name FROM public.exercises`);
const byId = new Map(exRes.rows.map((r) => [r.id.toLowerCase(), r]));
const nameIndex = new Map();
for (const row of exRes.rows) {
  const n = normalizeExerciseName(row.name);
  const list = nameIndex.get(n) || [];
  list.push(row);
  nameIndex.set(n, list);
}

const report = {
  sheetVideoCells: parsed.totalVideoCells || (parsed.rows || []).length,
  uniqueNames: candidates.length,
  skippedNoName,
  matched: 0,
  bindingsUpserted: 0,
  ambiguous: [],
  unmatched: [],
  unavailable: [],
  urlConflicts: urlConflicts.length,
};

for (const cand of candidates) {
  const video = normalizeVideo(cand.url, cand.name);
  if (!video) {
    report.unavailable.push({ name: cand.name, url: cand.url });
    continue;
  }
  let target = null;
  if (cand.idHint && byId.has(String(cand.idHint).toLowerCase())) {
    target = byId.get(String(cand.idHint).toLowerCase());
  } else {
    const hits = nameIndex.get(cand.norm) || [];
    if (hits.length === 1) target = hits[0];
    else if (hits.length > 1) {
      report.ambiguous.push({ name: cand.name, ids: hits.map((h) => h.id), sheets: cand.sheets });
      continue;
    }
  }
  if (!target) {
    report.unmatched.push({ name: cand.name, url: cand.url, sheets: cand.sheets });
    continue;
  }
  report.matched++;
  if (!dryRun) {
    const existing = await pool.query(
      `SELECT source_url FROM public.exercise_media_bindings WHERE exercise_id=$1`,
      [target.id],
    );
    const oldUrl = existing.rows[0]?.source_url ?? null;
    await pool.query(
      `INSERT INTO public.exercise_media_bindings
        (exercise_id, provider, source_url, embed_url, title, status, fallback_text, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
       ON CONFLICT (exercise_id) DO UPDATE SET
         provider=EXCLUDED.provider,
         source_url=EXCLUDED.source_url,
         embed_url=EXCLUDED.embed_url,
         title=EXCLUDED.title,
         status=EXCLUDED.status,
         fallback_text=EXCLUDED.fallback_text`,
      [
        target.id,
        video.provider,
        video.source_url,
        video.embed_url,
        video.title || target.name,
        video.status,
        video.fallback_text,
      ],
    );
    if (oldUrl !== video.source_url) {
      await pool.query(
        `INSERT INTO public.exercise_media_change_log (exercise_id, old_url, new_url, changed_by)
         VALUES ($1,$2,$3,NULL)`,
        [target.id, oldUrl, video.source_url],
      );
    }
  }
  report.bindingsUpserted++;
}

const afterPub = await pool.query(
  `SELECT count(*)::int AS n, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
   FROM public.training_program_versions WHERE status='published'`,
);
const afterAll = await pool.query(
  `SELECT count(*)::int AS n, md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
   FROM public.training_program_versions`,
);
const bindCount = await pool.query(
  `SELECT count(*)::int AS n FROM public.exercise_media_bindings WHERE coalesce(source_url,'')<>''`,
);

await pool.end();

const summary = {
  dryRun,
  ...report,
  ambiguous: report.ambiguous.length,
  unmatched: report.unmatched.length,
  unavailable: report.unavailable.length,
  ambiguousList: report.ambiguous,
  unmatchedSample: report.unmatched.slice(0, 40),
  bindingsInDb: bindCount.rows[0].n,
  publishedProgramsUnchanged:
    beforePub.rows[0].n === afterPub.rows[0].n &&
    beforePub.rows[0].h === afterPub.rows[0].h &&
    beforeAll.rows[0].n === afterAll.rows[0].n &&
    beforeAll.rows[0].h === afterAll.rows[0].h,
  beforePublished: beforePub.rows[0],
  afterPublished: afterPub.rows[0],
};

const out = path.join(path.dirname(inputPath), "import-coach-sheet-media-report.json");
fs.writeFileSync(out, JSON.stringify({ summary, unmatched: report.unmatched, ambiguous: report.ambiguous }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("Report:", out);
