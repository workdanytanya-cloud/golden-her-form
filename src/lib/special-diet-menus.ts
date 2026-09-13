/**
 * Специальные меню питания (не столы Певзнера).
 * Id совпадает с тегом в dishes.tags — как у table_N.
 */
export type SpecialDietMenu = {
  id: string;
  title: string;
  shortTitle: string;
  indication: string;
};

/** Без сахара / глютена / лактозы / дрожжей / быстрых углеводов — не «противокандидная» формулировка. */
export const SPECIAL_MENU_NO_SUGAR_GLUTEN_LACTOSE = "special_no_sugar_gluten_lactose";

export const SPECIAL_DIET_MENUS: SpecialDietMenu[] = [
  {
    id: SPECIAL_MENU_NO_SUGAR_GLUTEN_LACTOSE,
    shortTitle: "Без сахара, глютена и лактозы",
    title: "Меню без сахара, глютена и лактозы",
    indication:
      "Исключены: сахар и любые подсластители (включая мёд и сиропы), дрожжи, глютен (пшеница, рожь, ячмень, овёс, обычный хлеб и макароны), лактоза и молочные продукты с ней, алкоголь, быстрые углеводы, сладкие фрукты и соки, крахмалистые овощи (картофель, батат, кукуруза), белый рис и каши быстрого приготовления. В рационе — белок, некрахмалистые овощи, гречка/киноа, яйца, рыба, птица, полезные жиры.",
  },
];

export function getSpecialDietMenu(id: string | null | undefined) {
  if (!id || id === "none") return null;
  return SPECIAL_DIET_MENUS.find((m) => m.id === id) ?? null;
}

export function isSpecialDietMenuId(id: string | null | undefined): boolean {
  return Boolean(id && SPECIAL_DIET_MENUS.some((m) => m.id === id));
}
