import fs from "node:fs";
import path from "node:path";
import { loadSelfhostEnvFiles } from "../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool } from "../src/lib/selfhost/db";
import {
  importClients,
  printImportReport,
  type ImportRunReport,
} from "../src/lib/selfhost/import-client";

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
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(target, name));
  }
  return [target];
}

async function main() {
  const file = arg("--file") ?? arg("--dir");
  if (!file) {
    throw new Error("Укажите --file <path> или каталог с JSON-экспортами");
  }
  const dryRun = hasFlag("--dry-run");
  const files = collectFiles(path.resolve(file));
  if (files.length === 0) throw new Error("JSON-файлы не найдены");

  const pool = getPostgresPool();
  const merged: ImportRunReport = { dryRun, clients: [], failed: [] };
  for (const filePath of files) {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const report = await importClients(() => pool.connect(), payload, { dryRun });
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
