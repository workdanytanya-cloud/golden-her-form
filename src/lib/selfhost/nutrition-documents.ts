import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import yauzl from "yauzl";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { getSelfhostMediaRoot } from "@/lib/selfhost/local-media-store";
import { withTransaction } from "@/lib/selfhost/db";
import { assertCourseScopePg } from "@/lib/selfhost/postgres-courses";

type Queryable = Pool | PoolClient;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const EXECUTABLE_EXTENSIONS = /\.(?:exe|dll|com|bat|cmd|ps1|sh|js|jar|msi|scr|vbs)$/i;

export const nutritionDocumentUploadSchema = z.object({
  clientId: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  displayMode: z.enum(["supplement", "primary"]).default("supplement"),
  replacesId: z.string().uuid().nullable().optional(),
});

export type NutritionDocumentRow = {
  id: string;
  client_id: string;
  course_id: string;
  title: string;
  description: string | null;
  display_mode: "supplement" | "primary";
  status: "draft" | "published" | "superseded" | "archived";
  version: number;
  replaces_id: string | null;
  storage_key: string;
  original_name: string;
  media_type: typeof PDF_MIME | typeof DOCX_MIME;
  size_bytes: number;
  sha256: string;
  rendered_html: string | null;
  created_at: string;
  published_at: string | null;
};

function documentRoot(): string {
  return path.join(getSelfhostMediaRoot(), "nutrition-documents");
}

function documentPath(storageKey: string, mediaType: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(storageKey))
    throw Object.assign(new Error("Некорректный ключ документа"), { statusCode: 400 });
  const ext = mediaType === PDF_MIME ? "pdf" : "docx";
  return path.join(documentRoot(), `${storageKey}.${ext}`);
}

function normalizedExtension(name: string): string {
  return path.extname(path.basename(name)).toLowerCase();
}

function validatePdf(bytes: Buffer, name: string, mime: string): void {
  if (
    normalizedExtension(name) !== ".pdf" ||
    mime !== PDF_MIME ||
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  ) {
    throw Object.assign(new Error("Файл не является корректным PDF"), { statusCode: 400 });
  }
}

async function inspectDocx(bytes: Buffer, name: string, mime: string): Promise<void> {
  if (normalizedExtension(name) === ".doc") {
    throw Object.assign(new Error("Сохраните файл как DOCX или PDF"), { statusCode: 400 });
  }
  if (
    normalizedExtension(name) !== ".docx" ||
    mime !== DOCX_MIME ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  ) {
    throw Object.assign(new Error("Файл не является корректным DOCX"), { statusCode: 400 });
  }
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip)
        return reject(Object.assign(new Error("Повреждённый DOCX"), { statusCode: 400 }));
      let count = 0;
      let total = 0;
      let hasTypes = false;
      let hasDocument = false;
      let finished = false;
      const fail = (message: string) => {
        if (finished) return;
        finished = true;
        zip.close();
        reject(Object.assign(new Error(message), { statusCode: 400 }));
      };
      zip.on("error", () => fail("Повреждённый DOCX"));
      zip.on("entry", (entry) => {
        const filename = entry.fileName.replace(/\\/g, "/");
        count += 1;
        total += entry.uncompressedSize;
        if (
          count > MAX_ZIP_ENTRIES ||
          total > MAX_UNCOMPRESSED_BYTES ||
          entry.uncompressedSize > Math.max(entry.compressedSize * 200, 5 * 1024 * 1024)
        )
          return fail("Небезопасная структура DOCX (ZIP bomb)");
        if (
          filename.startsWith("/") ||
          filename.split("/").some((part) => part === ".." || part.includes("\0"))
        )
          return fail("Небезопасный путь внутри DOCX");
        if (/vbaProject\.bin$/i.test(filename) || /macroEnabled/i.test(filename))
          return fail("DOCX с макросами не поддерживается");
        if (EXECUTABLE_EXTENSIONS.test(filename))
          return fail("Исполняемые файлы внутри DOCX запрещены");
        if (filename === "[Content_Types].xml") hasTypes = true;
        if (filename === "word/document.xml") hasDocument = true;
        zip.readEntry();
      });
      zip.on("end", () => {
        if (finished) return;
        finished = true;
        if (!hasTypes || !hasDocument)
          return reject(
            Object.assign(new Error("Некорректная структура DOCX"), { statusCode: 400 }),
          );
        resolve();
      });
      zip.readEntry();
    });
  });
}

export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "h1",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https", "data"],
    disallowedTagsMode: "discard",
  });
}

async function renderDocx(bytes: Buffer): Promise<string> {
  const converted = await mammoth.convertToHtml(
    { buffer: bytes },
    { includeDefaultStyleMap: true },
  );
  return sanitizeDocumentHtml(converted.value);
}

