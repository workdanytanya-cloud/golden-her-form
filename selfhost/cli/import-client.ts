import fs from "node:fs";
import path from "node:path";
import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { parseClientExportCsv } from "../../src/lib/selfhost/csv-export";
import { closePostgresPool, getPostgresPool } from "../../src/lib/selfhost/db";
import {
  importClients,
  printImportReport,
  type ImportRunReport,
} from "../../src/lib/selfhost/import-client";

loadSelfhostEnvFiles();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function collectFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(target)
      .filter((name) => name.endsWith(".json") || name.endsWith(".csv"))
      .sort()
      .map((name) => path.join(target, name));
  }
  return [target];
}

function loadPayload(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".csv") {
    const rows = parseClientExportCsv(raw);
    return rows.length === 1 ? rows[0] : rows;
  }
  return JSON.parse(raw) as unknown;
}

async function main() {
  const file = arg("--file") ?? arg("--dir");
  if (!file) {
    throw new Error("Укажите --file <path> или каталог с JSON/CSV-экспортами");
  }
  const dryRun = hasFlag("--dry-run");
  const email = arg("--email")?.trim().toLowerCase();
  const files = collectFiles(path.resolve(file));
  if (files.length === 0) throw new Error("Файлы JSON/CSV не найдены");

  const merged: ImportRunReport = { dryRun, matchCount: 0, clients: [], failed: [] };
  const pool = dryRun ? null : getPostgresPool();
  for (const filePath of files) {
    const payload = loadPayload(filePath);
    const report = await importClients(
      () => {
        if (!pool) throw new Error("DATABASE_URL нужен только для реального импорта");
        return pool.connect();
      },
      payload,
      { dryRun, email },
    );
    merged.matchCount += report.matchCount;
    merged.clients.push(...report.clients);
    merged.failed.push(...report.failed);
  }
  printImportReport(merged);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
