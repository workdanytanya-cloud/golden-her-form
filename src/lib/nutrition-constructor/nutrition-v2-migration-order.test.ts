import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260902140000_nutrition_constructor_v2.sql",
);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}

function firstIndex(sql: string, pattern: RegExp): number {
  const match = pattern.exec(sql);
  return match ? match.index : -1;
}

describe("nutrition constructor v2 migration SQL order", () => {
  const sql = stripSqlComments(readFileSync(MIGRATION_PATH, "utf8"));

  it("adds food_products.allergen_tags before the first UPDATE that writes it", () => {
    const addAt = firstIndex(
      sql,
      /ALTER\s+TABLE\s+public\.food_products\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+allergen_tags\b/i,
    );
    const updateAt = firstIndex(sql, /UPDATE\s+public\.food_products[\s\S]*?\ballergen_tags\s*=/i);

    expect(addAt).toBeGreaterThanOrEqual(0);
    expect(updateAt).toBeGreaterThanOrEqual(0);
    expect(addAt).toBeLessThan(updateAt);
  });

  it("places every ADD COLUMN IF NOT EXISTS before dependent UPDATE, constraint, index, and function uses", () => {
    const added = [
      ...sql.matchAll(
        /ALTER\s+TABLE\s+public\.(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\b/gi,
      ),
    ];
    expect(added.length).toBeGreaterThan(0);

    for (const match of added) {
      const table = match[1]!;
      const column = match[2]!;
      const addAt = match.index ?? -1;
      const afterAdd = sql.slice(addAt + match[0].length);
      const dependent = firstIndex(
        afterAdd,
        new RegExp(
          String.raw`(?:` +
            String.raw`UPDATE\s+public\.${table}\b[\s\S]*?\b${column}\s*=` +
            String.raw`|ADD\s+CONSTRAINT\b[\s\S]{0,400}\b${column}\b` +
            String.raw`|CREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]{0,400}\b${column}\b` +
            String.raw`|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]{0,800}\b${column}\b` +
            String.raw`)`,
          "i",
        ),
      );

      if (dependent >= 0) {
        expect(addAt).toBeLessThan(addAt + match[0].length + dependent);
      }

      const earlierUse = firstIndex(
        sql.slice(0, addAt),
        new RegExp(
          String.raw`(?:` +
            String.raw`UPDATE\s+public\.${table}\b[\s\S]*?\b${column}\s*=` +
            String.raw`|ADD\s+CONSTRAINT\b[\s\S]{0,400}\b${column}\b` +
            String.raw`|CREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]{0,400}\b${column}\b` +
            String.raw`|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]{0,800}\b${column}\b` +
            String.raw`)`,
          "i",
        ),
      );
      expect(earlierUse, `${table}.${column} is used before ADD COLUMN`).toBe(-1);
    }
  });
});
