import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool, withTransaction } from "../../src/lib/selfhost/db";
import { isProduction } from "../../src/lib/selfhost/config";
import { seedNutritionCatalog } from "../../src/lib/selfhost/postgres-nutrition";

loadSelfhostEnvFiles();

async function main() {
  if (isProduction() && process.env.SELFHOST_CATALOG_CONFIRM !== "APPLY") {
    throw new Error(
      "На production каталог синхронизируется только с SELFHOST_CATALOG_CONFIRM=APPLY",
    );
  }
  const before = await getPostgresPool().query(
    `SELECT
       (SELECT count(*)::int FROM public.food_products) AS products,
       (SELECT count(*)::int FROM public.recipes) AS recipes,
       (SELECT count(*)::int FROM public.recipe_ingredients) AS ingredients`,
  );
  const synced = await withTransaction((client) => seedNutritionCatalog(client));
  const after = await getPostgresPool().query(
    `SELECT
       (SELECT count(*)::int FROM public.food_products) AS products,
       (SELECT count(*)::int FROM public.recipes) AS recipes,
       (SELECT count(*)::int FROM public.recipe_ingredients) AS ingredients`,
  );
  console.log(JSON.stringify({ before: before.rows[0], source: synced, after: after.rows[0] }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
