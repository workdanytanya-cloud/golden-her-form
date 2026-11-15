import type { Pool } from "pg";
import { courseWindowForAccess } from "@/lib/client-courses/access-window";
import {
  loadConstructorPlanPg,
  publishNutritionVersionPg,
} from "@/lib/selfhost/postgres-nutrition";
import { loadTrainingDraftPg, publishTrainingVersionPg } from "@/lib/selfhost/postgres-training";

type KindResult = "published" | "already" | "skipped" | "failed";

export type CourseAccessReveal = {
  courseId: string | null;
  startDate: string | null;
  endDate: string | null;
  shifted: boolean;
  nutrition: KindResult;
  training: KindResult;
  nutritionError: string | null;
  trainingError: string | null;
};

const empty: CourseAccessReveal = {
  courseId: null,
  startDate: null,
  endDate: null,
  shifted: false,
  nutrition: "skipped",
  training: "skipped",
  nutritionError: null,
  trainingError: null,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось опубликовать программу";
}

export async function revealCourseOnAccessPg(
  pool: Pool,
  clientId: string,
  actorId: string,
): Promise<CourseAccessReveal> {
  const access = await pool.query(
    `SELECT status, activated_at FROM public.client_access WHERE user_id = $1`,
    [clientId],
  );
  const accessRow = access.rows[0] as
    { status?: string; activated_at?: Date | string | null } | undefined;
  if (accessRow?.status !== "active" || !accessRow.activated_at) return empty;

  const course = await pool.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date, program_scope
       FROM public.client_courses
      WHERE client_id = $1 AND status = 'active'
      ORDER BY start_date DESC
      LIMIT 1`,
    [clientId],
  );
  const row = course.rows[0] as
    { id: string; start_date: string; end_date: string; program_scope: string } | undefined;
  if (!row) return empty;

  const window = courseWindowForAccess(new Date(accessRow.activated_at), row.start_date);
  if (window.shifted) {
    await pool.query(
      `UPDATE public.client_courses
          SET start_date = $2::date, end_date = $3::date, title = $4
        WHERE id = $1 AND client_id = $5`,
      [row.id, window.start, window.end, window.title, clientId],
    );
  }

  const scope = row.program_scope;
  const result: CourseAccessReveal = {
    courseId: row.id,
    startDate: window.shifted ? window.start : row.start_date.slice(0, 10),
    endDate: window.shifted ? window.end : row.end_date.slice(0, 10),
    shifted: window.shifted,
    nutrition: "skipped",
    training: "skipped",
    nutritionError: null,
    trainingError: null,
  };

  if (scope === "nutrition" || scope === "both") {
    const published = await pool.query(
      `SELECT id FROM public.nutrition_plan_versions
        WHERE client_id = $1 AND course_id = $2 AND status = 'published' LIMIT 1`,
      [clientId, row.id],
    );
    if ((published.rowCount ?? 0) > 0) {
      result.nutrition = "already";
    } else {
      try {
        const loaded = await loadConstructorPlanPg(pool, clientId, row.id);
        if (!loaded.plan || loaded.days.length === 0) {
          result.nutrition = "skipped";
        } else {
          await publishNutritionVersionPg(pool, {
            clientId,
            courseId: row.id,
            actorId,
            reason: "Курс открыт клиенту",
            days: loaded.days,
            plan: loaded.plan,
          });
          result.nutrition = "published";
        }
      } catch (error) {
        result.nutrition = "failed";
        result.nutritionError = messageOf(error);
      }
    }
  }

  if (scope === "training" || scope === "both") {
    const published = await pool.query(
      `SELECT id FROM public.training_program_versions
        WHERE client_id = $1 AND course_id = $2 AND status = 'published' LIMIT 1`,
      [clientId, row.id],
    );
    if ((published.rowCount ?? 0) > 0) {
      result.training = "already";
    } else {
      try {
        const draft = await loadTrainingDraftPg(pool, clientId, row.id);
        if (!draft.program || draft.days.length === 0) {
          result.training = "skipped";
        } else {
          await publishTrainingVersionPg(pool, {
            clientId,
            courseId: row.id,
            actorId,
            reason: "Курс открыт клиенту",
          });
          result.training = "published";
        }
      } catch (error) {
        result.training = "failed";
        result.trainingError = messageOf(error);
      }
    }
  }

  return result;
}
