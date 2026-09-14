import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

/** Whitelist of upload folders for dish media (no path traversal). */
export const DISH_MEDIA_FOLDERS = ["dishes/images", "dishes/videos"] as const;
export type DishMediaFolder = (typeof DISH_MEDIA_FOLDERS)[number];

const IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

// Query form avoids Vite/Nitro treating `/…/file.png` as a static asset (bypasses server entry).
const MEDIA_URL_PREFIX = "/api/selfhost/media?p=";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Permanent media root for selfhost file uploads.
 * Production MUST set SELFHOST_MEDIA_ROOT to a durable absolute path (backed up with the DB).
 * Dev/test may omit it — then files go under `<cwd>/.selfhost-media` (not a production store).
 */
export function getSelfhostMediaRoot(): string {
  const configured = readEnv("SELFHOST_MEDIA_ROOT");
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw Object.assign(
        new Error("SELFHOST_MEDIA_ROOT должен быть абсолютным путём к постоянному каталогу"),
        { statusCode: 500 },
      );
    }
    return path.normalize(configured);
  }
  if (readEnv("NODE_ENV") === "production") {
    throw Object.assign(
      new Error(
        "SELFHOST_MEDIA_ROOT не задан. На проде укажите постоянный каталог (не temp) и включите его в бэкапы.",
      ),
      { statusCode: 503 },
    );
  }
  return path.normalize(path.join(process.cwd(), ".selfhost-media"));
}

export function describeMediaRootForOps(): {
  root: string;
  configured: boolean;
  productionReady: boolean;
  note: string;
} {
  const configured = Boolean(readEnv("SELFHOST_MEDIA_ROOT"));
  const root = configured
    ? path.normalize(readEnv("SELFHOST_MEDIA_ROOT")!)
    : path.normalize(path.join(process.cwd(), ".selfhost-media"));
  return {
    root,
    configured,
    productionReady: configured && path.isAbsolute(root),
    note: configured
      ? "Постоянный каталог задан через SELFHOST_MEDIA_ROOT — включайте его в резервное копирование вместе с PostgreSQL."
      : "Dev/test: используется .selfhost-media в корне проекта. Для продакшена задайте SELFHOST_MEDIA_ROOT.",
  };
}

export function ensureMediaRootExists(): string {
  const root = getSelfhostMediaRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function isDishMediaFolder(folder: string): folder is DishMediaFolder {
  return (DISH_MEDIA_FOLDERS as readonly string[]).includes(folder);
}

function extForMime(folder: DishMediaFolder, mime: string): string {
  if (folder === "dishes/images") {
    const ext = IMAGE_MIME[mime];
    if (!ext) {
      throw Object.assign(new Error("Допустимы только JPEG, PNG или WebP"), { statusCode: 400 });
    }
    return ext;
  }
  const ext = VIDEO_MIME[mime];
  if (!ext) {
    throw Object.assign(new Error("Допустимы только MP4, WebM или QuickTime"), { statusCode: 400 });
  }
  return ext;
}

function maxBytesForFolder(folder: DishMediaFolder): number {
  return folder === "dishes/images" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

/** Resolve a relative media path under the root; reject traversal. */
export function resolveSafeMediaPath(relativePath: string): string {
  const root = ensureMediaRootExists();
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0") || cleaned.split("/").some((p) => p === ".." || p === "")) {
    throw Object.assign(new Error("Некорректный путь медиа"), { statusCode: 400 });
  }
  const absolute = path.normalize(path.join(root, ...cleaned.split("/")));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw Object.assign(new Error("Путь вне каталога загрузок"), { statusCode: 400 });
  }
  return absolute;
}

