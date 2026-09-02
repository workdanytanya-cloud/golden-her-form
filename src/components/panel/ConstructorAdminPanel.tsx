import { useEffect, useMemo, useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConstructorNutritionView } from "@/components/panel/ConstructorNutritionView";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import {
  DEFAULT_TOLERANCE,
  MEAL_SCHEDULE_LABELS,
  MEAL_SCHEDULE_MODES,
  PLAN_DAY_OPTIONS,
  PRIMARY_MEAL_SLOT_LABELS,
  PRIMARY_MEAL_SLOTS,
  expectedMainCount,
  expectedSnackCount,
  toleranceForMode,
  type MealScheduleMode,
  type PlanDaysCount,
  type PlanSlot,
  type PrimaryMealSlot,
} from "@/lib/nutrition-constructor/config";
import { checkDayStructure } from "@/lib/nutrition-constructor/types";
import {
  d,
  displayMacro,
  snapshotMacro,
  sumMacros,
} from "@/lib/nutrition-constructor/decimal-math";
import {
  generateAndValidateConstructorPlan,
  recalculateMealItem,
  buildInMemoryCatalog,
  loadConstructorPlanFor,
  saveConstructorPlan,
} from "@/lib/nutrition-constructor/repo";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import { evaluatePlanKbjuStatus } from "@/lib/nutrition-constructor/plan-kbju-status";
import { formatMacroDeviationSummary } from "@/lib/nutrition-constructor/validation-messages";
import type { TargetProfileInput } from "@/lib/nutrition-constructor/targets";
import {
  loadPublishedNutritionFor,
  publishConstructorNutrition,
} from "@/lib/published-programs/repo";

type Props = {
  userId: string;
  courseId?: string | null;
  profile: TargetProfileInput & {
    pregnancy_status?: string | null;
    health_conditions?: string | null;
  };
  excludedProductIds?: string[];
  onSaved?: () => void;
};

function structureChecks(day: ConstructorDay | undefined, mode: MealScheduleMode) {
  if (!day) {
    return checkDayStructure(
      {
        day_index: 0,
        day_note: null,
        items: [],
        kcal: "0",
        protein_g: "0",
        fat_g: "0",
        carbs_g: "0",
        fiber_g: "0",
        is_valid: false,
      },
      mode,
    );
  }
  return checkDayStructure(day, mode);
}

