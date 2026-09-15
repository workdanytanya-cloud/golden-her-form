/**
 * Mirror external (Supabase Storage) media into SELFHOST_MEDIA_ROOT and write
 * import-aliases.json for display-time URL resolution without mutating snapshots.
 *
 * Usage (on VDS, with .env.staging loaded):
 *   npx tsx selfhost/cli/mirror-external-media.ts
 *   npx tsx selfhost/cli/mirror-external-media.ts --update-catalog
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadSelfhostEnvFiles } from "@/lib/selfhost/load-env";
import {
  canonicalExternalMediaUrl,
  importedRelativePathForUrl,
  isExternalStorageMediaUrl,
  loadMediaAliasMap,
  saveMediaAliasMap,
} from "@/lib/selfhost/media-url-compat";
import {
  ensureMediaRootExists,
  publicMediaUrl,
  resolveSafeMediaPath,
} from "@/lib/selfhost/local-media-store";

loadSelfhostEnvFiles();

const updateCatalog = process.argv.includes("--update-catalog");
const dryRun = process.argv.includes("--dry-run");

function collectUrlsFromJson(node: unknown, out: Set<string>): void {
  if (typeof node === "string") {
    if (isExternalStorageMediaUrl(node)) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectUrlsFromJson(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectUrlsFromJson(v, out);
  }
}

async function download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  const contentType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0]!;
  const ab = await res.arrayBuffer();
  return { bytes: Buffer.from(ab), contentType };
}

function extFromContentType(ct: string): string | undefined {
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("quicktime")) return "mov";
  return undefined;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  ensureMediaRootExists();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const urls = new Set<string>();

  const dishes = await pool.query(`SELECT image_url, video_url FROM public.dishes`);
  for (const row of dishes.rows as Array<{ image_url: string | null; video_url: string | null }>) {
    if (row.image_url) urls.add(row.image_url);
    if (row.video_url) urls.add(row.video_url);
  }

  const exercises = await pool.query(
    `SELECT gif_url, video_url FROM public.exercises
      WHERE coalesce(gif_url,'') <> '' OR coalesce(video_url,'') <> ''`,
  );
  for (const row of exercises.rows as Array<{ gif_url: string | null; video_url: string | null }>) {
    if (row.gif_url) urls.add(row.gif_url);
    if (row.video_url) urls.add(row.video_url);
  }

  const snaps = await pool.query(
    `SELECT snapshot FROM public.nutrition_plan_versions WHERE status IN ('published','superseded','draft')`,
  );
  for (const row of snaps.rows as Array<{ snapshot: unknown }>) {
    collectUrlsFromJson(row.snapshot, urls);
  }

  const trainingSnaps = await pool.query(
    `SELECT snapshot FROM public.training_program_versions WHERE status IN ('published','superseded','draft')`,
  );
  for (const row of trainingSnaps.rows as Array<{ snapshot: unknown }>) {
    collectUrlsFromJson(row.snapshot, urls);
  }

  const external = [...urls].filter((u) => isExternalStorageMediaUrl(u));
  console.log(`MEDIA_MIRROR urls_total=${urls.size} external=${external.length} dryRun=${dryRun}`);

  const map = loadMediaAliasMap();
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of external) {
    const canon = canonicalExternalMediaUrl(url);
    if (map[canon] || map[url]) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log("WOULD_FETCH", canon.slice(0, 100));
      continue;
    }
    try {
      const { bytes, contentType } = await download(url);
      const relative = importedRelativePathForUrl(canon, extFromContentType(contentType));
      const absolute = resolveSafeMediaPath(relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, bytes, { flag: "wx" });
      map[canon] = relative;
      if (url !== canon) map[url] = relative;
      downloaded += 1;
      if (downloaded % 20 === 0) {
        saveMediaAliasMap(map);
        console.log(`progress downloaded=${downloaded}`);
      }
    } catch (e) {
      failed += 1;
      console.error("FAIL", canon.slice(0, 100), e instanceof Error ? e.message : e);
    }
  }

  if (!dryRun) saveMediaAliasMap(map);

  let catalogUpdated = 0;
  if (updateCatalog && !dryRun) {
    const client = await pool.connect();
    try {
      for (const row of dishes.rows as Array<{ image_url: string | null; video_url: string | null }>) {
        // Remap via SQL updates only for catalog rows; snapshots untouched.
      }
      const { rows: dishRows } = await client.query(`SELECT id, image_url, video_url FROM public.dishes`);
      for (const row of dishRows as Array<{
        id: string;
        image_url: string | null;
        video_url: string | null;
      }>) {
        const nextImage =
          row.image_url && map[canonicalExternalMediaUrl(row.image_url)]
            ? publicMediaUrl(map[canonicalExternalMediaUrl(row.image_url)]!)
            : row.image_url && map[row.image_url]
              ? publicMediaUrl(map[row.image_url]!)
              : null;
        const nextVideo =
          row.video_url && map[canonicalExternalMediaUrl(row.video_url)]
            ? publicMediaUrl(map[canonicalExternalMediaUrl(row.video_url)]!)
            : row.video_url && map[row.video_url]
              ? publicMediaUrl(map[row.video_url]!)
              : null;
        if (
          (nextImage && nextImage !== row.image_url) ||
          (nextVideo && nextVideo !== row.video_url)
        ) {
          await client.query(
            `UPDATE public.dishes SET
               image_url = COALESCE($2, image_url),
               video_url = COALESCE($3, video_url),
               updated_at = (now() AT TIME ZONE 'utc')
             WHERE id = $1`,
            [row.id, nextImage, nextVideo],
          );
          catalogUpdated += 1;
        }
      }
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log(
    JSON.stringify({
      ok: true,
      external: external.length,
      downloaded,
      skipped,
      failed,
      aliases: Object.keys(map).length,
      catalogUpdated,
      updateCatalog,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
