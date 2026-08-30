import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createNutritionCorrectionDraft,
  loadPendingNutritionRecommendation,
} from "@/lib/published-programs/repo";
import type { NutritionRecommendation } from "@/lib/published-programs/types";

type Props = {
  clientId: string;
  onDraftCreated?: () => void;
};

export function NutritionRecommendationPanel({ clientId, onDraftCreated }: Props) {
  const [rec, setRec] = useState<NutritionRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [diff, setDiff] = useState<{
    old_kcal: number;
    new_kcal: number;
    changed_grams: number;
    replaced_meals: string[];
  } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setRec(await loadPendingNutritionRecommendation(clientId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (loading || !rec) return null;

  const rows: Array<{ label: string; assigned: number; recommended: number }> = [
    { label: "Калории", assigned: rec.assigned_kcal, recommended: rec.recommended_kcal },
    { label: "Белки", assigned: rec.assigned_protein_g, recommended: rec.recommended_protein_g },
    { label: "Жиры", assigned: rec.assigned_fat_g, recommended: rec.recommended_fat_g },
    { label: "Углеводы", assigned: rec.assigned_carbs_g, recommended: rec.recommended_carbs_g },
    {
      label: "Вес",
      assigned: rec.assigned_weight_kg ?? 0,
      recommended: rec.new_weight_kg ?? 0,
    },
  ];

  const handleCorrection = async () => {
    setCreating(true);
    try {
      const result = await createNutritionCorrectionDraft({
        userId: clientId,
        recommendation: rec,
      });
      setDiff(result.diff);
      toast.success("Черновик корректировки создан. Клиент видит старую версию до публикации.");
      onDraftCreated?.();
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-coral/25 bg-coral/5 p-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-coral">
          Рекомендация после замеров
        </p>
        <p className="mt-1 text-sm text-warm-gray">
          Активное меню не изменено. Обхваты не входят в формулу Миффлина — только вес, рост,
          возраст, пол и активность.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead>
            <tr className="border-b border-gold/15 text-[10px] uppercase tracking-widest text-warm-gray">
              <th className="py-2 pr-3 font-normal">Показатель</th>
              <th className="py-2 pr-3 text-right font-normal">Назначено сейчас</th>
              <th className="py-2 pr-3 text-right font-normal">Новая рекомендация</th>
              <th className="py-2 text-right font-normal">Разница</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = Math.round((r.recommended - r.assigned) * 10) / 10;
              return (
                <tr key={r.label} className="border-b border-gold/10 text-ivory">
                  <td className="py-2 pr-3">{r.label}</td>
                  <td className="py-2 pr-3 text-right text-warm-gray">{r.assigned || "—"}</td>
                  <td className="py-2 pr-3 text-right">{r.recommended || "—"}</td>
                  <td className="py-2 text-right text-warm-gray">
                    {r.assigned || r.recommended ? (delta > 0 ? `+${delta}` : delta) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        disabled={creating}
        onClick={() => void handleCorrection()}
        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background disabled:opacity-50"
      >
        {creating ? "Создаём…" : "Создать корректировку питания"}
      </button>

      {diff && (
        <div className="rounded-2xl border border-gold/20 bg-surface/30 p-4 text-sm text-warm-gray">
          <p>
            Было {diff.old_kcal} ккал → станет {diff.new_kcal} ккал. Изменено граммовок:{" "}
            {diff.changed_grams}.
          </p>
          {diff.replaced_meals.length > 0 && (
            <p className="mt-1">Замены: {diff.replaced_meals.join("; ")}</p>
          )}
          <p className="mt-2 text-ivory">
            Проверьте черновик в конструкторе и нажмите «Опубликовать новую версию».
          </p>
        </div>
      )}
    </section>
  );
}
