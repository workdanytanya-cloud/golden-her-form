/**
 * Display-only overrides for ingredient weighing notes / product names.
 * Does not mutate stored snapshots / catalog rows.
 */

const EGG_WHOLE_DISPLAY =
  "Взвешивать без скорлупы: белок и желток вместе. 1 яйцо категории С1 — примерно 50 г.";

const PASTEURIZED_EGG_WHITE_DISPLAY =
  "Готовый жидкий белок из упаковки. Отмерить указанное количество в граммах.";

const EGG_WHOLE_PRODUCT_NAME = "Яйцо куриное";
const EGG_WHITE_PRODUCT_NAME = "Яичный белок";

const EGG_WHOLE_SLUGS = new Set(["egg-whole"]);
const EGG_WHITE_SLUGS = new Set(["egg-white-raw"]);

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .replace(/[.~]+$/g, "")
    .replace(/c1/gi, "с1");
}

function isEggWholeName(name: string): boolean {
  const n = normalize(name);
  return n === "яйца" || n === "яйцо" || n.startsWith("яйца ") || n.startsWith("яйцо ");
}

function isPasteurizedEggWhiteName(name: string): boolean {
  const n = normalize(name);
  return (
    (n.includes("пастеризованн") && n.includes("белок")) ||
    n === "яичный белок" ||
    n === "готовый пастеризованный яичный белок"
  );
}

function isTechnicalEggWholeLabel(name: string): boolean {
  const n = normalize(name);
  return (
    n === "яйца" ||
    n === "яйцо" ||
    n.includes("съедобная часть") ||
    n.startsWith("яйца ") ||
    n.startsWith("яйцо ")
  );
}

function isLegacyEggWholeNote(note: string): boolean {
  const n = normalize(note);
  return n.includes("съедобная часть") && n.includes("яйц") && n.includes("50");
}

function isLegacyEggWhiteNote(note: string): boolean {
  const n = normalize(note);
  return n.includes("взвешивать сырым") && n.includes("без скорлупы");
}

export type WeighingNoteDisplayInput = {
  product_id?: string | null;
  product_name?: string | null;
  weighing_note?: string | null;
  product_slug?: string | null;
};

/**
 * Returns the client/admin/PDF facing weighing note.
 * Returns null when there is nothing to show.
 */
export function displayWeighingNote(input: WeighingNoteDisplayInput): string | null {
  const slug = normalize(input.product_slug ?? "");
  const id = normalize(input.product_id ?? "");
  const name = input.product_name ?? "";
  const note = input.weighing_note ?? null;

  const looksEggWhole =
    EGG_WHOLE_SLUGS.has(slug) ||
    EGG_WHOLE_SLUGS.has(id) ||
    isEggWholeName(name) ||
    (note != null && isLegacyEggWholeNote(note) && !isPasteurizedEggWhiteName(name));

  if (looksEggWhole && !isPasteurizedEggWhiteName(name)) {
    return EGG_WHOLE_DISPLAY;
  }

  const looksEggWhite =
    EGG_WHITE_SLUGS.has(slug) ||
    EGG_WHITE_SLUGS.has(id) ||
    isPasteurizedEggWhiteName(name) ||
    (note != null && isLegacyEggWhiteNote(note));

  if (looksEggWhite) {
    return PASTEURIZED_EGG_WHITE_DISPLAY;
  }

  const trimmed = note?.trim() || "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Client/admin/PDF facing product title (display-only). */
export function displayProductName(input: WeighingNoteDisplayInput): string {
  const slug = normalize(input.product_slug ?? "");
  const id = normalize(input.product_id ?? "");
  const name = (input.product_name ?? "").trim();
  const note = input.weighing_note ?? null;

  if (
    EGG_WHITE_SLUGS.has(slug) ||
    EGG_WHITE_SLUGS.has(id) ||
    isPasteurizedEggWhiteName(name) ||
    (note != null && isLegacyEggWhiteNote(note) && !isTechnicalEggWholeLabel(name))
  ) {
    return EGG_WHITE_PRODUCT_NAME;
  }

  if (
    EGG_WHOLE_SLUGS.has(slug) ||
    EGG_WHOLE_SLUGS.has(id) ||
    isTechnicalEggWholeLabel(name) ||
    (note != null && isLegacyEggWholeNote(note))
  ) {
    return EGG_WHOLE_PRODUCT_NAME;
  }

  return name;
}

export const WEIGHING_NOTE_DISPLAY = {
  eggWhole: EGG_WHOLE_DISPLAY,
  pasteurizedEggWhite: PASTEURIZED_EGG_WHITE_DISPLAY,
  eggWholeName: EGG_WHOLE_PRODUCT_NAME,
  eggWhiteName: EGG_WHITE_PRODUCT_NAME,
} as const;