export async function validateNutritionDocumentFile(file: {
  name: string;
  type: string;
  bytes: Buffer;
}): Promise<{ mime: typeof PDF_MIME | typeof DOCX_MIME; renderedHtml: string | null }> {
  if (!file.bytes.length || file.bytes.length > MAX_BYTES)
    throw Object.assign(new Error("Размер файла не должен превышать 10 МБ"), { statusCode: 400 });
  const mime = file.type.split(";")[0]!.trim().toLowerCase();
  if (normalizedExtension(file.name) === ".doc")
    throw Object.assign(new Error("Сохраните файл как DOCX или PDF"), { statusCode: 400 });
  if (mime === PDF_MIME) {
    validatePdf(file.bytes, file.name, mime);
    return { mime: PDF_MIME, renderedHtml: null };
  }
  if (mime === DOCX_MIME) {
    await inspectDocx(file.bytes, file.name, mime);
    return { mime: DOCX_MIME, renderedHtml: await renderDocx(file.bytes) };
  }
  throw Object.assign(new Error("Сохраните файл как DOCX или PDF"), { statusCode: 400 });
}

export async function createNutritionDocumentDraft(
  db: Pool,
  actorId: string,
  input: z.infer<typeof nutritionDocumentUploadSchema>,
  file: { name: string; type: string; bytes: Buffer },
): Promise<NutritionDocumentRow> {
  const data = nutritionDocumentUploadSchema.parse(input);
  await assertCourseScopePg(db, data.clientId, data.courseId, "nutrition");
  const { mime, renderedHtml } = await validateNutritionDocumentFile(file);
  const storageKey = randomUUID();
  const destination = documentPath(storageKey, mime);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.bytes, { flag: "wx", mode: 0o600 });
  try {
    const { rows } = await db.query(
      `INSERT INTO public.nutrition_documents
       (client_id, course_id, title, description, display_mode, status, version, replaces_id, storage_key, original_name, media_type, size_bytes, sha256, rendered_html, created_by)
       SELECT $1,$2,$3,$4,$5,'draft',COALESCE(max(version),0)+1,$6,$7,$8,$9,$10,$11,$12,$13
       FROM public.nutrition_documents WHERE course_id=$2
       RETURNING *`,
      [
        data.clientId,
        data.courseId,
        data.title,
        data.description ?? null,
        data.displayMode,
        data.replacesId ?? null,
        storageKey,
        path.basename(file.name),
        mime,
        file.bytes.length,
        createHash("sha256").update(file.bytes).digest("hex"),
        renderedHtml,
        actorId,
      ],
    );
    return rows[0] as NutritionDocumentRow;
  } catch (error) {
    fs.unlinkSync(destination);
    throw error;
  }
}

export async function publishNutritionDocument(
  db: Pool,
  id: string,
  actorId: string,
): Promise<NutritionDocumentRow> {
  return withTransaction(async (client) => {
    const found = await client.query(
      `SELECT * FROM public.nutrition_documents WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0] as NutritionDocumentRow | undefined;
    if (!row) throw Object.assign(new Error("Документ не найден"), { statusCode: 404 });
    if (row.status !== "draft")
      throw Object.assign(new Error("Опубликовать можно только черновик"), { statusCode: 409 });
    await assertCourseScopePg(client, row.client_id, row.course_id, "nutrition");
    await client.query(
      `UPDATE public.nutrition_documents SET status='superseded' WHERE course_id=$1 AND status='published' AND display_mode=$2`,
      [row.course_id, row.display_mode],
    );
    const updated = await client.query(
      `UPDATE public.nutrition_documents SET status='published', published_at=now() WHERE id=$1 RETURNING *`,
      [id],
    );
    void actorId;
    return updated.rows[0] as NutritionDocumentRow;
  });
}

export async function archiveNutritionDocument(db: Pool, id: string): Promise<void> {
  await db.query(
    `UPDATE public.nutrition_documents SET status='archived', archived_at=now() WHERE id=$1 AND status IN ('draft','published')`,
    [id],
  );
}

export async function listNutritionDocuments(
  db: Queryable,
  clientId: string,
  courseId: string,
  includeDrafts: boolean,
): Promise<NutritionDocumentRow[]> {
  await assertCourseScopePg(db, clientId, courseId, "nutrition");
  const statuses = includeDrafts
    ? ["draft", "published", "superseded", "archived"]
    : ["published", "superseded"];
  const { rows } = await db.query(
    `SELECT * FROM public.nutrition_documents WHERE client_id=$1 AND course_id=$2 AND status=ANY($3::text[]) ORDER BY (display_mode='primary' AND status='published') DESC, version DESC`,
    [clientId, courseId, statuses],
  );
  return rows as NutritionDocumentRow[];
}

export async function loadNutritionDocument(
  db: Queryable,
  id: string,
  clientId: string,
  includeDrafts: boolean,
): Promise<{ row: NutritionDocumentRow; bytes: Buffer }> {
  const { rows } = await db.query(
    `SELECT * FROM public.nutrition_documents WHERE id=$1 AND client_id=$2 AND ($3::boolean OR status IN ('published','superseded'))`,
    [id, clientId, includeDrafts],
  );
  const row = rows[0] as NutritionDocumentRow | undefined;
  if (!row) throw Object.assign(new Error("Документ не найден"), { statusCode: 404 });
  await assertCourseScopePg(db, clientId, row.course_id, "nutrition");
  const absolute = documentPath(row.storage_key, row.media_type);
  if (!fs.existsSync(absolute))
    throw Object.assign(new Error("Оригинал документа недоступен"), { statusCode: 404 });
  return { row, bytes: fs.readFileSync(absolute) };
}
