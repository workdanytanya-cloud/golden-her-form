/** Parse numbers typed with comma or dot (68,4 → 68.4). */
export function parseRuNumber(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
