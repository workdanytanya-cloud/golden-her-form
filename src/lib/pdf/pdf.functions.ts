import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPublishedProgramRepository } from "@/lib/platform";
import { buildNutritionPdf, buildTrainingPdf, pdfDownloadHeaders } from "@/lib/pdf/render-pdf";
import {
  requirePublishedSnapshot,
  resolvePdfClientId,
  type PdfKind,
} from "@/lib/pdf/snapshot-content";

const inputSchema = z.object({
  kind: z.enum(["nutrition", "training"]),
  courseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export const downloadPublishedPdfFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    const access = resolvePdfClientId({
      sessionUserId: context.userId,
      isAdmin: Boolean(roleRow),
      requestedClientId: data.clientId,
    });
    if (!access.ok) {
      throw Object.assign(new Error(access.message), { statusCode: access.status });
    }

    const repo = getPublishedProgramRepository();
    const kind: PdfKind = data.kind;
    let buffer: Buffer;
    let issuedAt: string;
    const meta = await repo.getPdfAccessMeta(access.clientId, data.courseId);

    if (kind === "nutrition") {
      const record = await repo.getActivePublishedNutrition(access.clientId, data.courseId);
      const published = requirePublishedSnapshot(record);
      if (!("snapshot" in published)) {
        throw Object.assign(new Error(published.message), { statusCode: published.status });
      }
      issuedAt = record?.version.published_at?.slice(0, 10) ?? published.issuedAt;
      buffer = await buildNutritionPdf(published.snapshot, { ...meta, issuedAt });
    } else {
      const record = await repo.getActivePublishedTraining(access.clientId, data.courseId);
      const published = requirePublishedSnapshot(record);
      if (!("snapshot" in published)) {
        throw Object.assign(new Error(published.message), { statusCode: published.status });
      }
      issuedAt = record?.version.published_at?.slice(0, 10) ?? published.issuedAt;
      buffer = await buildTrainingPdf(published.snapshot, { ...meta, issuedAt });
    }
    const headers = pdfDownloadHeaders(kind, issuedAt, meta.clientName);
    return {
      filename: headers["Content-Disposition"].match(/filename\*=UTF-8''([^;]+)/)?.[1]
        ? decodeURIComponent(headers["Content-Disposition"].match(/filename\*=UTF-8''([^;]+)/)![1]!)
        : (headers["Content-Disposition"].match(/filename="([^"]+)"/)?.[1] ?? "panovapro.pdf"),
      contentType: headers["Content-Type"],
      cacheControl: headers["Cache-Control"],
      pdfBase64: buffer.toString("base64"),
    };
  });
