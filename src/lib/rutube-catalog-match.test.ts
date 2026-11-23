import { describe, expect, it } from "vitest";
import { matchStudioClips, normalizeExerciseTitle, type CatalogCard } from "@/lib/rutube-catalog-match";

function card(partial: Partial<CatalogCard> & Pick<CatalogCard, "id" | "name">): CatalogCard {
  return {
    category: "core",
    equipment: ["mat"],
    archived: false,
    description: "Упражнение из личной библиотеки тренера.",
    ...partial,
  };
}

describe("rutube catalog match", () => {
  it("не сливает ролики с одинаковым названием и разными ссылками", () => {
    const decisions = matchStudioClips(
      [
        { title: "Лодочка", videoId: "a".repeat(32) },
        { title: "Лодочка", videoId: "b".repeat(32) },
      ],
      [card({ id: "1", name: "Лодочка", description: "База для разгибателей спины и ягодиц." })],
    );
    expect(decisions.every((item) => item.kind === "review")).toBe(true);
  });

  it("берёт существующую карточку и архивирует точный дубль", () => {
    const decisions = matchStudioClips(
      [{ title: "Планка", videoId: "c".repeat(32) }],
      [
        card({
          id: "keep",
          name: "Планка",
          description: "База изометрии кора. Работают глубокие стабилизаторы позвоночника.",
        }),
        card({ id: "drop", name: "Планка" }),
      ],
    );
    expect(decisions[0]).toMatchObject({ kind: "bind", exerciseId: "keep", archiveIds: ["drop"] });
  });

  it("не объединяет разные категории и не добавляет целую тренировку", () => {
    const decisions = matchStudioClips(
      [
        { title: "Ягодичный мостик", videoId: "d".repeat(32) },
        { title: "Тренировка 1", videoId: "e".repeat(32) },
      ],
      [
        card({ id: "lower", name: "Ягодичный мостик", category: "strength_lower" }),
        card({ id: "activation", name: "Ягодичный мостик", category: "activation" }),
      ],
    );
    expect(decisions[0]).toMatchObject({ kind: "review" });
    expect(decisions[1]).toMatchObject({ kind: "skip" });
  });

  it("узнаёт карточку после ё, длительности и знака плюс", () => {
    expect(normalizeExerciseTitle("Подъём на носки стоя 2 мин")).toBe("подъем на носки стоя");
    const decisions = matchStudioClips(
      [{ title: "Подъем в диагональ разведение", videoId: "f".repeat(32) }],
      [card({ id: "diag", name: "Подъем в диагональ + разведение", category: "strength_full" })],
    );
    expect(decisions[0]).toMatchObject({ kind: "bind", exerciseId: "diag", archiveIds: [] });
  });
});
