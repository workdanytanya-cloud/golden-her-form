import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { NutritionSnapshot, TrainingSnapshot } from "@/lib/published-programs/types";
import {
  nutritionPdfBlocks,
  pdfFileName,
  trainingPdfLines,
  type PdfClientMeta,
  type PdfKind,
  type PdfLineBlock,
} from "@/lib/pdf/snapshot-content";

// pdfkit is CJS and relies on __dirname; load via createRequire (not ESM default import).
const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

const FONT_FILE = "NotoSans-Regular.ttf";

function fontsDirCandidates(): string[] {
  const besideModule = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
  const cwd = process.cwd();
  return [
    besideModule,
    path.join(cwd, "src/lib/pdf/fonts"),
    path.join(cwd, "fonts"),
    path.join(cwd, ".output/server/fonts"),
    path.join(path.dirname(besideModule), "fonts"),
    path.join(path.dirname(path.dirname(besideModule)), "fonts"),
    path.join(path.dirname(path.dirname(path.dirname(besideModule))), "fonts"),
  ];
}

function fontsDir(): string {
  for (const dir of fontsDirCandidates()) {
    if (fs.existsSync(path.join(dir, FONT_FILE))) return dir;
  }
  return fontsDirCandidates()[0]!;
}

export function notoSansRegularPath(): string {
  const fromEnv = process.env.PANOVA_PDF_FONT_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return path.join(fontsDir(), FONT_FILE);
}

function writeLine(
  doc: InstanceType<typeof PDFDocument>,
  line: string,
  width: number,
): void {
  if (!line) {
    doc.moveDown(0.4);
    return;
  }
  const isLink = line.includes("https://");
  if (isLink) {
    const idx = line.indexOf("https://");
    const prefix = line.slice(0, idx);
    const url = line.slice(idx).trim();
    if (prefix) doc.text(prefix, { continued: true, width });
    doc.fillColor("#1a56db").text(url, { link: url, underline: true, width });
    doc.fillColor("#000000");
    return;
  }
  doc.text(line, { align: "left", width });
}

function blockHeight(
  doc: InstanceType<typeof PDFDocument>,
  lines: string[],
  width: number,
): number {
  let height = 0;
  for (const line of lines) {
    if (!line) {
      height += doc.currentLineHeight() * 0.4;
      continue;
    }
    height += doc.heightOfString(line, { width, align: "left" });
  }
  return height;
}

export function renderPdfFromBlocks(title: string, blocks: PdfLineBlock[]): Promise<Buffer> {
  const fontPath = notoSansRegularPath();
  if (!fs.existsSync(fontPath)) {
    throw new Error("Не найден шрифт Noto Sans для PDF");
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      font: fontPath,
      info: { Title: title, Author: "PanovaPRO" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;

    doc.fontSize(16).text(title, { underline: true, width });
    doc.moveDown(0.6);
    doc.fontSize(10);

    for (const block of blocks) {
      if (block.keepTogether && block.lines.length > 0) {
        const needed = blockHeight(doc, block.lines, width);
        if (doc.y + needed > bottom) doc.addPage();
      }
      for (const line of block.lines) {
        if (line && doc.y + doc.heightOfString(line, { width }) > bottom) {
          doc.addPage();
        }
        writeLine(doc, line, width);
      }
    }
    doc.end();
  });
}

export function renderPdfFromLines(title: string, lines: string[]): Promise<Buffer> {
  return renderPdfFromBlocks(
    title,
    lines.map((line) => ({ lines: [line] })),
  );
}

export async function buildNutritionPdf(
  snapshot: NutritionSnapshot,
  meta: PdfClientMeta,
): Promise<Buffer> {
  return renderPdfFromBlocks("Питание", nutritionPdfBlocks(snapshot, meta));
}

export async function buildTrainingPdf(
  snapshot: TrainingSnapshot,
  meta: PdfClientMeta,
  mediaOverlay?: Map<string, import("@/lib/exercise-video").ExerciseVideo>,
): Promise<Buffer> {
  return renderPdfFromLines("Тренировки", trainingPdfLines(snapshot, meta, mediaOverlay));
}

export function pdfDownloadHeaders(
  kind: PdfKind,
  issuedAt: string,
  clientName?: string,
): Record<string, string> {
  const filename = pdfFileName(kind, issuedAt, clientName);
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "private, no-store",
  };
}

export function createPdfResponse(
  buffer: Buffer,
  kind: PdfKind,
  issuedAt: string,
  clientName?: string,
): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: pdfDownloadHeaders(kind, issuedAt, clientName),
  });
}
