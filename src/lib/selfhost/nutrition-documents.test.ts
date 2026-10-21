import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { sanitizeDocumentHtml, validateNutritionDocumentFile } from "./nutrition-documents";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function zip(
  entries: Record<string, string>,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6,
): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])),
      { level },
    ),
  );
}

function minimalDocx(extra: Record<string, string> = {}): Buffer {
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Безопасное меню</w:t></w:r></w:p></w:body></w:document>`,
    ...extra,
  });
}

describe("nutrition document validation", () => {
  it("accepts PDF signature and rejects a forged extension", async () => {
    await expect(
      validateNutritionDocumentFile({
        name: "menu.pdf",
        type: "application/pdf",
        bytes: Buffer.from("%PDF-1.7\n%%EOF"),
      }),
    ).resolves.toMatchObject({ mime: "application/pdf" });
    await expect(
      validateNutritionDocumentFile({
        name: "menu.pdf",
        type: "application/pdf",
        bytes: Buffer.from("not a pdf"),
      }),
    ).rejects.toThrow(/PDF/);
  });

  it("rejects legacy DOC and files larger than 10 MB", async () => {
    await expect(
      validateNutritionDocumentFile({
        name: "menu.doc",
        type: "application/msword",
        bytes: Buffer.from("x"),
      }),
    ).rejects.toThrow(/DOCX или PDF/);
    await expect(
      validateNutritionDocumentFile({
        name: "menu.pdf",
        type: "application/pdf",
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/10 МБ/);
  });

  it("accepts a structurally valid DOCX and rejects macros or executables", async () => {
    await expect(
      validateNutritionDocumentFile({ name: "menu.docx", type: DOCX, bytes: minimalDocx() }),
    ).resolves.toMatchObject({ mime: DOCX });
    await expect(
      validateNutritionDocumentFile({
        name: "menu.docx",
        type: DOCX,
        bytes: minimalDocx({ "word/vbaProject.bin": "macro" }),
      }),
    ).rejects.toThrow(/макрос/);
    await expect(
      validateNutritionDocumentFile({
        name: "menu.docx",
        type: DOCX,
        bytes: minimalDocx({ "word/embeddings/run.exe": "payload" }),
      }),
    ).rejects.toThrow(/Исполняемые/);
  });

  it("rejects traversal entries and highly compressed ZIP bombs", async () => {
    await expect(
      validateNutritionDocumentFile({
        name: "menu.docx",
        type: DOCX,
        bytes: minimalDocx({ "../outside.txt": "payload" }),
      }),
    ).rejects.toThrow(/путь|Повреждённый DOCX/);
    await expect(
      validateNutritionDocumentFile({
        name: "menu.docx",
        type: DOCX,
        bytes: minimalDocx({ "word/media/huge.txt": "a".repeat(6 * 1024 * 1024) }),
      }),
    ).rejects.toThrow(/ZIP bomb/);
  });

  it("sanitizes script, event handlers and javascript links", () => {
    const html = sanitizeDocumentHtml(
      `<p onclick="alert(1)">Меню<script>alert(1)</script><a href="javascript:alert(2)">x</a></p>`,
    );
    expect(html).not.toMatch(/script|onclick|javascript/i);
    expect(html).toContain("Меню");
  });
});
