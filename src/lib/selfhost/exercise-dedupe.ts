/** Ключ видео для сверки дублей: совпадение названий само по себе не считается дублем. */
export function exerciseVideoDedupeKey(raw: string | null | undefined): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  const youtuBe = value.match(/youtu\.be\/([a-z0-9_-]{6,})/i)?.[1];
  const watch = value.match(/[?&]v=([a-z0-9_-]{6,})/i)?.[1];
  const embed = value.match(/\/(?:embed|shorts)\/([a-z0-9_-]{6,})/i)?.[1];
  const yt = youtuBe || watch || embed;
  if (yt) return `yt:${yt.toLowerCase()}`;
  const rutube = value.match(/rutube\.ru\/video\/([a-f0-9]{32})/i)?.[1];
  if (rutube) return `rt:${rutube.toLowerCase()}`;
  return value;
}

export function exerciseEquipmentDedupeKey(equipment: string[] | null | undefined): string {
  return [...new Set((equipment ?? []).map((item) => item.trim()).filter(Boolean))]
    .sort()
    .join("|");
}

export type ExerciseDedupeCard = {
  id: string;
  name: string;
  category: string;
  equipment: string[];
  video_url: string | null;
  archived: boolean;
  publishedUseCount?: number;
  description?: string | null;
};

export function exerciseVariantDedupeKey(card: ExerciseDedupeCard): string | null {
  const video = exerciseVideoDedupeKey(card.video_url);
  if (!video) return null;
  return `${card.category}::${exerciseEquipmentDedupeKey(card.equipment)}::${video}`;
}

/** Подтверждённый дубль = то же движение/вариант (категория+инвентарь) и то же видео. */
export function planExerciseArchiveDuplicates(cards: ExerciseDedupeCard[]): {
  keepIds: string[];
  archiveIds: string[];
} {
  const groups = new Map<string, ExerciseDedupeCard[]>();
  for (const card of cards) {
    const key = exerciseVariantDedupeKey(card);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }
  const keepIds: string[] = [];
  const archiveIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => {
      const aActive = a.archived ? 1 : 0;
      const bActive = b.archived ? 1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      const use = (b.publishedUseCount ?? 0) - (a.publishedUseCount ?? 0);
      if (use !== 0) return use;
      const desc = (b.description?.length ?? 0) - (a.description?.length ?? 0);
      if (desc !== 0) return desc;
      return a.id.localeCompare(b.id);
    });
    keepIds.push(ranked[0]!.id);
    for (const extra of ranked.slice(1)) {
      if (!extra.archived) archiveIds.push(extra.id);
    }
  }
  return { keepIds, archiveIds };
}
