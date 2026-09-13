import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConstructorNutritionView } from "@/components/panel/ConstructorNutritionView";
import {
  TrainerMealEditor,
  type MealEditorMode,
  type MealEditorSubmit,
} from "@/components/panel/TrainerMealEditor";
import { comparisonRows } from "@/lib/nutrition-constructor/calculator";
import {
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
import { d, displayMacro } from "@/lib/nutrition-constructor/decimal-math";
import {
  generateAndValidateConstructorPlan,
  buildInMemoryCatalog,
  loadConstructorPlanFor,
  saveConstructorPlan,
} from "@/lib/nutrition-constructor/repo";
import type { ConstructorDay } from "@/lib/nutrition-constructor/types";
import {
  evaluatePlanKbjuStatus,
  kbjuStatusLabel,
  planStructureValid,
} from "@/lib/nutrition-constructor/plan-kbju-status";
import { formatMacroDeviationSummary } from "@/lib/nutrition-constructor/validation-messages";
import { calcMacroTargets, type TargetProfileInput } from "@/lib/nutrition-constructor/targets";
import { formatUsedTargetsLine } from "@/lib/nutrition-constructor/calculator";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import { shoppingListFromDays } from "@/lib/nutrition-constructor/ingredient-normalize";
import { proposeDayCorrections } from "@/lib/nutrition-constructor/deviation-suggestions";
import {
  addMealToDay,
  deleteMealFromDay,
  mealItemFromProducts,
  mealItemFromRecipe,
  ManualMealEditError,
  replaceDaysDay,
  replaceMealInDay,
  setIngredientGrams,
  ZERO_GRAMS_FORBIDDEN_MESSAGE,
} from "@/lib/nutrition-constructor/manual-meals";
import { planSlotForTrainerChoice } from "@/lib/nutrition-constructor/trainer-slots";
import {
  clonePublishedNutritionToDraft,
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
  restrictions?: { allergies?: string | null; disliked_foods?: string | null };
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

function syncedKcal(protein_g: number, fat_g: number, carbs_g: number) {
  return Math.round(protein_g * 4 + fat_g * 9 + carbs_g * 4);
}

export function ConstructorAdminPanel({
  userId,
  courseId,
  profile,
  restrictions = {},
  excludedProductIds = [],
  onSaved,
}: Props) {
  const autoCalc = useMemo(() => displayMacro(calcMacroTargets(profile).targets), [profile]);
  const [daysCount, setDaysCount] = useState<PlanDaysCount>(7);
  const [scheduleMode, setScheduleMode] = useState<MealScheduleMode>("three_main_two_snacks");
  const [primarySlot, setPrimarySlot] = useState<PrimaryMealSlot>("lunch");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [days, setDays] = useState<ConstructorDay[]>([]);
  const [previewMode, setPreviewMode] = useState<MealScheduleMode | null>(null);
  const [comparison, setComparison] = useState<
    Array<{ label: string; target: number; actual: number; diff: number }>
  >([]);
  const [targets, setTargets] = useState({
    kcal: autoCalc.kcal,
    protein_g: autoCalc.protein_g,
    fat_g: autoCalc.fat_g,
    carbs_g: autoCalc.carbs_g,
  });
  const [usedTargetsLine, setUsedTargetsLine] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<"draft" | "validated" | "assigned">("draft");
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ bmr?: number; tdee?: number; adjustment_pct?: number }>({});
  const [forcePublish, setForcePublish] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [editor, setEditor] = useState<{
    open: boolean;
    mode: MealEditorMode;
    dayIndex: number;
    slot?: PlanSlot;
  }>({ open: false, mode: "add", dayIndex: 0 });
  const catalog = useMemo(() => buildInMemoryCatalog(), []);
  const genToken = useRef(0);

  const forbiddenIds = useMemo(() => {
    const { forbiddenIds: fromAnketa } = buildForbiddenProductIds([...catalog.products.values()], {
      allergies: restrictions.allergies,
      disliked_foods: restrictions.disliked_foods,
      excluded_product_ids: excludedProductIds,
    });
    return fromAnketa;
  }, [catalog.products, restrictions.allergies, restrictions.disliked_foods, excludedProductIds]);

  useEffect(() => {
    void (async () => {
      const pub = await loadPublishedNutritionFor(userId, courseId);
      setPublishedVersion(pub?.version?.version ?? null);
      const { plan, days: loaded } = await loadConstructorPlanFor(userId, courseId);
      if (!plan) return;
      const mode = plan.meal_schedule_mode ?? "two_main_two_snacks";
      setTargets({
        kcal: plan.target_kcal,
        protein_g: plan.target_protein_g,
        fat_g: plan.target_fat_g,
        carbs_g: plan.target_carbs_g,
      });
      setPlanStatus(plan.plan_status);
      setDaysCount((plan.plan_days_count as PlanDaysCount) || 7);
      setScheduleMode(mode);
      setPrimarySlot(plan.primary_meal_slot ?? "lunch");
      const mapped = loaded.map((row) => ({
        day_index: row.day_index,
        day_note: row.day_note,
        items: row.items,
        kcal: row.kcal,
        protein_g: row.protein_g,
        fat_g: row.fat_g,
        carbs_g: row.carbs_g,
        fiber_g: row.fiber_g,
        is_valid: row.is_valid,
      }));
      if (mapped.length > 0 && planStructureValid(mapped, mode)) {
        setDays(mapped);
        setPreviewMode(mode);
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
              kcal: d(mapped[0]?.kcal ?? plan.target_kcal),
              protein_g: d(mapped[0]?.protein_g ?? plan.target_protein_g),
              fat_g: d(mapped[0]?.fat_g ?? plan.target_fat_g),
              carbs_g: d(mapped[0]?.carbs_g ?? plan.target_carbs_g),
              fiber_g: d(0),
            },
          ),
        );
      } else {
        setDays([]);
        setPreviewMode(null);
        if (mapped.length > 0) {
          setGenerationError(
            "Черновик не соответствует выбранному режиму и скрыт, чтобы не показывать старое меню как новое.",
          );
        }
      }
    })();
  }, [userId, courseId]);

  const visibleDays = previewMode === scheduleMode ? days : [];
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

  const dayComparison = useMemo(
    () =>
      visibleDays[0]
        ? comparisonRows(targetMacro, {
            kcal: d(visibleDays[0].kcal),
            protein_g: d(visibleDays[0].protein_g),
            fat_g: d(visibleDays[0].fat_g),
            carbs_g: d(visibleDays[0].carbs_g),
            fiber_g: d(visibleDays[0].fiber_g),
          })
        : comparison,
    [visibleDays, targetMacro, comparison],
  );

  const kbjuStatus = useMemo(
    () =>
      evaluatePlanKbjuStatus({
        days: visibleDays,
        targetMacro,
        scheduleMode,
        comparison: dayComparison,
      }),
    [visibleDays, targetMacro, scheduleMode, dayComparison],
  );

  const deviationSummary = useMemo(
    () => (dayComparison.length > 0 ? formatMacroDeviationSummary(dayComparison, kbjuTolerance) : ""),
    [dayComparison, kbjuTolerance],
  );

  const shoppingList = useMemo(() => shoppingListFromDays(visibleDays), [visibleDays]);

  const editorDay = visibleDays.find((day) => day.day_index === editor.dayIndex) ?? visibleDays[0] ?? null;
  const proposals = useMemo(() => {
    if (!editor.open || (editor.mode !== "suggest" && editor.mode !== "add") || !editorDay) return [];
    return proposeDayCorrections({
      day: editorDay,
      targets: targetMacro,
      products: catalog.products,
    });
  }, [editor, editorDay, targetMacro, catalog.products]);

  const applyDays = (nextDays: ConstructorDay[]) => {
    const nextComparison =
      nextDays[0]
        ? comparisonRows(targetMacro, {
            kcal: d(nextDays[0].kcal),
            protein_g: d(nextDays[0].protein_g),
            fat_g: d(nextDays[0].fat_g),
            carbs_g: d(nextDays[0].carbs_g),
            fiber_g: d(nextDays[0].fiber_g),
          })
        : [];
    setDays(nextDays);
    setComparison(nextComparison);
    const status = evaluatePlanKbjuStatus({
      days: nextDays,
      targetMacro,
      scheduleMode,
      comparison: nextComparison,
    });
    setPlanStatus(status.generationOk ? "validated" : "draft");
    return status;
  };

  const persistDraft = async (nextDays: ConstructorDay[], status = planStatus) => {
    await saveConstructorPlan({
      userId,
      courseId,
      days: nextDays,
      targets,
      plan_days_count: daysCount,
      plan_status: status,
      bmr: meta.bmr,
      tdee: meta.tdee,
      calorie_adjustment_pct: meta.adjustment_pct,
      requires_manual_review: !kbjuStatus.acceptable,
      review_reason: reviewReason,
      targets_manual: true,
      meal_schedule_mode: scheduleMode,
      primary_meal_slot: primarySlot,
    });
  };

  const clearPreview = (reason?: string | null) => {
    genToken.current += 1;
    setDays([]);
    setPreviewMode(null);
    setComparison([]);
    setGenerationError(reason ?? null);
    setUsedTargetsLine(null);
  };

  const handleGenerate = async () => {
    const seq = ++genToken.current;
    const fieldTargets = {
      kcal: syncedKcal(targets.protein_g, targets.fat_g, targets.carbs_g),
      protein_g: targets.protein_g,
      fat_g: targets.fat_g,
      carbs_g: targets.carbs_g,
    };
    setTargets(fieldTargets);
    setLoading(true);
    setDays([]);
    setPreviewMode(null);
    setGenerationError(null);
    const line = formatUsedTargetsLine(fieldTargets);
    setUsedTargetsLine(line);
    try {
      await saveConstructorPlan({
        userId,
        courseId,
        days: [],
        targets: fieldTargets,
        plan_days_count: daysCount,
        plan_status: "draft",
        bmr: meta.bmr,
        tdee: meta.tdee,
        calorie_adjustment_pct: meta.adjustment_pct,
        targets_manual: true,
        meal_schedule_mode: scheduleMode,
        primary_meal_slot: primarySlot,
        review_reason: "Настройки сохранены перед генерацией",
      });
      const result = await generateAndValidateConstructorPlan({
        profile: { ...profile, profile_complete: true },
        days_count: daysCount,
        excluded_product_ids: [...forbiddenIds],
        meal_schedule_mode: scheduleMode,
        primary_meal_slot: primarySlot,
        targets_override: fieldTargets,
      });
      if (seq !== genToken.current) return;
      setMeta({
        bmr: result.bmr.toNumber(),
        tdee: result.tdee.toNumber(),
        adjustment_pct: result.adjustment_pct,
      });
      setUsedTargetsLine(result.used_targets_line ?? line);
      if (result.days.length === 0 || !planStructureValid(result.days, scheduleMode)) {
        const message =
          result.message ??
          "Не удалось собрать рацион в выбранном режиме. Старое меню не показано.";
        setGenerationError(message);
        toast.error(message);
        return;
      }
      setPreviewMode(scheduleMode);
      applyDays(result.days);
      setReviewReason(result.review_reason);
      const status = evaluatePlanKbjuStatus({
        days: result.days,
        targetMacro: result.targets,
        scheduleMode,
        comparison: result.comparison,
      });
      setPlanStatus(status.generationOk ? "validated" : "draft");
      toast.success(status.generationOk ? "Рацион собран и прошёл проверку" : "Рацион собран — требуется доработка");
    } catch (e) {
      if (seq !== genToken.current) return;
      const message = (e as Error).message;
      setGenerationError(message);
      toast.error(message);
    } finally {
      if (seq === genToken.current) setLoading(false);
    }
  };

  const handleSave = async (assign: boolean) => {
    if (visibleDays.length === 0) return;
    const status = applyDays(visibleDays);
    if (assign && !status.acceptable && !forcePublish) {
      toast.error("Нельзя назначить: KBJU вне допуска режима. Нужно подтверждение тренера.");
      return;
    }
    setSaving(true);
    try {
      if (assign) {
        const result = await publishConstructorNutrition({
          userId,
          courseId,
          days: visibleDays,
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
        await persistDraft(visibleDays, status.generationOk ? "validated" : "draft");
        toast.success("Черновик сохранён. Клиент по-прежнему видит опубликованную версию.");
      }
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCloneDraft = async () => {
    setCloning(true);
    try {
      const cloned = await clonePublishedNutritionToDraft({ userId, courseId });
      setDays(cloned.days);
      setPreviewMode(cloned.snapshot.meal_schedule_mode as MealScheduleMode);
      setScheduleMode(cloned.snapshot.meal_schedule_mode as MealScheduleMode);
      setPrimarySlot(cloned.snapshot.primary_meal_slot as PrimaryMealSlot);
      setTargets(cloned.snapshot.targets);
      setUsedTargetsLine(formatUsedTargetsLine(cloned.snapshot.targets));
      toast.success("Создан корректирующий черновик. Клиент видит прежнюю опубликованную версию.");
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCloning(false);
    }
  };

  const handleGramsChange = async (
    dayIndex: number,
    slot: PlanSlot,
    productId: string,
    grams: number,
  ) => {
    try {
      const current = visibleDays.find((day) => day.day_index === dayIndex);
      if (!current) return;
      const nextDay = setIngredientGrams({
        day: current,
        slot,
        productId,
        grams,
        products: catalog.products,
      });
      applyDays(replaceDaysDay(visibleDays, nextDay, catalog.products));
      toast.message("Граммовка изменена, день пересчитан");
    } catch (e) {
      toast.error((e as Error).message || ZERO_GRAMS_FORBIDDEN_MESSAGE);
    }
  };

  const handleEditorSubmit = (value: MealEditorSubmit) => {
    if (!editorDay) return;
    try {
      let nextDay = editorDay;
      if (value.kind === "suggest") {
        nextDay = value.proposal.nextDay;
      } else {
        const slot = planSlotForTrainerChoice({
          clock: value.clock,
          mealKind: value.mealKind,
          mode: scheduleMode,
          primarySlot,
        });
        const item =
          value.kind === "recipe"
            ? mealItemFromRecipe({
                ctx: catalog,
                recipe: value.recipe,
                slot,
                forbiddenIds,
                mealKind: value.mealKind,
              })
            : mealItemFromProducts({
                slot,
                name: value.name,
                mealKind: value.mealKind,
                lines: value.lines,
                forbiddenIds,
              });
        nextDay =
          editor.mode === "replace"
            ? replaceMealInDay({ day: editorDay, item, products: catalog.products })
            : addMealToDay({ day: editorDay, item, products: catalog.products });
      }
      applyDays(replaceDaysDay(visibleDays, nextDay, catalog.products));
      setEditor((cur) => ({ ...cur, open: false }));
      toast.success("День пересчитан");
    } catch (e) {
      toast.error(e instanceof ManualMealEditError ? e.message : (e as Error).message);
    }
  };

  const checks = structureChecks(visibleDays[0], scheduleMode);
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
          Точный расчёт KBJU · только проверенные продукты · ручное редактирование черновика
        </p>
        {publishedVersion != null && (
          <p className="mt-2 rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-xs text-warm-gray">
            Клиент видит опубликованную версию v{publishedVersion}. Черновик и пересборка не меняют
            её, пока не нажмёте «Опубликовать новую версию».
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-gold/15 bg-surface/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">Целевые KBJU</p>
          <p className="text-xs text-warm-gray">
            Автосчёт по анкете: <b className="text-ivory">{autoCalc.kcal}</b> ккал · Б{" "}
            {autoCalc.protein_g} · Ж {autoCalc.fat_g} · У {autoCalc.carbs_g}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(["kcal", "protein_g", "fat_g", "carbs_g"] as const).map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
                {key === "kcal" ? "Ккал" : key === "protein_g" ? "Белки" : key === "fat_g" ? "Жиры" : "Углеводы"}
              </span>
              <input
                type="number"
                value={targets[key]}
                readOnly={key === "kcal"}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setTargets((prev) => {
                    const next = { ...prev, [key]: v };
                    if (key !== "kcal") next.kcal = syncedKcal(next.protein_g, next.fat_g, next.carbs_g);
                    return next;
                  });
                }}
                className="w-full rounded-lg border border-gold/20 bg-background/40 px-3 py-2 text-sm text-ivory disabled:opacity-60"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-warm-gray">
          Генератор использует значения из этих полей. Ккал считаются из БЖУ (4·Б + 9·Ж + 4·У).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-warm-gray">
            Структура рациона
          </span>
          <select
            value={scheduleMode}
            onChange={(e) => {
              const next = e.target.value as MealScheduleMode;
              setScheduleMode(next);
              clearPreview("Режим изменён. Сгенерируйте новый рацион — предыдущее меню скрыто.");
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
          один полноценный приём в выбранное время и три перекуса без готовки, включая слот snack3.
        </p>
      )}

      {usedTargetsLine && (
        <p className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory">
          {usedTargetsLine}
        </p>
      )}

      {generationError && (
        <p className="rounded-xl border border-coral/20 bg-coral/5 px-4 py-3 text-sm text-warm-gray">
          {generationError}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {publishedVersion != null && (
          <button
            type="button"
            disabled={cloning}
            onClick={() => void handleCloneDraft()}
            className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            {cloning ? "Копируем…" : "Создать корректирующий черновик"}
          </button>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleGenerate()}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-coral to-gold px-5 py-2.5 text-xs uppercase tracking-widest text-background disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {loading ? "Сборка…" : "Сгенерировать рацион"}
        </button>
        {visibleDays.length > 0 && (
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
              disabled={saving || (!kbjuStatus.acceptable && !forcePublish)}
              onClick={() => void handleSave(true)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory disabled:opacity-40"
            >
              {publishedVersion != null ? "Опубликовать новую версию" : "Назначить клиенту"}
            </button>
          </>
        )}
      </div>

      {visibleDays.length > 0 && !kbjuStatus.acceptable && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-warm-gray">
          <input
            type="checkbox"
            checked={forcePublish}
            onChange={(e) => setForcePublish(e.target.checked)}
            className="accent-gold"
          />
          Опубликовать с текущими отклонениями (тренер подтверждает допуск)
        </label>
      )}

      {visibleDays.length > 0 && (
        <div className="grid gap-2 rounded-2xl border border-gold/15 bg-surface/20 p-4 text-sm sm:grid-cols-2">
          <CheckRow label="Основных приёмов" actual={checks.mains.actual} expected={checks.mains.expected} />
          <CheckRow label="Перекусов" actual={checks.snacks.actual} expected={checks.snacks.expected} />
          <CheckRow
            label="Перекусов без приготовления"
            actual={checks.noCookSnacks.actual}
            expected={checks.noCookSnacks.expected}
          />
          {scheduleMode === "one_main_three_snacks" && (
            <CheckRow
              label="Слот snack3"
              actual={visibleDays[0]?.items.some((i) => i.slot === "snack3") ? 1 : 0}
              expected={1}
            />
          )}
          <p className="sm:col-span-2 text-xs text-warm-gray">
            Статус:{" "}
            <span className={kbjuStatus.acceptable ? "text-gold" : "text-coral"}>
              {kbjuStatusLabel(kbjuStatus)}
            </span>
            {!structureOk &&
              ` · структура: ${checks.mains.actual}/${expectedMainCount(scheduleMode)} основных, ${checks.snacks.actual}/${expectedSnackCount(scheduleMode)} перекусов`}
            {kbjuStatus.invalidDayCount > 0 ? (
              <span className="mt-1 block text-coral">
                {kbjuStatus.invalidDayCount} из {visibleDays.length} дней вне допуска — каждый день
                проверяется отдельно, без усреднения за период.
              </span>
            ) : null}
            {!kbjuStatus.generationOk && deviationSummary ? (
              <span className="mt-1 block text-coral">Отклонение выбранного дня: {deviationSummary}</span>
            ) : null}
          </p>
        </div>
      )}

      {reviewReason && (
        <p className="rounded-xl border border-coral/20 bg-coral/5 px-4 py-3 text-sm text-warm-gray">
          {reviewReason}
        </p>
      )}

      {visibleDays.length > 0 && shoppingList.length > 0 && (
        <div className="rounded-2xl border border-gold/15 p-4 text-sm">
          <p className="text-[11px] uppercase tracking-widest text-warm-gray">Список покупок</p>
          <ul className="mt-2 columns-1 gap-2 sm:columns-2">
            {shoppingList.map((entry) => (
              <li key={entry.product_id} className="text-warm-gray">
                {entry.product_name}: {Math.round(entry.grams)} г
              </li>
            ))}
          </ul>
        </div>
      )}

      {visibleDays.length > 0 && (
        <ConstructorNutritionView
          days={visibleDays}
          comparison={dayComparison}
          targets={targets}
          planStatus={planStatus}
          kbjuAcceptable={kbjuStatus.acceptable}
          precisionHint={kbjuStatus.precisionHint}
          mealScheduleMode={scheduleMode}
          primaryMealSlot={primarySlot}
          editable
          onIngredientGramsChange={handleGramsChange}
          onAddMeal={(dayIndex) => setEditor({ open: true, mode: "add", dayIndex })}
          onReplaceMeal={(dayIndex, slot) => setEditor({ open: true, mode: "replace", dayIndex, slot })}
          onDeleteMeal={(dayIndex, slot) => {
            const current = visibleDays.find((day) => day.day_index === dayIndex);
            if (!current) return;
            applyDays(
              replaceDaysDay(
                visibleDays,
                deleteMealFromDay({ day: current, slot, products: catalog.products }),
                catalog.products,
              ),
            );
          }}
          onSuggestVariants={(dayIndex) => setEditor({ open: true, mode: "suggest", dayIndex })}
        />
      )}

      <TrainerMealEditor
        open={editor.open}
        mode={editor.mode}
        day={editorDay}
        ctx={catalog}
        forbiddenIds={forbiddenIds}
        proposals={proposals}
        targetMacro={targets}
        onClose={() => setEditor((cur) => ({ ...cur, open: false }))}
        onSubmit={handleEditorSubmit}
      />
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
