/**
 * Скачивает медиа из Lovable CDN по манифестам *.asset.json
 * в public/__l5e/... — те же пути, что лежат в базе (gif_url / video_url).
 *
 * Запуск: npm run assets:fetch
 */
import { mkdir, readFile, access, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS_ROOT = path.join(ROOT, "src", "assets");
const PUBLIC_ROOT = path.join(ROOT, "public");
const CDN =
  process.env.LOVABLE_ASSETS_CDN ||
  "https://05338094-25e9-448a-9d8b-230043f555c9.lovableproject.com";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function collectAssetJson(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectAssetJson(full, out);
    else if (entry.name.endsWith(".asset.json")) out.push(full);
  }
  return out;
}

async function main() {
  const files = await collectAssetJson(ASSETS_ROOT);
  if (files.length === 0) {
    console.error("Не найдены *.asset.json в src/assets");
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let fail = 0;

  for (const file of files) {
    const meta = JSON.parse(await readFile(file, "utf8"));
    if (!meta.url?.startsWith("/__l5e/")) {
      console.warn("SKIP (unexpected url):", file);
      continue;
    }
    const out = path.join(PUBLIC_ROOT, ...meta.url.replace(/^\//, "").split("/"));
    if (await exists(out)) {
      skipped++;
      continue;
    }
    await mkdir(path.dirname(out), { recursive: true });
    const url = CDN + meta.url;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(out, buf);
      ok++;
      console.log("OK", meta.original_filename || meta.url);
    } catch (err) {
      fail++;
      console.error("FAIL", meta.url, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done: downloaded=${ok} skipped=${skipped} failed=${fail} total=${files.length}`);
  if (fail > 0) process.exit(1);
}

main();
