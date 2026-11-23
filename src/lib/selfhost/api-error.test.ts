import { describe, expect, it, vi } from "vitest";
import {
  apiErrorMessage,
  coerceJsonApiResponse,
  isJsonMediaType,
  jsonApiError,
  logServerError,
  readApiPayload,
  rebuildFailureMessage,
} from "@/lib/selfhost/api-error";

describe("nutrition API JSON contract", () => {
  it("never turns an HTML gateway page into a JSON parse", async () => {
    const html = `<html>
<head><title>504 Gateway Time-out</title></head>
<body><center><h1>504 Gateway Time-out</h1></center></body>
</html>`;
    const gateway = new Response(html, {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    const coerced = coerceJsonApiResponse(gateway);
    expect(coerced.status).toBe(504);
    expect(coerced.headers.get("content-type")).toContain("application/json");
    const text = await coerced.text();
    expect(text.trim().startsWith("<")).toBe(false);
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("non_json");
    expect(body.error.message).not.toMatch(/Unexpected token/);
    expect(rebuildFailureMessage(504)).toBe(
      "Не удалось пересобрать рацион. Сервер вернул ошибку 504. Повторите попытку",
    );
  });

  it("keeps success and error bodies as application/json", async () => {
    expect(isJsonMediaType("application/json; charset=utf-8")).toBe(true);
    const ok = new Response(JSON.stringify({ saved: true, days: [] }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(coerceJsonApiResponse(ok)).toBe(ok);
    const error = jsonApiError(422, "Нельзя опубликовать невалидный план", "unprocessable");
    expect(error.headers.get("content-type")).toContain("application/json");
    expect(apiErrorMessage(await error.json())).toBe("Нельзя опубликовать невалидный план");
    expect(apiErrorMessage({ error: "Нужно войти в кабинет" })).toBe("Нужно войти в кабинет");
  });

  it("не пишет параметр p закрытой ссылки в лог", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(
      new Error("плеер https://rutube.ru/video/private/cccccccccccccccccccccccccccccccc/?p=keep_me-2"),
    );
    const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain("keep_me-2");
    expect(logged).toContain("p=***");
    spy.mockRestore();
  });

  it("frontend does not parse an HTML response as JSON", async () => {
    const response = new Response("<html> <h1>504 Gateway Time-out</h1>", {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    await expect(readApiPayload(response, rebuildFailureMessage(response.status))).rejects.toThrow(
      "Не удалось пересобрать рацион. Сервер вернул ошибку 504. Повторите попытку",
    );
  });
});
