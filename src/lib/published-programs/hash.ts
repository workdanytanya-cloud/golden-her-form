/** Детерминированный хеш snapshot — без дат и случайных id публикации. */

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function contentHash(value: unknown): string {
  const s = stableStringify(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")}:${s.length}`;
}

export function assertUnchangedHash(snapshot: unknown, expected: string): boolean {
  return contentHash(snapshot) === expected;
}