export function publicMediaUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${MEDIA_URL_PREFIX}${encodeURIComponent(cleaned)}`;
}

export function relativePathFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed =
      url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")
        ? new URL(url, "http://selfhost.local")
        : null;
    if (!parsed) return null;
    if (parsed.pathname === "/api/selfhost/media") {
      const p = parsed.searchParams.get("p") ?? parsed.searchParams.get("path");
      return p ? decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+/, "") : null;
    }
    // Legacy path-style URLs (often blocked by static middleware when ending in .png).
    if (parsed.pathname.startsWith("/api/selfhost/media/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/selfhost/media/".length));
    }
    return null;
  } catch {
    return null;
  }
}

export function isSelfhostMediaUrl(url: string | null | undefined): boolean {
  return relativePathFromMediaUrl(url) != null;
}

export async function saveDishMediaUpload(input: {
  folder: string;
  bytes: Buffer;
  contentType: string;
  originalName?: string;
}): Promise<{ url: string; relativePath: string; bytes: number }> {
  if (!isDishMediaFolder(input.folder)) {
    throw Object.assign(new Error("Недопустимая папка загрузки"), { statusCode: 400 });
  }
  const mime = (input.contentType || "").split(";")[0]!.trim().toLowerCase();
  const ext = extForMime(input.folder, mime);
  const max = maxBytesForFolder(input.folder);
  if (input.bytes.length === 0) {
    throw Object.assign(new Error("Пустой файл"), { statusCode: 400 });
  }
  if (input.bytes.length > max) {
    throw Object.assign(
      new Error(
        input.folder === "dishes/images"
          ? "Размер изображения не больше 5 МБ"
          : "Размер видео не больше 80 МБ",
      ),
      { statusCode: 400 },
    );
  }

  const relativePath = `${input.folder}/${randomUUID()}.${ext}`;
  const absolute = resolveSafeMediaPath(relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, input.bytes, { flag: "wx" });
  return {
    url: publicMediaUrl(relativePath),
    relativePath,
    bytes: input.bytes.length,
  };
}

export function readMediaFile(relativePath: string): {
  absolute: string;
  contentType: string;
  bytes: Buffer;
} {
  const absolute = resolveSafeMediaPath(relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw Object.assign(new Error("Файл не найден"), { statusCode: 404 });
  }
  const ext = path.extname(absolute).slice(1).toLowerCase();
  const contentType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "mp4"
            ? "video/mp4"
            : ext === "webm"
              ? "video/webm"
              : ext === "mov"
                ? "video/quicktime"
                : "application/octet-stream";
  return { absolute, contentType, bytes: fs.readFileSync(absolute) };
}

/**
 * Delete a selfhost media file only if no dish and no published/draft nutrition
 * snapshot still references its URL/path.
 */
export async function tryDeleteUnreferencedMedia(
  db: Queryable,
  url: string | null | undefined,
): Promise<{ deleted: boolean; reason?: string }> {
  const relative = relativePathFromMediaUrl(url);
  if (!relative || !url) return { deleted: false, reason: "not-selfhost" };

  const needle = relative.replace(/\\/g, "/");
  // Public URLs use encodeURIComponent(path); snapshots may store either form.
  const needles = Array.from(
    new Set([needle, encodeURIComponent(needle), path.basename(needle)].filter(Boolean)),
  );

  const inDishes = await db.query(
    `SELECT 1 FROM public.dishes
      WHERE image_url ILIKE ANY (SELECT '%' || n || '%' FROM unnest($1::text[]) AS n)
         OR video_url ILIKE ANY (SELECT '%' || n || '%' FROM unnest($1::text[]) AS n)
      LIMIT 1`,
    [needles],
  );
  if (inDishes.rowCount) return { deleted: false, reason: "referenced-by-dish" };

  const inSnapshots = await db.query(
    `SELECT 1 FROM public.nutrition_plan_versions
      WHERE snapshot::text ILIKE ANY (SELECT '%' || n || '%' FROM unnest($1::text[]) AS n)
      LIMIT 1`,
    [needles],
  );
  if (inSnapshots.rowCount) return { deleted: false, reason: "referenced-by-published" };

  try {
    const absolute = resolveSafeMediaPath(needle);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "fs-error" };
  }
}

/** Stable fingerprint for tests / diagnostics (not a secret). */
export function mediaFileFingerprint(relativePath: string): string {
  const { bytes } = readMediaFile(relativePath);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
