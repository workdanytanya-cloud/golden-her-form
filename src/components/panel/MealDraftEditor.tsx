import { useEffect, useState } from "react";
import type { FoodProduct, MealPlanItem } from "@/lib/nutrition-constructor/types";

type Line = { productId: string; name: string; grams: string };

type Props = {
  open: boolean;
  title: string;
  item: MealPlanItem | null;
  products: FoodProduct[];
  busy: boolean;
  onClose: () => void;
  onSave: (value: {
    name: string;
    steps: string[];
    prepTimeMin: number | null;
    note: string | null;
    lines: Array<{ productId: string; grams: number }>;
  }) => void;
};

export function MealDraftEditor({ open, title, item, products, busy, onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("");
  const [prep, setPrep] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setName(item.recipe_name);
    setSteps((item.steps ?? []).join("\n"));
    setPrep(item.prep_time_min == null ? "" : String(item.prep_time_min));
    setNote(item.weighing_note ?? "");
    setLines(
      item.ingredients.map((line) => ({
        productId: line.product_id,
        name: line.product_name,
        grams: String(Math.round(Number(line.grams))),
      })),
    );
  }, [open, item]);

  if (!open || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <form
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-gold/20 bg-background p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          onSave({
            name,
            steps: steps
              .split("\n")
              .map((step) => step.trim())
              .filter(Boolean),
            prepTimeMin: prep.trim() ? Number(prep) : null,
            note: note.trim() || null,
            lines: lines.map((line) => ({ productId: line.productId, grams: Number(line.grams) })),
          });
        }}
      >
        <p className="text-[11px] uppercase tracking-widest text-warm-gray">Редактировать приём</p>
        <h3 className="mt-1 font-display text-xl text-ivory">{title}</h3>
        <label className="mt-4 block text-sm text-warm-gray">
          Название
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-gold/20 bg-surface px-3 py-2 text-ivory"
          />
        </label>
        <div className="mt-4 space-y-2">
          {lines.map((line, index) => (
            <div key={`${line.productId}-${index}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ivory">{line.name}</span>
              <input
                value={line.grams}
                inputMode="decimal"
                onChange={(event) =>
                  setLines((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, grams: event.target.value } : row,
                    ),
                  )
                }
                className="w-24 rounded-xl border border-gold/20 bg-surface px-3 py-2 text-ivory"
              />
              <span className="text-xs text-warm-gray">г</span>
              <button
                type="button"
                className="text-xs uppercase tracking-widest text-coral"
                onClick={() =>
                  setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))
                }
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-gold/20 bg-surface px-3 py-2 text-sm text-ivory"
          >
            <option value="">Добавить продукт</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-full border border-gold/30 px-3 text-xs uppercase tracking-widest text-ivory"
            onClick={() => {
              const product = products.find((row) => row.id === productId);
              if (!product) return;
              setLines((current) => [
                ...current,
                { productId: product.id, name: product.name, grams: "50" },
              ]);
              setProductId("");
            }}
          >
            Добавить
          </button>
        </div>
        <label className="mt-4 block text-sm text-warm-gray">
          Инструкция, один шаг на строку
          <textarea
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            rows={6}
            className="mt-1 w-full rounded-xl border border-gold/20 bg-surface px-3 py-2 text-ivory"
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-warm-gray">
            Время, мин
            <input
              value={prep}
              onChange={(event) => setPrep(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gold/20 bg-surface px-3 py-2 text-ivory"
            />
          </label>
          <label className="text-sm text-warm-gray">
            Подача
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gold/20 bg-surface px-3 py-2 text-ivory"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-warm-gray">
            Закрыть
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2 text-xs uppercase tracking-widest text-background disabled:opacity-50"
          >
            {busy ? "Сохраняем…" : "Сохранить изменения"}
          </button>
        </div>
      </form>
    </div>
  );
}
