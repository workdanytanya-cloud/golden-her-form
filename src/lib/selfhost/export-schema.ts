import { z } from "zod";

export class ImportAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportAbortError";
  }
}

const uuid = z.string().uuid();
const optionalUuid = z.string().uuid().nullish();

export const versionRowSchema = z
  .object({
    id: uuid,
    client_id: optionalUuid,
    course_id: optionalUuid,
    version: z.coerce.number().int().positive(),
    status: z.string().min(1),
    snapshot: z.unknown(),
    content_hash: z.string().min(1),
    parent_version_id: optionalUuid,
    published_at: z.string().nullish(),
  })
  .passthrough();

export const assignmentRowSchema = z
  .object({
    id: optionalUuid,
    client_id: optionalUuid,
    kind: z.enum(["nutrition", "training"]),
    course_id: optionalUuid,
    active_version_id: uuid,
  })
  .passthrough();

export const courseRowSchema = z
  .object({
    id: uuid,
    client_id: optionalUuid,
    title: z.string().min(1).optional(),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    status: z.string().optional(),
    notes: z.unknown().optional(),
  })
  .passthrough();

export const canonicalClientExportSchema = z
  .object({
    user: z
      .object({
        id: optionalUuid,
        email: z.string().min(1).optional(),
        password_hash: z.string().nullish(),
        email_verified_at: z.string().nullish(),
        status: z.string().optional(),
      })
      .passthrough()
      .optional(),
    email: z.string().min(1).optional(),
    roles: z.array(z.enum(["admin", "client"])).optional(),
    profile: z.record(z.unknown()).nullish(),
    access: z.record(z.unknown()).nullish(),
    client_access: z.record(z.unknown()).nullish(),
    courses: z.array(courseRowSchema).optional(),
    client_courses: z.array(courseRowSchema).optional(),
    nutrition_versions: z.array(versionRowSchema).optional(),
    nutrition_plan_versions: z.array(versionRowSchema).optional(),
    training_versions: z.array(versionRowSchema).optional(),
    training_program_versions: z.array(versionRowSchema).optional(),
    assignments: z.array(assignmentRowSchema).optional(),
    client_program_assignments: z.array(assignmentRowSchema).optional(),
    exercise_media_bindings: z.array(z.record(z.unknown())).optional(),
    snapshot_exercise_media_bindings: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const emergencyClientExportSchema = z
  .object({
    ok: z.boolean().optional(),
    match_count: z.coerce.number().optional(),
    profile: z.record(z.unknown()).nullish(),
    client_access: z.record(z.unknown()).nullish(),
    active_course: courseRowSchema.nullish(),
    assignments: z
      .object({
        nutrition: assignmentRowSchema.nullish(),
        training: assignmentRowSchema.nullish(),
      })
      .passthrough()
      .optional(),
    published_nutrition: versionRowSchema.nullish(),
    published_training: versionRowSchema.nullish(),
    verification: z.record(z.unknown()).optional(),
  })
  .passthrough();

export function isEmergencyExport(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.published_nutrition != null ||
    obj.published_training != null ||
    obj.active_course != null
  );
}

export function stripActorFields<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  delete copy.created_by;
  delete copy.updated_by;
  delete copy.published_by;
  return copy;
}
