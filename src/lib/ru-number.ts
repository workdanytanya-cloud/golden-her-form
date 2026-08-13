/** Parse numbers typed with comma or dot (68,4 → 68.4). */
export function parseRuNumber(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Whole numbers for Postgres `integer` columns (1.5 → 2). */
export function parseRuInt(raw: string): number | null {
  const n = parseRuNumber(raw);
  if (n == null) return null;
  return Math.round(n);
}

/**
 * Height for `profiles.height_cm` (integer).
 * Values like 1.65 / 1,70 are treated as meters → cm.
 */
export function parseHeightCm(raw: string): number | null {
  const n = parseRuNumber(raw);
  if (n == null) return null;
  const cm = n > 0 && n < 3 ? n * 100 : n;
  return Math.round(cm);
}

export function isRuNumberInRange(
  raw: string,
  min: number,
  max: number,
  allowEmpty = false,
): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return allowEmpty;
  const n = parseRuNumber(s);
  return n != null && n >= min && n <= max;
}

export function isHeightCmInRange(raw: string, allowEmpty = false): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return allowEmpty;
  const cm = parseHeightCm(s);
  return cm != null && cm >= 120 && cm <= 230;
}
