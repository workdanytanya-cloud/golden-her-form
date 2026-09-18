/**
 * Импорт видео из Google Sheet тренера → exercise_media_bindings (+ unmatched overlay).
 * Не создаёт упражнения, не трогает published snapshots / assignments / content_hash.
 *
 * Повторяемый (ON CONFLICT upsert). После повторного import production-данных
 * запускать снова с тем же JSON/XLSX.
 *
 * Usage:
 *   npx tsx selfhost/cli/import-coach-sheet-media.ts --input=_tmp-exercise-videos/parsed-sheet-rows.json
 *   npx tsx selfhost/cli/import-coach-sheet-media.ts --xlsx=_tmp-exercise-videos/coach-exercises.xlsx
 *   npx tsx selfhost/cli/import-coach-sheet-media.ts --dry-run --input=...
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { loadSelfhostEnvFiles } from "@/lib/selfhost/load-env";
import { normalizeExerciseVideo } from "@/lib/exercise-video";
import { upsertExerciseMediaBinding } from "@/lib/selfhost/postgres-published";

loadSelfhostEnvFiles();

type SheetRow = {
  sheet: string;
  row: number;
  col: number;
  ref: string | null;
  name: string;
  idHint: string | null;
  url: string;
  cellText?: string;
};

type ParsedFile = {
  sheets?: Array<{ name: string; videoRows: number; hyperlinkCount: number }>;
  totalVideoCells?: number;
  rows: SheetRow[];
};

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const i = hit.indexOf("=");
  return i >= 0 ? hit.slice(i + 1) : null;
}

const dryRun = process.argv.includes("--dry-run");
const inputPath = argValue("--input=");
const xlsxPath = argValue("--xlsx=");

export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/[ёЁ]/g, (ch) => (ch === "ё" ? "е" : "Е"))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function loadParsed(): ParsedFile {
  if (inputPath) {
    const abs = path.resolve(inputPath);
    return JSON.parse(fs.readFileSync(abs, "utf8")) as ParsedFile;
  }
  if (xlsxPath) {
    const abs = path.resolve(xlsxPath);
    const parser = path.resolve("scripts/_parse-coach-xlsx.mjs");
    const out = path.resolve("_tmp-exercise-videos", "parsed-sheet-rows.json");
    const r = spawnSync(process.execPath, [parser, abs], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`xlsx parse failed: ${r.stderr || r.stdout}`);
    }
    return JSON.parse(fs.readFileSync(out, "utf8")) as ParsedFile;
  }
  throw new Error("Укажите --input=parsed.json или --xlsx=file.xlsx");
}

type Candidate = {
  name: string;
  norm: string;
  url: string;
  idHint: string | null;
  sheets: string[];
  refs: string[];
};

function collapseRows(rows: SheetRow[]): {
  candidates: Candidate[];
  skippedNoName: number;
  urlConflicts: Array<{ name: string; urls: string[] }>;
} {
  // First pass: URL -> best human name (skip pure numbers / emoji-only)
  const urlBestName = new Map<string, string>();
  for (const row of rows) {
    const name = (row.name || "").replace(/\s+/g, " ").trim();
    if (!name || /^\d+$/.test(name) || /^[\uFE0F\d️⃣🔴🟥]+$/u.test(name)) continue;
    if (!urlBestName.has(row.url)) urlBestName.set(row.url, name);
  }

  const byNorm = new Map<
    string,
    { name: string; urls: Map<string, number>; idHint: string | null; sheets: Set<string>; refs: string[] }
  >();
  let skippedNoName = 0;
  for (const row of rows) {
    let name = (row.name || "").replace(/\s+/g, " ").trim();
    if (!name || /^\d+$/.test(name)) {
      name = urlBestName.get(row.url) || "";
    }
    if (!name) {
      skippedNoName++;
      continue;
    }
    const norm = normalizeExerciseName(name);
    if (!norm) {
      skippedNoName++;
      continue;
    }
    let bucket = byNorm.get(norm);
    if (!bucket) {
      bucket = {
        name,
        urls: new Map(),
        idHint: row.idHint,
        sheets: new Set(),
        refs: [],
      };
      byNorm.set(norm, bucket);
    }
    bucket.urls.set(row.url, (bucket.urls.get(row.url) ?? 0) + 1);
    bucket.sheets.add(row.sheet);
    bucket.refs.push(`${row.sheet}:${row.ref ?? row.row}`);
    if (!bucket.idHint && row.idHint) bucket.idHint = row.idHint;
  }

  const candidates: Candidate[] = [];
  const urlConflicts: Array<{ name: string; urls: string[] }> = [];
  for (const bucket of byNorm.values()) {
    const ranked = [...bucket.urls.entries()].sort((a, b) => b[1] - a[1]);
    const url = ranked[0]![0];
    if (ranked.length > 1) {
      urlConflicts.push({ name: bucket.name, urls: ranked.map(([u]) => u) });
    }
    candidates.push({
      name: bucket.name,
      norm: normalizeExerciseName(bucket.name),
      url,
      idHint: bucket.idHint,
      sheets: [...bucket.sheets],
      refs: bucket.refs.slice(0, 5),
    });
  }
  return { candidates, skippedNoName, urlConflicts };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");

  const parsed = loadParsed();
  const { candidates, skippedNoName, urlConflicts } = collapseRows(parsed.rows ?? []);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const beforeHash = await pool.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
       FROM public.training_program_versions`,
  );
  const beforePublished = await pool.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
       FROM public.training_program_versions WHERE status = 'published'`,
  );

  const exRes = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.exercises`,
  );
  const byId = new Map(exRes.rows.map((r) => [r.id.toLowerCase(), r]));
  const byNorm = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of exRes.rows) {
    const norm = normalizeExerciseName(row.name);
    const list = byNorm.get(norm) ?? [];
    list.push(row);
    byNorm.set(norm, list);
  }

  const unmatchedRes = await pool.query<{
    original_exercise_id: string;
    resolved_exercise_id: string | null;
  }>(`SELECT original_exercise_id, resolved_exercise_id FROM public.unmatched_exercise_media`);
  const unmatchedIds = new Set(unmatchedRes.rows.map((r) => r.original_exercise_id));

  // Names of unmatched originals via exercises table if stub still exists
  const unmatchedNameRes = await pool.query<{ id: string; name: string }>(
    `SELECT e.id, e.name FROM public.exercises e
      JOIN public.unmatched_exercise_media u ON u.original_exercise_id = e.id`,
  );
  const unmatchedByNorm = new Map<string, string[]>();
  for (const row of unmatchedNameRes.rows) {
    const norm = normalizeExerciseName(row.name);
    const list = unmatchedByNorm.get(norm) ?? [];
    list.push(row.id);
    unmatchedByNorm.set(norm, list);
  }

  const report = {
    sheetVideoCells: parsed.totalVideoCells ?? parsed.rows.length,
    sheets: parsed.sheets ?? [],
    uniqueNames: candidates.length,
    skippedNoName,
    urlConflicts,
    matched: [] as Array<{ exerciseId: string; name: string; url: string; via: string }>,
    ambiguous: [] as Array<{ name: string; exerciseIds: string[]; sheets: string[] }>,
    unmatched: [] as Array<{ name: string; url: string; sheets: string[] }>,
    bindingsUpserted: 0,
    unmatchedOverlayUpdated: 0,
    unavailableLinks: [] as Array<{ name: string; url: string; reason: string }>,
  };

  for (const cand of candidates) {
    const video = normalizeExerciseVideo({ video_url: cand.url, title: cand.name });
    if (!video.url || video.status === "unavailable" || video.provider === "none") {
      report.unavailableLinks.push({
        name: cand.name,
        url: cand.url,
        reason: "не удалось нормализовать как youtube/rutube/https",
      });
      continue;
    }

    let target: { id: string; name: string } | null = null;
    let via = "name";

    if (cand.idHint && byId.has(cand.idHint.toLowerCase())) {
      target = byId.get(cand.idHint.toLowerCase())!;
      via = "id";
    } else {
      const hits = byNorm.get(cand.norm) ?? [];
      if (hits.length === 1) {
        target = hits[0]!;
        via = "name";
      } else if (hits.length > 1) {
        report.ambiguous.push({
          name: cand.name,
          exerciseIds: hits.map((h) => h.id),
          sheets: cand.sheets,
        });
        continue;
      }
    }

    if (!target) {
      report.unmatched.push({ name: cand.name, url: cand.url, sheets: cand.sheets });
      // Still refresh unmatched_exercise_media rows that share this exact name (stubs)
      const stubIds = unmatchedByNorm.get(cand.norm) ?? [];
      for (const originalId of stubIds) {
        if (dryRun) {
          report.unmatchedOverlayUpdated++;
          continue;
        }
        await pool.query(
          `UPDATE public.unmatched_exercise_media
              SET provider = $2, source_url = $3, embed_url = $4, title = $5, status = $6,
                  updated_at = (now() AT TIME ZONE 'utc')
            WHERE original_exercise_id = $1`,
          [
            originalId,
            video.provider,
            video.url,
            video.embed_url,
            video.title,
            video.status,
          ],
        );
        report.unmatchedOverlayUpdated++;
      }
      continue;
    }

    report.matched.push({
      exerciseId: target.id,
      name: target.name,
      url: video.url,
      via,
    });

    if (!dryRun) {
      await upsertExerciseMediaBinding(
        pool,
        {
          exercise_id: target.id,
          provider: video.provider,
          source_url: video.url,
          embed_url: video.embed_url,
          title: video.title ?? target.name,
          status: video.status,
          fallback_text: video.fallback_text,
        },
        null,
      );
    }
    report.bindingsUpserted++;

    // Overlay for old published ids pointing at this live exercise
    if (unmatchedIds.has(target.id)) {
      if (!dryRun) {
        await pool.query(
          `UPDATE public.unmatched_exercise_media
              SET provider = $2, source_url = $3, embed_url = $4, title = $5, status = $6,
                  updated_at = (now() AT TIME ZONE 'utc')
            WHERE original_exercise_id = $1`,
          [
            target.id,
            video.provider,
            video.url,
            video.embed_url,
            video.title ?? target.name,
            video.status,
          ],
        );
      }
      report.unmatchedOverlayUpdated++;
    }

    // Also copy binding onto unmatched originals that resolve to this exercise
    const resolvedFrom = unmatchedRes.rows.filter((r) => r.resolved_exercise_id === target!.id);
    for (const row of resolvedFrom) {
      if (dryRun) {
        report.unmatchedOverlayUpdated++;
        continue;
      }
      await pool.query(
        `UPDATE public.unmatched_exercise_media
            SET provider = $2, source_url = $3, embed_url = $4, title = $5, status = $6,
                updated_at = (now() AT TIME ZONE 'utc')
          WHERE original_exercise_id = $1`,
        [
          row.original_exercise_id,
          video.provider,
          video.url,
          video.embed_url,
          video.title ?? target.name,
          video.status,
        ],
      );
      report.unmatchedOverlayUpdated++;
    }
  }

  // Overlay for exercise ids that appear only in published snapshots (original_exercise_id).
  const snapRes = await pool.query<{ snapshot: unknown }>(
    `SELECT snapshot FROM public.training_program_versions WHERE status IN ('published','superseded')`,
  );
  const snapshotRefs = new Map<string, string>(); // id -> name
  for (const row of snapRes.rows) {
    const snap = row.snapshot as {
      days?: Array<Record<string, Array<Record<string, unknown>>>>;
    } | null;
    for (const day of snap?.days ?? []) {
      for (const section of ["warmup", "exercises", "cooldown"] as const) {
        for (const set of (day[section] as Array<Record<string, unknown>> | undefined) ?? []) {
          const ex = (set.exercise as { id?: string; name?: string } | undefined) ?? undefined;
          const eid = String(set.exercise_id ?? ex?.id ?? "");
          const ename = String(ex?.name ?? "");
          if (/^[0-9a-f-]{36}$/i.test(eid) && ename) snapshotRefs.set(eid.toLowerCase(), ename);
        }
      }
    }
  }

  let snapshotUnmatchedUpserted = 0;
  for (const [originalId, ename] of snapshotRefs) {
    if (byId.has(originalId)) continue; // live catalog id — binding already handled if matched
    const norm = normalizeExerciseName(ename);
    const sheetHits = candidates.filter((c) => c.norm === norm);
    if (sheetHits.length !== 1) continue;
    const cand = sheetHits[0]!;
    const video = normalizeExerciseVideo({ video_url: cand.url, title: ename });
    if (!video.url || video.provider === "none") continue;
    if (!dryRun) {
      await pool.query(
        `INSERT INTO public.unmatched_exercise_media
           (original_exercise_id, provider, source_url, embed_url, title, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,'coach-sheet')
         ON CONFLICT (original_exercise_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           source_url = EXCLUDED.source_url,
           embed_url = EXCLUDED.embed_url,
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           updated_at = (now() AT TIME ZONE 'utc')`,
        [
          originalId,
          video.provider,
          video.url,
          video.embed_url,
          video.title ?? ename,
          video.status,
        ],
      );
    }
    snapshotUnmatchedUpserted++;
  }
  report.unmatchedOverlayUpdated += snapshotUnmatchedUpserted;

  const afterHash = await pool.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
       FROM public.training_program_versions`,
  );
  const afterPublished = await pool.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(content_hash, ',' ORDER BY id::text), '')) AS h
       FROM public.training_program_versions WHERE status = 'published'`,
  );

  await pool.end();

  const summary = {
    dryRun,
    sheetVideoCells: report.sheetVideoCells,
    uniqueNames: report.uniqueNames,
    skippedNoName: report.skippedNoName,
    matched: report.matched.length,
    bindingsUpserted: report.bindingsUpserted,
    unmatchedOverlayUpdated: report.unmatchedOverlayUpdated,
    ambiguous: report.ambiguous.length,
    unmatchedNames: report.unmatched.length,
    urlConflicts: report.urlConflicts.length,
    unavailableLinks: report.unavailableLinks.length,
    publishedProgramsUnchanged:
      beforePublished.rows[0].n === afterPublished.rows[0].n &&
      beforePublished.rows[0].h === afterPublished.rows[0].h &&
      beforeHash.rows[0].n === afterHash.rows[0].n &&
      beforeHash.rows[0].h === afterHash.rows[0].h,
    beforePublished: beforePublished.rows[0],
    afterPublished: afterPublished.rows[0],
    ambiguousList: report.ambiguous.slice(0, 40),
    unmatchedSample: report.unmatched.slice(0, 40),
    unavailableSample: report.unavailableLinks.slice(0, 20),
    urlConflictSample: report.urlConflicts.slice(0, 20),
  };

  const outPath = path.resolve("_tmp-exercise-videos", "import-coach-sheet-media-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ summary, matched: report.matched, fullUnmatched: report.unmatched }, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
