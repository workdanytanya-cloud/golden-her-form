export type CatalogCard = {
  id: string;
  name: string;
  category: string;
  equipment: string[];
  archived: boolean;
  description: string;
};

export type StudioClip = {
  title: string;
  videoId: string;
};

export type MatchDecision =
  | {
      kind: "bind";
      title: string;
      videoId: string;
      exerciseId: string;
      archiveIds: string[];
    }
  | { kind: "review"; title: string; videoId: string; reason: string }
  | { kind: "skip"; title: string; videoId: string; reason: string };

const ALIAS_TO_CATALOG: Record<string, string> = {
  "собака птица": "bird dog",
};

export function normalizeExerciseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\.mp4/g, "")
    .replace(/\d+\s*мин\.?/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWholeSession(title: string): boolean {
  const name = normalizeExerciseTitle(title);
  return /^(тренировка|мини тренировка|как делать замеры|как пользоваться|где брать мотивацию|ютуб)( |$)/.test(
    name,
  );
}

function isNamedComplex(title: string): boolean {
  const name = normalizeExerciseTitle(title);
  return /^комплекс\b/.test(name);
}

function descriptionScore(card: CatalogCard): number {
  const text = card.description || "";
  let score = text.length;
  if (card.archived) score -= 1000;
  if (/rutube/i.test(text)) score += 80;
  if (/база|разогрев|укрепля|растяж|изометр|стабилиз|профилактик/i.test(text)) score += 40;
  if (/из личной библиотеки|из программы тренера/i.test(text) && text.length < 140) score -= 25;
  return score;
}

function sameVariant(left: CatalogCard, right: CatalogCard): boolean {
  const equipment = (cards: string[]) => [...cards].filter(Boolean).sort().join("|");
  return left.category === right.category && equipment(left.equipment) === equipment(right.equipment);
}

export function matchStudioClips(clips: StudioClip[], cards: CatalogCard[]): MatchDecision[] {
  const byName = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const key = normalizeExerciseTitle(card.name);
    const list = byName.get(key) ?? [];
    list.push(card);
    byName.set(key, list);
  }
  const titleCounts = new Map<string, number>();
  for (const clip of clips) {
    const key = normalizeExerciseTitle(clip.title);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  return clips.map((clip) => {
    const key = normalizeExerciseTitle(clip.title);
    if ((titleCounts.get(key) ?? 0) > 1) {
      return {
        kind: "review",
        title: clip.title,
        videoId: clip.videoId,
        reason: "в списке несколько роликов с одним названием и разными ссылками",
      };
    }
    if (isWholeSession(clip.title)) {
      return {
        kind: "skip",
        title: clip.title,
        videoId: clip.videoId,
        reason: "это целая тренировка или инструкция, не одно упражнение",
      };
    }
    const catalogKey = ALIAS_TO_CATALOG[key] ?? key;
    const found = byName.get(catalogKey) ?? [];
    if (found.length === 0) {
      if (isNamedComplex(clip.title)) {
        return {
          kind: "review",
          title: clip.title,
          videoId: clip.videoId,
          reason: "похоже на комплекс из нескольких движений",
        };
      }
      return {
        kind: "review",
        title: clip.title,
        videoId: clip.videoId,
        reason: "в каталоге нет уверенного соответствия, технику по названию не определяю",
      };
    }
    const active = found.filter((card) => !card.archived);
    const pool = active.length > 0 ? active : found;
    const primary = [...pool].sort((a, b) => descriptionScore(b) - descriptionScore(a))[0]!;
    const variants = new Set(pool.map((card) => `${card.category}:${[...card.equipment].sort().join("|")}`));
    if (variants.size > 1) {
      return {
        kind: "review",
        title: clip.title,
        videoId: clip.videoId,
        reason: "в каталоге несколько карточек с разной категорией или инвентарём",
      };
    }
    const archiveIds = pool
      .filter((card) => card.id !== primary.id && sameVariant(card, primary) && !card.archived)
      .map((card) => card.id);
    return {
      kind: "bind",
      title: clip.title,
      videoId: clip.videoId,
      exerciseId: primary.id,
      archiveIds,
    };
  });
}
