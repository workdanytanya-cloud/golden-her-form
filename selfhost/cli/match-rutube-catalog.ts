import { readFileSync } from "node:fs";
import { matchStudioClips, type CatalogCard, type StudioClip } from "../../src/lib/rutube-catalog-match";

const catalogPath = process.argv[2];
const listPath = process.argv[3];
if (!catalogPath || !listPath) {
  throw new Error("Нужны пути к каталогу и локальному списку роликов");
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, "")) as Array<{
  id: string;
  name: string;
  category: string;
  equipment: string[] | null;
  archived: boolean;
  description: string | null;
}>;
const videos = (
  JSON.parse(readFileSync(listPath, "utf8")) as { videos: Array<{ title: string; url: string }> }
).videos;

const cards: CatalogCard[] = catalog.map((row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  equipment: row.equipment ?? [],
  archived: Boolean(row.archived),
  description: row.description ?? "",
}));
const clips: StudioClip[] = videos.map((video) => ({
  title: video.title,
  videoId: video.url.match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase() ?? video.title,
}));
const decisions = matchStudioClips(clips, cards);
const bind = decisions.filter((item) => item.kind === "bind");
const review = decisions.filter((item) => item.kind === "review");
const skip = decisions.filter((item) => item.kind === "skip");
const archiveIds = new Set(bind.flatMap((item) => (item.kind === "bind" ? item.archiveIds : [])));
const categories = new Map<string, number>();
for (const item of bind) {
  if (item.kind !== "bind") continue;
  const card = cards.find((row) => row.id === item.exerciseId);
  if (!card) continue;
  categories.set(card.category, (categories.get(card.category) ?? 0) + 1);
}
console.log(
  JSON.stringify(
    {
      clips: clips.length,
      bind: bind.length,
      review: review.length,
      skip: skip.length,
      archive: archiveIds.size,
      categories: Object.fromEntries(categories),
      reviewTitles: review.map((item) => `${item.title} — ${item.reason}`),
      skipTitles: skip.map((item) => item.title),
    },
    null,
    2,
  ),
);
