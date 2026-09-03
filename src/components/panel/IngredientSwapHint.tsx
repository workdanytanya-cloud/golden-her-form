import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { ProductMacros, SwapSuggestion } from "@/lib/nutrition-constructor/ingredient-swap";
import { suggestSwaps } from "@/lib/nutrition-constructor/ingredient-swap";

type Props = {
  productId: string;
  productName: string;
  grams: number;
  /** Полный каталог продуктов для подбора замен. */
  catalog: ProductMacros[];
};

export function IngredientSwapHint({ productId, productName, grams, catalog }: Props) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SwapSuggestion[] | null>(null);

  const handleToggle = () => {
    if (!open && !suggestions) {
      const source = catalog.find((p) => p.id === productId);
      if (!source) {
        setSuggestions([]);
      } else {
        setSuggestions(suggestSwaps(source, grams, catalog, 3));
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-gold/70 hover:text-gold transition-colors"
        title="Показать варианты замены"
      >
        <ArrowRightLeft className="h-3 w-3" />
        {open ? "Скрыть замены" : "Чем заменить?"}
      </button>

      {open && suggestions && suggestions.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {suggestions.map((s) => (
            <div
              key={s.product.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-gold/5 border border-gold/10 px-3 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <span className="text-ivory">{s.product.name}</span>
                <span className="ml-1 text-warm-gray">
                  — {s.grams} г
                </span>
              </div>
              <div className="shrink-0 text-[10px] text-warm-gray">
                {s.kcal} ккал · Б{s.protein_g} Ж{s.fat_g} У{s.carbs_g}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && suggestions && suggestions.length === 0 && (
        <p className="mt-1 text-[10px] text-warm-gray/60">Подходящих замен не найдено</p>
      )}
    </div>
  );
}
