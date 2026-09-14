import { parse } from "csv-parse/sync";
import { ImportAbortError } from "@/lib/selfhost/export-schema";

export function parseClientExportCsv(text: string): unknown[] {
  const records = parse(text, {
    columns: true,
    bom: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (records.length === 0) {
    throw new ImportAbortError("CSV не содержит строк данных");
  }
  const columns = Object.keys(records[0] ?? {});
  const jsonCol = columns.find((name) => name.trim() === "client_export_json");
  if (!jsonCol) {
    throw new ImportAbortError("В CSV нет колонки client_export_json");
  }
  return records.map((row, index) => {
    const cell = row[jsonCol] ?? "";
    if (!cell.trim()) {
      throw new ImportAbortError(`Строка ${index + 1}: пустой client_export_json`);
    }
    try {
      let parsed: unknown = JSON.parse(cell);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      return parsed;
    } catch {
      throw new ImportAbortError(`Строка ${index + 1}: client_export_json не является JSON`);
    }
  });
}
