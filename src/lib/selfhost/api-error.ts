export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
  500: "internal",
  502: "bad_gateway",
  503: "unavailable",
  504: "gateway_timeout",
};

export function apiErrorCode(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "internal" : "bad_request");
}

export function apiErrorMessage(data: unknown, fallback = "Ошибка сервера"): string {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function rebuildFailureMessage(status: number): string {
  return `Не удалось пересобрать рацион. Сервер вернул ошибку ${status}. Повторите попытку`;
}

export function isJsonMediaType(contentType: string | null | undefined): boolean {
  return (contentType ?? "").toLowerCase().includes("application/json");
}

export function jsonApiError(
  status: number,
  message: string,
  code?: string,
  extra?: Record<string, unknown>,
): Response {
  const body: ApiErrorBody & Record<string, unknown> = {
    error: { code: code ?? apiErrorCode(status), message },
    ...extra,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** /api никогда не отдаёт HTML, страницу входа или SPA fallback. */
export function coerceJsonApiResponse(response: Response): Response {
  if (isJsonMediaType(response.headers.get("content-type"))) return response;
  const status = response.status >= 400 ? response.status : 500;
  return jsonApiError(status, "Сервер вернул некорректный ответ", "non_json");
}

export async function readApiPayload(
  response: Response,
  nonJsonMessage: string,
): Promise<Record<string, unknown>> {
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    throw new Error(nonJsonMessage);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(nonJsonMessage);
  }
}

export function logServerError(error: unknown): void {
  const raw = error instanceof Error ? error.message : "Ошибка сервера";
  const safe = raw
    .replace(/postgres:\/\/\S+/gi, "postgres://***")
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, "***")
    .slice(0, 300);
  console.error("[selfhost]", safe);
}
