import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSelfhostMediaRoot, publicMediaUrl } from "@/lib/selfhost/local-media-store";

/** Map of canonical external URL → relative path under SELFHOST_MEDIA_ROOT. */
export type MediaAliasMap = Record<string, string>;

const MAP_FILE = "import-aliases.json";

/** Strip signing query params so the same object maps to one local file. */
export function canonicalExternalMediaUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Signed Supabase URLs differ by token; keep path identity only.
    if (/supabase\.co$/i.test(u.hostname) || /\/storage\/v1\/object\//i.test(u.pathname)) {
      u.search = "";
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function isExternalStorageMediaUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /supabase\.co/i.test(raw) || /\/storage\/v1\/object\//i.test(raw);
}

export function aliasMapPath(): string {
  return path.join(getSelfhostMediaRoot(), MAP_FILE);
}

export function loadMediaAliasMap(): MediaAliasMap {
  const file = aliasMapPath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as MediaAliasMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMediaAliasMap(map: MediaAliasMap): void {
  const root = getSelfhostMediaRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(aliasMapPath(), `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

export function importedRelativePathForUrl(url: string, extHint?: string): string {
  const canon = canonicalExternalMediaUrl(url);
  const hash = createHash("sha256").update(canon).digest("hex").slice(0, 32);
  let ext = (extHint || "").replace(/^\./, "").toLowerCase();
  if (!ext) {
    try {
      const pathname = new URL(canon).pathname;
      const m = pathname.match(/\.([a-z0-9]{2,5})$/i);
      ext = m?.[1]?.toLowerCase() ?? "bin";
    } catch {
      ext = "bin";
    }
  }
  if (!/^[a-z0-9]{2,5}$/.test(ext)) ext = "bin";
  return `imported/${hash}.${ext}`;
}

/**
 * Resolve an external (e.g. Supabase Storage) URL to a local selfhost media URL
 * when a mirror alias exists. Does not mutate stored snapshots.
 */
export function resolveCompatMediaUrl(
  url: string | null | undefined,
  map: MediaAliasMap = loadMediaAliasMap(),
): string | null | undefined {
  if (!url) return url;
  if (!isExternalStorageMediaUrl(url)) return url;
  const relative = map[canonicalExternalMediaUrl(url)] ?? map[url];
  if (!relative) return url;
  return publicMediaUrl(relative);
}

/** Deep-clone JSON and rewrite string fields that look like media URLs. */
export function rewriteMediaUrlsInJson<T>(value: T, map: MediaAliasMap = loadMediaAliasMap()): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return resolveCompatMediaUrl(node, map) ?? node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(value) as T;
}