export function ConstructorAdminPanel({
  userId,
  courseId,
  profile,
  excludedProductIds = [],
  onSaved,
}: Props) {
  const [daysCount, setDaysCount] = useState<PlanDaysCount>(7);
  const [scheduleMode, setScheduleMode] = useState<MealScheduleMode>("three_main_two_snacks");
  const [primarySlot, setPrimarySlot] = useState<PrimaryMealSlot>("lunch");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<ConstructorDay[]>([]);
  const [comparison, setComparison] = useState<
    Array<{ label: string; target: number; actual: number; diff: number }>
  >([]);
  const [targets, setTargets] = useState({ kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 });
  const [planStatus, setPlanStatus] = useState<"draft" | "validated" | "assigned">("draft");
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ bmr?: number; tdee?: number; adjustment_pct?: number }>({});
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const catalog = useMemo(() => buildInMemoryCatalog(), []);

  useEffect(() => {
    void (async () => {
      const pub = await loadPublishedNutritionFor(userId, courseId);
      setPublishedVersion(pub?.version?.version ?? null);
      const { plan, days: loaded } = await loadConstructorPlanFor(userId, courseId);
      if (!plan || loaded.length === 0) return;
      setDays(
        loaded.map((row) => ({
          day_index: row.day_index,
          day_note: row.day_note,
          items: row.items,
          kcal: row.kcal,
          protein_g: row.protein_g,
          fat_g: row.fat_g,
          carbs_g: row.carbs_g,
          fiber_g: row.fiber_g,
          is_valid: row.is_valid,
        })),
      );
      setTargets({
        kcal: plan.target_kcal,
        protein_g: plan.target_protein_g,
        fat_g: plan.target_fat_g,
        carbs_g: plan.target_carbs_g,
      });
      setPlanStatus(plan.plan_status);
      setDaysCount((plan.plan_days_count as PlanDaysCount) || 7);
      setScheduleMode(plan.meal_schedule_mode ?? "two_main_two_snacks");
      setPrimarySlot(plan.primary_meal_slot ?? "lunch");
      setComparison(
        comparisonRows(
          {
            kcal: d(plan.target_kcal),
            protein_g: d(plan.target_protein_g),
            fat_g: d(plan.target_fat_g),
            carbs_g: d(plan.target_carbs_g),
            fiber_g: d(0),
          },
          {
            kcal: d(loaded[0]?.kcal ?? plan.target_kcal),
            protein_g: d(loaded[0]?.protein_g ?? plan.target_protein_g),
            fat_g: d(loaded[0]?.fat_g ?? plan.target_fat_g),
            carbs_g: d(loaded[0]?.carbs_g ?? plan.target_carbs_g),
            fiber_g: d(0),
          },
        ),
      );
    })();
  }, [userId, courseId]);

  const kbjuTolerance = useMemo(() => toleranceForMode(scheduleMode), [scheduleMode]);

  const targetMacro = useMemo(
    () => ({
      kcal: d(targets.kcal),
      protein_g: d(targets.protein_g),
      fat_g: d(targets.fat_g),
      carbs_g: d(targets.carbs_g),
      fiber_g: d(0),
    }),
    [targets],
  );

  const kbjuStatus = useMemo(
    () =>
      evaluatePlanKbjuStatus({
        days,
        targetMacro,
        scheduleMode,
        comparison,
      }),
    [days, targetMacro, scheduleMode, comparison],
  );

  const deviationSummary = useMemo(
    () => (comparison.length > 0 ? formatMacroDeviationSummary(comparison, kbjuTolerance) : ""),
    [comparison, kbjuTolerance],
  );

  const revalidate = (nextDays: ConstructorDay[]) => {
    const nextComparison =
      nextDays.length > 0
        ? comparisonRows(
            targetMacro,
            (() => {
              const avgTotals = sumMacros(
                nextDays.map((day) => ({
                  kcal: d(day.kcal),
                  protein_g: d(day.protein_g),
                  fat_g: d(day.fat_g),
                  carbs_g: d(day.carbs_g),
                  fiber_g: d(day.fiber_g),
                })),
              );
              return {
                kcal: avgTotals.kcal.div(nextDays.length),
                protein_g: avgTotals.protein_g.div(nextDays.length),
                fat_g: avgTotals.fat_g.div(nextDays.length),
                carbs_g: avgTotals.carbs_g.div(nextDays.length),
                fiber_g: avgTotals.fiber_g.div(nextDays.length),
              };
            })(),
          )
        : comparison;

    if (nextDays.length > 0) {
      setComparison(nextComparison);
    }

    const status = evaluatePlanKbjuStatus({
      days: nextDays,
      targetMacro,
      scheduleMode,
      comparison: nextComparison,
    });
    setPlanStatus(status.generationOk ? "validated" : "draft");
    return status;
  };

  const handleGenerate = async () => {
    setLoading(true);
    setDays([]);
    try {
      const result = await generateAndValidateConstructorPlan({
        profile: { ...profile, profile_complete: true },
        days_count: daysCount,
        excluded_product_ids: excludedProductIds,
        meal_schedule_mode: scheduleMode,
        primary_meal_slot: primarySlot,
      });
      setMeta({
        bmr: result.bmr.toNumber(),
        tdee: result.tdee.toNumber(),
        adjustment_pct: result.adjustment_pct,
      });
      if (result.days.length === 0) {
        toast.error(result.message ?? "Не удалось собрать рацион");
        return;
      }
      setDays(result.days);
      setComparison(result.comparison);
      setTargets(displayMacro(result.targets));
      setReviewReason(result.review_reason);
      const status = evaluatePlanKbjuStatus({
        days: result.days,
        targetMacro: result.targets,
        scheduleMode,
        comparison: result.comparison,
      });
      setPlanStatus(status.generationOk ? "validated" : "draft");
      if (result.days.length === 0) return;
      if (status.generationOk) {
        if (status.precisionHint) {
          toast.success("Рацион собран", {
            description: `Для идеально точного попадания в цель: ${status.precisionHint}.`,
            duration: 12000,
          });
        } else {
          toast.success("Рацион собран и прошёл проверку");
        }
      } else {
        toast.warning(result.message ?? "Рацион требует доработки тренером", { duration: 12000 });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (assign: boolean) => {
    if (days.length === 0) return;
    const status = revalidate(days);
    if (assign && !status.acceptable) {
      const hint = status.precisionHint
        ? ` Для точного попадания: ${status.precisionHint}.`
        : deviationSummary
          ? ` Отклонение: ${deviationSummary}.`
          : "";
      toast.error(`Нельзя назначить: KBJU вне допуска режима.${hint}`);
      return;
    }
    setSaving(true);
    try {
      if (assign) {
        const result = await publishConstructorNutrition({
          userId,
          courseId,
          days,
          plan: {
            target_kcal: targets.kcal,
            target_protein_g: targets.protein_g,
            target_fat_g: targets.fat_g,
            target_carbs_g: targets.carbs_g,
            bmr: meta.bmr ?? null,
            tdee: meta.tdee ?? null,
            calorie_adjustment_pct: meta.adjustment_pct ?? null,
            meal_schedule_mode: scheduleMode,
            primary_meal_slot: primarySlot,
            notes: null,
            plan_days_count: daysCount,
          },
          reason: publishedVersion ? "Опубликована новая версия меню" : "Первое назначение клиенту",
        });
        setPlanStatus("assigned");
        toast.success(
          result.usedRpc
            ? "Меню опубликовано клиенту (неизменяемая версия)"
            : "Рацион назначен (миграция версий ещё не применена — выполните SQL)",
        );
        const pub = await loadPublishedNutritionFor(userId, courseId);
        setPublishedVersion(pub?.version?.version ?? publishedVersion);
      } else {
        await saveConstructorPlan({
          userId,
          courseId,
          days,
          targets,
          plan_days_count: daysCount,
          plan_status: status.generationOk ? "validated" : "draft",
          bmr: meta.bmr,
          tdee: meta.tdee,
          calorie_adjustment_pct: meta.adjustment_pct,
          requires_manual_review: !status.acceptable,
          review_reason: reviewReason,
          targets_manual: true,
          meal_schedule_mode: scheduleMode,
          primary_meal_slot: primarySlot,
        });
        setPlanStatus(status.generationOk ? "validated" : "draft");
        toast.success("Черновик сохранён. Клиент по-прежнему видит опубликованную версию.");
      }
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleGramsChange = async (
    dayIndex: number,
    slot: PlanSlot,
    productId: string,
    grams: number,
  ) => {
    setDays((cur) => {
      const next = cur.map((day) => {
        if (day.day_index !== dayIndex) return day;
        const items = day.items.map((item) => {
          if (item.slot !== slot) return item;
          const newIngs = item.ingredients.map((ing) =>
            ing.product_id === productId ? { ...ing, grams: String(grams) } : ing,
          );
          return recalculateMealItem({ ...item, ingredients: newIngs }, catalog.products);
        });
        const totals = sumMacros(
          items.map((i) => ({
            kcal: d(i.kcal),
            protein_g: d(i.protein_g),
            fat_g: d(i.fat_g),
            carbs_g: d(i.carbs_g),
            fiber_g: d(i.fiber_g),
          })),
        );
        const snap = snapshotMacro(totals);
        return {
          ...day,
          items,
          kcal: snap.kcal,
          protein_g: snap.protein_g,
          fat_g: snap.fat_g,
          carbs_g: snap.carbs_g,
          fiber_g: snap.fiber_g,
          is_valid: false,
        };
      });
      revalidate(next);
      return next;
    });
    toast.message("Граммовка изменена — перепроверьте день");
  };

  const checks = structureChecks(days[0], scheduleMode);
  const structureOk =
    checks.mains.actual === checks.mains.expected &&
    checks.snacks.actual === checks.snacks.expected &&
    (expectedSnackCount(scheduleMode) === 0 ||
      checks.noCookSnacks.actual === checks.noCookSnacks.expected);

  return (
    <section className="space-y-6 rounded-3xl border border-gold/20 bg-surface/30 p-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gold">Конструктор рациона</p>
        <p className="mt-1 text-sm text-warm-gray">
          Точный расчёт KBJU · только проверенные продукты · режимы: 5 приёмов, 3 основных или 1+3
        </p>
        {publishedVersion != null && (
          <p className="mt-2 rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-xs text-warm-gray">
            Клиент видит опубликованную версию v{publishedVersion}. Черновик и пересборка не меняют
            её, пока не нажмёте «Опубликовать новую версию».
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Структура рациона
          </span>
          <select
            value={scheduleMode}
            onChange={(e) => {
              setScheduleMode(e.target.value as MealScheduleMode);
              setDays([]);
            }}
            className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm text-ivory"
          >
            {MEAL_SCHEDULE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {MEAL_SCHEDULE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        {scheduleMode === "one_main_three_snacks" && (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
              Когда удобнее основной приём?
            </span>
            <select
              value={primarySlot}
              onChange={(e) => setPrimarySlot(e.target.value as PrimaryMealSlot)}
              className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm text-ivory"
            >
              {PRIMARY_MEAL_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {PRIMARY_MEAL_SLOT_LABELS[slot]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Период меню
          </span>
          <select
            value={daysCount}
            onChange={(e) => setDaysCount(Number(e.target.value) as PlanDaysCount)}
            className="w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm text-ivory"
          >
            {PLAN_DAY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "день" : "дней"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {scheduleMode === "one_main_three_snacks" && (
        <p className="rounded-xl border border-gold/15 bg-gold/5 px-3 py-2 text-sm leading-relaxed text-warm-gray">
          <span className="font-medium text-ivory">На бегу: </span>
          один полноценный приём в выбранное время и три перекуса без готовки — для плотного
          графика и питания вне дома.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleGenerate()}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {loading ? "Сборка…" : "Сгенерировать рацион"}
        </button>
        {days.length > 0 && (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave(false)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Сохраняем…" : "Сохранить черновик"}
            </button>
            <button
              type="button"
              disabled={saving || !kbjuStatus.acceptable}
              onClick={() => void handleSave(true)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory disabled:opacity-40"
            >
              {publishedVersion != null ? "Опубликовать новую версию" : "Назначить клиенту"}
            </button>
          </>
        )}
      </div>

      {days.length > 0 && (
        <div className="grid gap-2 rounded-2xl border border-gold/15 bg-surface/20 p-4 text-sm sm:grid-cols-2">
          <CheckRow
            label="Основных приёмов"
            actual={checks.mains.actual}
            expected={checks.mains.expected}
          />
          <CheckRow
            label="Перекусов"
            actual={checks.snacks.actual}
            expected={checks.snacks.expected}
          />
          <CheckRow
            label="Перекусов без приготовления"
            actual={checks.noCookSnacks.actual}
            expected={checks.noCookSnacks.expected}
          />
          {scheduleMode === "one_main_three_snacks" && (
            <CheckRow
              label="Полезных перекусов"
              actual={checks.nutrientDenseSnacks.actual}
              expected={checks.nutrientDenseSnacks.expected}
            />
          )}
          <p className="sm:col-span-2 text-xs text-warm-gray">
            Статус:{" "}
            <span className={kbjuStatus.acceptable ? "text-gold" : "text-coral"}>
              {kbjuStatus.acceptable
                ? "Рацион сбалансирован — можно назначать"
                : "Рацион не прошёл проверку — назначение запрещено"}
            </span>
            {!structureOk &&
              ` · структура: ${checks.mains.actual}/${expectedMainCount(scheduleMode)} основных, ${checks.snacks.actual}/${expectedSnackCount(scheduleMode)} перекусов`}
            {kbjuStatus.generationOk && kbjuStatus.precisionHint ? (
              <span className="mt-1 block text-[10px] leading-relaxed text-warm-gray/90">
                Для идеально точного попадания в цель (±1&nbsp;г / ±5&nbsp;ккал):{" "}
                {kbjuStatus.precisionHint}
              </span>
            ) : null}
            {!kbjuStatus.generationOk && deviationSummary ? (
              <span className="mt-1 block text-coral">Отклонение: {deviationSummary}</span>
            ) : null}
          </p>
        </div>
      )}

      {reviewReason && (
        <p className="rounded-xl border border-coral/20 bg-coral/5 px-4 py-3 text-sm text-warm-gray">
          {reviewReason}
        </p>
      )}

      {days.length > 0 && (
        <ConstructorNutritionView
          days={days}
          comparison={comparison}
          targets={targets}
          planStatus={planStatus}
          kbjuAcceptable={kbjuStatus.acceptable}
          precisionHint={kbjuStatus.precisionHint}
          mealScheduleMode={scheduleMode}
          primaryMealSlot={primarySlot}
          editable
          onIngredientGramsChange={handleGramsChange}
        />
      )}
    </section>
  );
}

function CheckRow({
  label,
  actual,
  expected,
}: {
  label: string;
  actual: number;
  expected: number;
}) {
  const ok = actual === expected;
  return (
    <p className={ok ? "text-ivory" : "text-coral"}>
      {label}: {actual} из {expected} {ok ? "✓" : "✗"}
    </p>
  );
}
