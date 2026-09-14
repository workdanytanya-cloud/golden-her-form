import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import {
  buildCourseTitleFromISO,
  courseEndDate,
  parseISODate,
  toISODate,
  type ClientCourseStatus,
} from "@/lib/client-courses/format";
import type { ClientCourse } from "@/lib/client-courses/repo";
import { withTransaction } from "@/lib/selfhost/db";

type Queryable = Pool | PoolClient;

export const adminCourseCreateSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  activate: z.boolean().optional().default(false),
  cloneFromCourseId: z.string().uuid().nullable().optional(),
});

export const adminCourseUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
});

function mapCourse(row: Record<string, unknown>): ClientCourse {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    title: String(row.title),
    start_date: String(row.start_date).slice(0, 10),
    end_date: String(row.end_date).slice(0, 10),
    status: row.status as ClientCourseStatus,
    created_at: new Date(row.created_at as string | Date).toISOString(),
    created_by: (row.created_by as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

export async function resolveClientCourseIdPg(
  db: Queryable,
  clientId: string,
  courseId?: string | null,
): Promise<string | null> {
  if (courseId) {
    const { rows } = await db.query(
      `SELECT id FROM public.client_courses WHERE id = $1 AND client_id = $2`,
      [courseId, clientId],
    );
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  }
  const active = await db.query(
    `SELECT id FROM public.client_courses
      WHERE client_id = $1 AND status = 'active'
      ORDER BY start_date DESC LIMIT 1`,
    [clientId],
  );
  if (active.rows[0]) return (active.rows[0] as { id: string }).id;
  const any = await db.query(
    `SELECT id FROM public.client_courses WHERE client_id = $1 ORDER BY start_date DESC LIMIT 1`,
    [clientId],
  );
  return (any.rows[0] as { id: string } | undefined)?.id ?? null;
}

export class PostgresClientCourseRepository {
  constructor(private readonly db: Pool) {}

  async list(clientId: string): Promise<ClientCourse[]> {
    const { rows } = await this.db.query(
      `SELECT id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes
         FROM public.client_courses WHERE client_id = $1 ORDER BY start_date DESC`,
      [clientId],
    );
    return rows.map((row) => mapCourse(row as Record<string, unknown>));
  }

  async get(courseId: string): Promise<ClientCourse | null> {
    const { rows } = await this.db.query(
      `SELECT id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes
         FROM public.client_courses WHERE id = $1`,
      [courseId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapCourse(row) : null;
  }

  async publishedCount(courseId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT (
         (SELECT count(*) FROM public.nutrition_plan_versions WHERE course_id = $1 AND status = 'published')
         + (SELECT count(*) FROM public.training_program_versions WHERE course_id = $1 AND status = 'published')
       )::int AS n`,
      [courseId],
    );
    return Number((rows[0] as { n: number }).n ?? 0);
  }

  async create(
    input: z.infer<typeof adminCourseCreateSchema>,
    actorId: string,
  ): Promise<ClientCourse> {
    const data = adminCourseCreateSchema.parse(input);
    const start = data.startDate ? parseISODate(data.startDate) : new Date();
    const startIso = toISODate(start);
    const endIso = toISODate(courseEndDate(start));
    const title = buildCourseTitleFromISO(startIso);
    const status: ClientCourseStatus = data.activate ? "active" : "draft";

    return withTransaction(async (client) => {
      if (data.activate) {
        await client.query(
          `UPDATE public.client_courses SET status = 'completed'
            WHERE client_id = $1 AND status = 'active'`,
          [data.clientId],
        );
      }
      const inserted = await client.query(
        `INSERT INTO public.client_courses (client_id, title, start_date, end_date, status, notes, created_by)
         VALUES ($1,$2,$3::date,$4::date,$5,$6,$7)
         RETURNING id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes`,
        [data.clientId, title, startIso, endIso, status, data.notes ?? null, actorId],
      );
      const created = mapCourse(inserted.rows[0] as Record<string, unknown>);
      const fallback = await client.query(
        `SELECT id FROM public.client_courses
          WHERE client_id = $1 AND id <> $2 AND status <> 'draft'
          ORDER BY start_date DESC LIMIT 1`,
        [data.clientId, created.id],
      );
      const sourceCourseId =
        data.cloneFromCourseId ?? (fallback.rows[0] as { id: string } | undefined)?.id ?? null;
      if (sourceCourseId) {
        const { cloneNutritionPlanPg } = await import("@/lib/selfhost/postgres-nutrition");
        await cloneNutritionPlanPg(client, sourceCourseId, created.id, data.clientId);
      }
      return created;
    });
  }

  async update(
    courseId: string,
    clientId: string,
    patch: z.infer<typeof adminCourseUpdateSchema>,
  ): Promise<ClientCourse> {
    const data = adminCourseUpdateSchema.parse(patch);
    const course = await this.get(courseId);
    if (!course || course.client_id !== clientId) {
      throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
    }
    if (data.status === "active") {
      await this.activate(courseId, clientId);
      const next = await this.get(courseId);
      if (!next) throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
      return next;
    }
    const updated = await this.db.query(
      `UPDATE public.client_courses SET
         title = COALESCE($3, title),
         start_date = COALESCE($4::date, start_date),
         end_date = COALESCE($5::date, end_date),
         notes = COALESCE($6, notes),
         status = COALESCE($7, status)
       WHERE id = $1 AND client_id = $2
       RETURNING id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes`,
      [
        courseId,
        clientId,
        data.title ?? null,
        data.start_date ?? null,
        data.end_date ?? null,
        data.notes === undefined ? null : data.notes,
        data.status ?? null,
      ],
    );
    return mapCourse(updated.rows[0] as Record<string, unknown>);
  }

  async activate(courseId: string, clientId: string): Promise<void> {
    await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT id FROM public.client_courses WHERE id = $1 AND client_id = $2`,
        [courseId, clientId],
      );
      if (!found.rowCount) throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
      await client.query(
        `UPDATE public.client_courses SET status = 'completed' WHERE client_id = $1 AND status = 'active' AND id <> $2`,
        [clientId, courseId],
      );
      await client.query(
        `UPDATE public.client_courses SET status = 'active' WHERE id = $1 AND client_id = $2`,
        [courseId, clientId],
      );
    });
  }

  async archive(courseId: string, clientId: string): Promise<void> {
    const course = await this.get(courseId);
    if (!course || course.client_id !== clientId) {
      throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
    }
    await this.db.query(
      `UPDATE public.client_courses SET status = 'archived' WHERE id = $1 AND client_id = $2`,
      [courseId, clientId],
    );
  }

  async removeDraft(courseId: string, clientId: string): Promise<void> {
    const course = await this.get(courseId);
    if (!course || course.client_id !== clientId) {
      throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
    }
    const published = await this.publishedCount(courseId);
    if (published > 0) {
      throw Object.assign(
        new Error("Курс с опубликованными программами нельзя удалить — только архивировать"),
        { statusCode: 409 },
      );
    }
    if (course.status !== "draft") {
      throw Object.assign(new Error("Удалить можно только черновик"), { statusCode: 400 });
    }
    await this.db.query(
      `DELETE FROM public.client_courses WHERE id = $1 AND client_id = $2 AND status = 'draft'`,
      [courseId, clientId],
    );
  }
}
