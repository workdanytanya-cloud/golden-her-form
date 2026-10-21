import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePostgresPool } from "./db";
import { applyMigrations } from "./migrate";
import {
  createNutritionDocumentDraft,
  listNutritionDocuments,
  loadNutritionDocument,
  publishNutritionDocument,
} from "./nutrition-documents";
import { assertCourseScopePg } from "./postgres-courses";

const url = process.env.SELFHOST_DOCUMENTS_TEST_DATABASE_URL;
const run = Boolean(url);
const ADMIN = "31000000-0000-4000-8000-000000000001";
const CLIENT_A = "31000000-0000-4000-8000-000000000002";
const CLIENT_B = "31000000-0000-4000-8000-000000000003";
const COURSE_N = "31000000-0000-4000-8000-000000000011";
const COURSE_T = "31000000-0000-4000-8000-000000000012";
const COURSE_B = "31000000-0000-4000-8000-000000000013";

function docx(): Buffer {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Тестовое меню</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
  );
}

describe.runIf(run)("course scope and nutrition documents PostgreSQL integration", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATA_BACKEND = "postgres";
    process.env.AUTH_BACKEND = "local";
    process.env.SELFHOST_MEDIA_ROOT = fs.mkdtempSync(
      path.join(os.tmpdir(), "panova-course-documents-"),
    );
    pool = new pg.Pool({ connectionString: url });
    await applyMigrations(pool);
    await pool.query(
      `INSERT INTO users (id,email,password_hash) VALUES
       ($1,'scope-admin@example.invalid','test'),
       ($2,'scope-a@example.invalid','test'),
       ($3,'scope-b@example.invalid','test')
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN, CLIENT_A, CLIENT_B],
    );
    await pool.query(
      `INSERT INTO client_courses (id,client_id,title,start_date,end_date,status,created_by,program_scope)
       VALUES ($1,$4,'Nutrition','2026-01-01','2026-01-28','active',$6,'nutrition'),
              ($2,$4,'Training','2026-02-01','2026-02-28','draft',$6,'training'),
              ($3,$5,'Both','2026-01-01','2026-01-28','active',$6,'both')
       ON CONFLICT (id) DO UPDATE SET program_scope=excluded.program_scope`,
      [COURSE_N, COURSE_T, COURSE_B, CLIENT_A, CLIENT_B, ADMIN],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await closePostgresPool();
  });

  it("enforces nutrition, training and both scopes", async () => {
    await expect(assertCourseScopePg(pool, CLIENT_A, COURSE_N, "nutrition")).resolves.toBe(
      COURSE_N,
    );
    await expect(assertCourseScopePg(pool, CLIENT_A, COURSE_N, "training")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(assertCourseScopePg(pool, CLIENT_A, COURSE_T, "training")).resolves.toBe(COURSE_T);
    await expect(assertCourseScopePg(pool, CLIENT_A, COURSE_T, "nutrition")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(assertCourseScopePg(pool, CLIENT_B, COURSE_B, "nutrition")).resolves.toBe(
      COURSE_B,
    );
    await expect(assertCourseScopePg(pool, CLIENT_B, COURSE_B, "training")).resolves.toBe(COURSE_B);
    await expect(assertCourseScopePg(pool, CLIENT_B, COURSE_N, "nutrition")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("versions PDF and DOCX and keeps originals private", async () => {
    const first = await createNutritionDocumentDraft(
      pool,
      ADMIN,
      { clientId: CLIENT_A, courseId: COURSE_N, title: "PDF", displayMode: "primary" },
      { name: "menu.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.7\n%%EOF") },
    );
    expect(first.version).toBeGreaterThan(0);
    expect((await publishNutritionDocument(pool, first.id, ADMIN)).status).toBe("published");

    const second = await createNutritionDocumentDraft(
      pool,
      ADMIN,
      {
        clientId: CLIENT_A,
        courseId: COURSE_N,
        title: "DOCX",
        displayMode: "primary",
        replacesId: first.id,
      },
      {
        name: "menu.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: docx(),
      },
    );
    expect(second.version).toBe(first.version + 1);
    expect((await publishNutritionDocument(pool, second.id, ADMIN)).status).toBe("published");
    const rows = await listNutritionDocuments(pool, CLIENT_A, COURSE_N, false);
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(["published", "superseded"]),
    );
    await expect(loadNutritionDocument(pool, second.id, CLIENT_A, false)).resolves.toMatchObject({
      row: {
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    });
    await expect(loadNutritionDocument(pool, second.id, CLIENT_B, false)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("keeps published snapshot and content_hash immutable", async () => {
    const id = "31000000-0000-4000-8000-000000000021";
    await pool.query(
      `INSERT INTO nutrition_plan_versions
       (id,client_id,course_id,version,status,snapshot,content_hash,published_at)
       VALUES ($1,$2,$3,501,'published',$4::jsonb,'fixed-content-hash',now())
       ON CONFLICT (id) DO NOTHING`,
      [id, CLIENT_A, COURSE_N, JSON.stringify({ fixed: true })],
    );
    await expect(
      pool.query(`UPDATE nutrition_plan_versions SET content_hash='changed' WHERE id=$1`, [id]),
    ).rejects.toThrow(/нельзя изменять/);
    const { rows } = await pool.query(
      `SELECT snapshot,content_hash FROM nutrition_plan_versions WHERE id=$1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      snapshot: { fixed: true },
      content_hash: "fixed-content-hash",
    });
  });
});
