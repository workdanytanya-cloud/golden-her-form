import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NutritionSnapshot, TrainingSnapshot } from "@/lib/published-programs/types";
import {
  nutritionPdfLines,
  pdfFileName,
  trainingPdfLines,
  type PdfClientMeta,
  type PdfKind,
} from "@/lib/pdf/snapshot-content";

function fontsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
}

export function notoSansRegularPath(): string {
  return path.join(fontsDir(), "NotoSans-Regular.ttf");
}

export function renderPdfFromLines(title: string, lines: string[]): Promise<Buffer> {
  const fontPath = notoSansRegularPath();
  if (!fs.existsSync(fontPath)) {
    throw new Error("Не найден шрифт Noto Sans для PDF");
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: title, Author: "PanovaPRO" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(fontPath);
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(10);
    for (const line of lines) {
      if (!line) {
        doc.moveDown(0.4);
        continue;
      }
      const isLink = line.includes("https://");
      if (isLink) {
        const idx = line.indexOf("https://");
        const prefix = line.slice(0, idx);
        const url = line.slice(idx).trim();
        if (prefix) doc.text(prefix, { continued: true });
        doc.fillColor("#1a56db").text(url, { link: url, underline: true });
        doc.fillColor("#000000");
      } else {
        doc.text(line, { align: "left" });
      }
    }
    doc.end();
  });
}

export async function buildNutritionPdf(
  snapshot: NutritionSnapshot,
  meta: PdfClientMeta,
): Promise<Buffer> {
  return renderPdfFromLines("Питание", nutritionPdfLines(snapshot, meta));
}

export async function buildTrainingPdf(
  snapshot: TrainingSnapshot,
  meta: PdfClientMeta,
): Promise<Buffer> {
  return renderPdfFromLines("Тренировки", trainingPdfLines(snapshot, meta));
}

export function pdfDownloadHeaders(kind: PdfKind, issuedAt: string): Record<string, string> {
  const filename = pdfFileName(kind, issuedAt);
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };
}

export function createPdfResponse(buffer: Buffer, kind: PdfKind, issuedAt: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: pdfDownloadHeaders(kind, issuedAt),
  });
}
