import { loadSelfhostEnvFiles } from "../src/lib/selfhost/load-env";
import { applyMigrations } from "../src/lib/selfhost/migrate";
import { closePostgresPool, getPostgresPool } from "../src/lib/selfhost/db";
import { isProduction } from "../src/lib/selfhost/config";

loadSelfhostEnvFiles();

async function main() {
  if (isProduction() && process.env.SELFHOST_MIGRATE_CONFIRM !== "APPLY") {
    throw new Error(
      "На production миграции запускаются только явной командой с SELFHOST_MIGRATE_CONFIRM=APPLY",
    );
  }
  const result = await applyMigrations(getPostgresPool());
  console.log(JSON.stringify({ applied: result.applied, skipped: result.skipped }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
