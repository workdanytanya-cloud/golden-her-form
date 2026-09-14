import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { tryDeleteUnreferencedMedia } from "@/lib/selfhost/local-media-store";

export type Queryable = Pool | PoolClient;

const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

export const adminDishUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i, "Slug: латиница, цифры, дефис или подчёркивание"),
  name: z.string().trim().min(1).max(200),
  meal_type: mealTypeSchema,
  description: z.string().max(5000).nullable().optional(),
  portion_weight_g: z.number().int().min(1).max(5000),
  calories_per_100g: z.number().min(0).max(2000),
  protein_per_100g: z.number().min(0).max(200),
  fat_per_100g: z.number().min(0).max(200),
  carbs_per_100g: z.number().min(0).max(200),
  tags: z.array(z.string().trim().min(1).max(80)).max(40).optional().default([]),
  replacements: z.array(z.string().trim().min(1).max(120)).max(40).optional().default([]),
  image_url: z.string().max(2000).nullable().optional(),
  video_url: z.string().max(2000).nullable().optional(),
  ingredients: z
    .array(
      z.object({
        raw: z.string(),
        raw_g: z.number(),
        cooked_g: z.number(),
      }),
    )
    .optional(),
  steps: z.array(z.string()).optional(),
});

export const adminDishListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
});

export type AdminDishRow = {
  id: string;
  slug: string;
  name: string;
  meal_type: string;
  description: string | null;
  portion_weight_g: number;
  calories_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  tags: string[];
  replacements: string[];
  image_url: string | null;
  video_url: string | null;
  ingredients: unknown;
  steps: string[];
  created_at: string;
  updated_at: string;
};

function mapDish(row: Record<string, unknown>): AdminDishRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    meal_type: String(row.meal_type),
    description: (row.description as string | null) ?? null,
    portion_weight_g: Number(row.portion_weight_g),
    calories_per_100g: Number(row.calories_per_100g),
    protein_per_100g: Number(row.protein_per_100g),
    fat_per_100g: Number(row.fat_per_100g),
    carbs_per_100g: Number(row.carbs_per_100g),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    replacements: Array.isArray(row.replacements) ? (row.replacements as string[]) : [],
    image_url: (row.image_url as string | null) ?? null,
    video_url: (row.video_url as string | null) ?? null,
    ingredients: row.ingredients ?? [],
    steps: Array.isArray(row.steps) ? (row.steps as string[]) : [],
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export class PostgresDishRepository {
  constructor(private readonly db: Queryable) {}

  async list(input: { q?: string } = {}): Promise<{ items: AdminDishRow[] }> {
    const parsed = adminDishListQuerySchema.parse(input);
    const params: unknown[] = [];
    let sql = `SELECT * FROM public.dishes`;
    const q = parsed.q.trim();
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` WHERE lower(name) LIKE $1 OR lower(slug) LIKE $1 OR EXISTS (
        SELECT 1 FROM unnest(tags) t WHERE lower(t) LIKE $1
      )`;
    }
    sql += ` ORDER BY meal_type ASC, name ASC`;
    const { rows } = await this.db.query(sql, params);
    return { items: rows.map((row) => mapDish(row as Record<string, unknown>)) };
  }

  async get(id: string): Promise<AdminDishRow | null> {
    const { rows } = await this.db.query(`SELECT * FROM public.dishes WHERE id = $1`, [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapDish(row) : null;
  }

  async upsert(input: z.infer<typeof adminDishUpsertSchema>): Promise<AdminDishRow> {
    const data = adminDishUpsertSchema.parse(input);
    const slugTaken = await this.db.query(
      `SELECT id FROM public.dishes WHERE lower(slug) = lower($1) AND ($2::uuid IS NULL OR id <> $2)`,
      [data.slug, data.id ?? null],
    );
    if (slugTaken.rowCount) {
      throw Object.assign(new Error("Slug уже занят"), { statusCode: 409 });
    }

    let previous: AdminDishRow | null = null;
    if (data.id) {
      previous = await this.get(data.id);
      if (!previous) throw Object.assign(new Error("Блюдо не найдено"), { statusCode: 404 });
    }

    const ingredients = data.ingredients ?? previous?.ingredients ?? [];
    const steps = data.steps ?? previous?.steps ?? [];

    if (data.id) {
      const { rows } = await this.db.query(
        `UPDATE public.dishes SET
           slug = $2,
           name = $3,
           meal_type = $4,
           description = $5,
           portion_weight_g = $6,
           calories_per_100g = $7,
           protein_per_100g = $8,
           fat_per_100g = $9,
           carbs_per_100g = $10,
           tags = $11,
           replacements = $12,
           image_url = $13,
           video_url = $14,
           ingredients = $15::jsonb,
           steps = $16::jsonb,
           updated_at = (now() AT TIME ZONE 'utc')
         WHERE id = $1
         RETURNING *`,
        [
          data.id,
          data.slug,
          data.name,
          data.meal_type,
          data.description ?? null,
          data.portion_weight_g,
          data.calories_per_100g,
          data.protein_per_100g,
          data.fat_per_100g,
          data.carbs_per_100g,
          data.tags,
          data.replacements,
          data.image_url ?? null,
          data.video_url ?? null,
          JSON.stringify(ingredients),
          JSON.stringify(steps),
        ],
      );
      const saved = mapDish(rows[0] as Record<string, unknown>);
      if (previous?.image_url && previous.image_url !== saved.image_url) {
        await tryDeleteUnreferencedMedia(this.db, previous.image_url);
      }
      if (previous?.video_url && previous.video_url !== saved.video_url) {
        await tryDeleteUnreferencedMedia(this.db, previous.video_url);
      }
      return saved;
    }

    const { rows } = await this.db.query(
      `INSERT INTO public.dishes (
         slug, name, meal_type, description, portion_weight_g,
         calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g,
         tags, replacements, image_url, video_url, ingredients, steps
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
       RETURNING *`,
      [
        data.slug,
        data.name,
        data.meal_type,
        data.description ?? null,
        data.portion_weight_g,
        data.calories_per_100g,
        data.protein_per_100g,
        data.fat_per_100g,
        data.carbs_per_100g,
        data.tags,
        data.replacements,
        data.image_url ?? null,
        data.video_url ?? null,
        JSON.stringify(ingredients),
        JSON.stringify(steps),
      ],
    );
    return mapDish(rows[0] as Record<string, unknown>);
  }

  /** True if dish id appears in any nutrition snapshot (published or otherwise). */
  async isReferencedInSnapshots(dishId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM public.nutrition_plan_versions
        WHERE snapshot::text ILIKE '%' || $1 || '%'
        LIMIT 1`,
      [dishId],
    );
    return rows.length > 0;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw Object.assign(new Error("Блюдо не найдено"), { statusCode: 404 });
    if (await this.isReferencedInSnapshots(id)) {
      throw Object.assign(
        new Error("Блюдо используется в опубликованном или сохранённом меню — удаление запрещено"),
        { statusCode: 409 },
      );
    }
    await this.db.query(`DELETE FROM public.dishes WHERE id = $1`, [id]);
    await tryDeleteUnreferencedMedia(this.db, existing.image_url);
    await tryDeleteUnreferencedMedia(this.db, existing.video_url);
  }
}
