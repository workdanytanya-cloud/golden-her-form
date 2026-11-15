import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConstructorNutritionView } from "@/components/panel/ConstructorNutritionView";
import { MealDraftEditor } from "@/components/panel/MealDraftEditor";
import { SnapshotPdfButton } from "@/components/panel/SnapshotPdfButton";
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
  slotLabel,
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
  inferMealScheduleModeFromDays,
  kbjuStatusLabel,
  planStructureValid,
} from "@/lib/nutrition-constructor/plan-kbju-status";
import { formatMacroDeviationSummary } from "@/lib/nutrition-constructor/validation-messages";
import { calcMacroTargets, type TargetProfileInput } from "@/lib/nutrition-constructor/targets";
import { formatUsedTargetsLine } from "@/lib/nutrition-constructor/calculator";
import { formatTrainerVarietyLine } from "@/lib/nutrition-constructor/catalog-policy";
import {
  freshRebuildSeed,
  type MealReplacePreview,
} from "@/lib/nutrition-constructor/meal-replace";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import { shoppingListFromDays } from "@/lib/nutrition-constructor/ingredient-normalize";
import { proposeDayCorrections } from "@/lib/nutrition-constructor/deviation-suggestions";
import {
  addMealToDay,
  mealItemFromProducts,
  mealItemFromRecipe,
  ManualMealEditError,
  replaceDaysDay,
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
  clientName?: string;
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
  clientName,
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
  const [varietyLine, setVarietyLine] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<"draft" | "validated" | "assigned">("draft");
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ bmr?: number; tdee?: number; adjustment_pct?: number }>({});
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [editor, setEditor] = useState<{
    open: boolean;
    mode: MealEditorMode;
    dayIndex: number;
    slot?: PlanSlot;
    itemId?: string;
    recipeId?: string;
    recipeName?: string;
  }>({ open: false, mode: "add", dayIndex: 0 });
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replacePreview, setReplacePreview] = useState<MealReplacePreview | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceSuggestions, setReplaceSuggestions] = useState<MealReplacePreview[]>([]);
  const [unpublishedChanges, setUnpublishedChanges] = useState(false);
  const [editTarget, setEditTarget] = useState<{ dayIndex: number; slot: PlanSlot } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [checkIssues, setCheckIssues] = useState<
    Array<{ dayIndex: number; slot: string | null; message: string }>
  >([]);
  const catalog = useMemo(() => buildInMemoryCatalog(), []);
  const genToken = useRef(0);
  const replaceSeq = useRef(0);

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
      const storedMode = plan.meal_schedule_mode ?? "two_main_two_snacks";
      setTargets({
        kcal: plan.target_kcal,
        protein_g: plan.target_protein_g,
        fat_g: plan.target_fat_g,
        carbs_g: plan.target_carbs_g,
      });
      setPlanStatus(plan.plan_status);
      setDraftUpdatedAt(plan.updated_at ?? null);
      setDaysCount((plan.plan_days_count as PlanDaysCount) || 7);
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
      // Импорт/legacy иногда пишут one_main_three_snacks при фактических слотах 2+2 —
      // не прячем меню, а подстраиваем режим под слоты.
      const inferred = inferMealScheduleModeFromDays(mapped);
      const mode =
        mapped.length > 0 && planStructureValid(mapped, storedMode)
          ? storedMode
          : (inferred ?? storedMode);
      setScheduleMode(mode);
      if (mapped.length > 0 && planStructureValid(mapped, mode)) {
        setDays(mapped);
        setPreviewMode(mode);
        setGenerationError(
          inferred && inferred !== storedMode
            ? `Режим в черновике был «${storedMode}», по слотам показан как «${inferred}».`
            : null,
        );
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
    () =>
      dayComparison.length > 0 ? formatMacroDeviationSummary(dayComparison, kbjuTolerance) : "",
    [dayComparison, kbjuTolerance],
  );

  const shoppingList = useMemo(() => shoppingListFromDays(visibleDays), [visibleDays]);

  const editorDay =
    visibleDays.find((day) => day.day_index === editor.dayIndex) ?? visibleDays[0] ?? null;
  const proposals = useMemo(() => {
    if (!editor.open || (editor.mode !== "suggest" && editor.mode !== "add") || !editorDay)
      return [];
    return proposeDayCorrections({
      day: editorDay,
      targets: targetMacro,
      products: catalog.products,
    });
  }, [editor, editorDay, targetMacro, catalog.products]);

  const applyDays = (nextDays: ConstructorDay[]) => {
    const nextComparison = nextDays[0]
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

  const applyServerDays = (result: { days?: ConstructorDay[]; updatedAt?: string | null }) => {
    if (result.days) applyDays(result.days);
    if (result.updatedAt) setDraftUpdatedAt(result.updatedAt);
    setUnpublishedChanges(true);
    setPlanStatus("draft");
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
    setVarietyLine(null);
  };

  const handleGenerate = async () => {
    if (loading) return;
    const seq = ++genToken.current;
    const fieldTargets = {
      kcal: syncedKcal(targets.protein_g, targets.fat_g, targets.carbs_g),
      protein_g: targets.protein_g,
      fat_g: targets.fat_g,
      carbs_g: targets.carbs_g,
    };
    setTargets(fieldTargets);
    const rebuilding = visibleDays.length > 0;
    const beforeMeals = visibleDays;
    setLoading(true);
    setGenerationError(null);
    const line = formatUsedTargetsLine(fieldTargets);
    setUsedTargetsLine(line);
    try {
      const result = await generateAndValidateConstructorPlan({
        clientId: userId,
        courseId,
        seed: rebuilding ? freshRebuildSeed() : undefined,
        rebuild: rebuilding,
        profile: { ...profile, profile_complete: true },
        days_count: daysCount,
        excluded_product_ids: [...forbiddenIds],
        meal_schedule_mode: scheduleMode,
        primary_meal_slot: primarySlot,
        targets_override: fieldTargets,
      });
      if (seq !== genToken.current) return;
      const savedFlag = (result as { saved?: boolean }).saved;
      const toNum = (value: unknown): number => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (value && typeof value === "object" && "toNumber" in value) {
          const fn = (value as { toNumber?: () => number }).toNumber;
          if (typeof fn === "function") return fn.call(value);
        }
        return Number(value);
      };
      setMeta({
        bmr: toNum(result.bmr),
        tdee: toNum(result.tdee),
        adjustment_pct: result.adjustment_pct,
      });
      setUsedTargetsLine(result.used_targets_line ?? line);
      if (savedFlag === false) {
        const message =
          result.message ??
          "Новый отличающийся вариант найти не удалось. Текущий рацион сохранён без изменений.";
        setGenerationError(message);
        toast.message(message);
        return;
      }
      if (result.days.length === 0 || !planStructureValid(result.days, scheduleMode)) {
        const message = result.message ?? "Не удалось собрать рацион. Черновик не изменён.";
        const exclusionNote =
          forbiddenIds.size > 0
            ? `\nИсключения применены: ${forbiddenIds.size}.`
            : "\nИсключений нет.";
        setGenerationError(
          `${message}${exclusionNote}\nЗамены не применялись. Черновик не изменён.`,
        );
        toast.error(message);
        return;
      }
      const targetsRaw = (result.targets ?? {}) as Record<string, unknown>;
      const targetMacro = {
        kcal: d(toNum(targetsRaw.kcal)),
        protein_g: d(toNum(targetsRaw.protein_g)),
        fat_g: d(toNum(targetsRaw.fat_g)),
        carbs_g: d(toNum(targetsRaw.carbs_g)),
        fiber_g: d(toNum(targetsRaw.fiber_g ?? 0)),
      };
      const status = evaluatePlanKbjuStatus({
        days: result.days,
        targetMacro,
        scheduleMode,
        comparison: result.comparison,
      });
      if (!status.generationOk || !result.is_valid) {
        setGenerationError(
          (result.message ??
            "Рацион не прошёл допуск KBJU — near-miss не применяется к черновику.") +
            (status.precisionHint ? `\n${status.precisionHint}` : ""),
        );
        toast.error("KBJU вне допуска — черновик не изменён");
        return;
      }
      setPreviewMode(scheduleMode);
      applyDays(result.days);
      setReviewReason(result.review_reason);
      setGenerationError(null);
      const summary = formatTrainerVarietyLine(result.days);
      const exclusionNote =
        forbiddenIds.size > 0 ? `Исключено продуктов: ${forbiddenIds.size}.` : "Исключений нет.";
      setVarietyLine(`${summary}. ${exclusionNote} Замены не применялись.`);
      setPlanStatus("validated");
      const reloaded = await loadConstructorPlanFor(userId, courseId);
      if (!reloaded.plan || reloaded.days.length !== result.days.length) {
        throw new Error("Черновик сохранён, но контрольное перечитывание не прошло");
      }
      const changedMeals = reloaded.days.reduce((count, day) => {
        const previous = beforeMeals.find((item) => item.day_index === day.day_index);
        return (
          count +
          day.items.filter((item) => {
            const prev = previous?.items.find((meal) => meal.slot === item.slot);
            return !prev || prev.recipe_id !== item.recipe_id;
          }).length
        );
      }, 0);
      const totalMeals = reloaded.days.reduce((count, day) => count + day.items.length, 0);
      if (rebuilding && changedMeals === 0) {
        toast.message(
          "Новый отличающийся вариант найти не удалось. Текущий рацион сохранён без изменений.",
        );
        return;
      }
      applyDays(reloaded.days);
      setDraftUpdatedAt(reloaded.plan.updated_at ?? null);
      setUnpublishedChanges(true);
      onSaved?.();
      toast.success(
        rebuilding
          ? `Рацион пересобран: изменено ${changedMeals} из ${totalMeals} приёмов`
          : formatTrainerVarietyLine(reloaded.days),
      );
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
    if (assign && !status.acceptable) {
      toast.error("Нельзя опубликовать: день выходит за разрешённые КБЖУ");
      return;
    }
    setSaving(true);
    try {
      if (assign) {
        if (!planStructureValid(visibleDays, scheduleMode)) {
          toast.error("Нельзя опубликовать: есть незаполненный обязательный приём");
          return;
        }
        const { requireSelfhostAdminSession, selfhostPublishAndOpen, usesLocalPostgresCircuit } =
          await import("@/lib/selfhost/client-api");
        if (await usesLocalPostgresCircuit()) await requireSelfhostAdminSession();
        const result = (await selfhostPublishAndOpen({ clientId: userId, courseId })) as {
          message?: string;
          issues?: Array<{ dayIndex: number; slot: string | null; message: string }>;
        };
        if (result.issues && result.issues.length > 0) {
          setCheckIssues(result.issues);
          toast.error(result.message ?? "Рацион нельзя опубликовать, пока в проверке есть ошибки");
          return;
        }
        setPlanStatus("assigned");
        setUnpublishedChanges(false);
        toast.success(result.message ?? "Программа опубликована. Доступ клиента открыт");
        const pub = await loadPublishedNutritionFor(userId, courseId);
        setPublishedVersion(pub?.version?.version ?? publishedVersion);
      } else {
        await persistDraft(visibleDays, status.generationOk ? "validated" : "draft");
        toast.success("Черновик сохранён. Клиент по-прежнему видит опубликованную версию.");
      }
      onSaved?.();
    } catch (e) {
      const issues = (
        e as { issues?: Array<{ dayIndex: number; slot: string | null; message: string }> }
      ).issues;
      if (issues && issues.length > 0) setCheckIssues(issues);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async () => {
    setSaving(true);
    try {
      const { selfhostValidateDraft } = await import("@/lib/selfhost/client-api");
      const result = (await selfhostValidateDraft({ clientId: userId, courseId })) as {
        ok?: boolean;
        message?: string;
        issues?: Array<{ dayIndex: number; slot: string | null; message: string }>;
      };
      setCheckIssues(result.issues ?? []);
      if (result.ok) toast.success(result.message ?? "Рацион можно публиковать");
      else toast.error(result.message ?? "В рационе есть ошибки");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshText = async () => {
    setSaving(true);
    try {
      const { selfhostDraftText } = await import("@/lib/selfhost/client-api");
      const preview = (await selfhostDraftText({
        clientId: userId,
        courseId,
        expectedUpdatedAt: draftUpdatedAt,
        apply: false,
      })) as {
        names?: number;
        instructions?: number;
        changes?: Array<{ dayIndex: number; from: string; to: string; manual?: boolean }>;
      };
      const manualCount = (preview.changes ?? []).filter((row) => row.manual).length;
      const sample = (preview.changes ?? [])
        .slice(0, 8)
        .map((row) => `день ${row.dayIndex + 1}: ${row.from} → ${row.to}`)
        .join("\n");
      const overwrite =
        manualCount > 0 &&
        window.confirm(
          `Названий: ${preview.names ?? 0}. Инструкций: ${preview.instructions ?? 0}.\n${sample}\n\nЕсть ручные инструкции: ${manualCount}. Заменить и их?`,
        );
      const confirmed = window.confirm(
        `Исправить названия и инструкции?\nНазваний: ${preview.names ?? 0}\nИнструкций: ${preview.instructions ?? 0}\n${sample}`,
      );
      if (!confirmed) return;
      const applied = (await selfhostDraftText({
        clientId: userId,
        courseId,
        expectedUpdatedAt: draftUpdatedAt,
        apply: true,
        overwriteManual: overwrite,
      })) as { days?: ConstructorDay[]; updatedAt?: string | null; message?: string };
      applyServerDays(applied);
      toast.success(applied.message ?? "Названия и инструкции обновлены");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDraft = async () => {
    const confirmed = window.confirm(
      `Удалить черновик рациона?\nКлиент: ${clientName || "текущий"}\nКурс: текущий\nДней: ${visibleDays.length}\n\nОпубликованная программа не изменится.`,
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const { selfhostDeleteDraft } = await import("@/lib/selfhost/client-api");
      const result = (await selfhostDeleteDraft({ clientId: userId, courseId })) as {
        message?: string;
      };
      setDays([]);
      setDraftUpdatedAt(null);
      setUnpublishedChanges(false);
      toast.success(result.message ?? "Черновик удалён. Опубликованная программа не изменилась.");
    } catch (error) {
      toast.error((error as Error).message);
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
    const current = visibleDays.find((day) => day.day_index === dayIndex);
    const item = current?.items.find((meal) => meal.slot === slot);
    if (!current || !item?.id) return;
    if (!Number.isFinite(grams) || grams <= 0) {
      toast.error(ZERO_GRAMS_FORBIDDEN_MESSAGE);
      return;
    }
    try {
      const { selfhostDraftMeal } = await import("@/lib/selfhost/client-api");
      const result = (await selfhostDraftMeal({
        action: "update",
        clientId: userId,
        courseId,
        dayIndex,
        slot,
        mealItemId: item.id,
        expectedUpdatedAt: draftUpdatedAt,
        name: item.recipe_name,
        steps: item.steps ?? [],
        prepTimeMin: item.prep_time_min,
        note: item.weighing_note,
        lines: item.ingredients.map((line) => ({
          productId: line.product_id,
          grams: line.product_id === productId ? grams : Number(line.grams),
        })),
      })) as { days?: ConstructorDay[]; updatedAt?: string | null; message?: string };
      applyServerDays(result);
      toast.success(result.message ?? "Изменения сохранены. Есть неопубликованные изменения.");
    } catch (e) {
      toast.error((e as Error).message || ZERO_GRAMS_FORBIDDEN_MESSAGE);
    }
  };

  const replaceCurrentMeal = async (value: MealEditorSubmit) => {
    if (!editor.slot || editor.mode !== "replace") return;
    if (value.kind === "suggest") return;
    if (value.kind === "recipe" && value.recipe.name === editor.recipeName) {
      setReplaceError("Это уже текущий рецепт этого приёма.");
      return;
    }
    const seq = ++replaceSeq.current;
    setReplaceBusy(true);
    setReplaceError(null);
    try {
      const { selfhostReplaceMeal } = await import("@/lib/selfhost/client-api");
      const result = (await selfhostReplaceMeal({
        clientId: userId,
        courseId,
        dayIndex: editor.dayIndex,
        slot: editor.slot,
        mealItemId: editor.itemId,
        expectedUpdatedAt: draftUpdatedAt,
        action: "apply",
        recipeId: value.kind === "recipe" ? value.recipe.id : null,
        manual:
          value.kind === "manual"
            ? {
                name: value.name,
                lines: value.lines.map((line) => ({
                  productId: line.product.id,
                  grams: line.grams,
                })),
              }
            : null,
      })) as {
        replaced?: boolean;
        createdDraft?: boolean;
        message?: string;
        updatedAt?: string | null;
        days?: ConstructorDay[];
      };
      if (seq !== replaceSeq.current) return;
      const reloaded = await loadConstructorPlanFor(userId, courseId);
      if (seq !== replaceSeq.current) return;
      const days = reloaded.days.length > 0 ? reloaded.days : (result.days ?? []);
      const savedMeal = days
        .find((day) => day.day_index === editor.dayIndex)
        ?.items.find((item) => item.slot === editor.slot);
      const changed =
        value.kind === "manual"
          ? savedMeal?.recipe_name === value.name
          : Boolean(savedMeal && savedMeal.recipe_id !== editor.recipeId);
      if (!result.replaced || !savedMeal || !changed) {
        toast.error("Повторное чтение не подтвердило замену");
        return;
      }
      applyDays(days);
      setDraftUpdatedAt(reloaded.plan?.updated_at ?? result.updatedAt ?? null);
      setPlanStatus("draft");
      setUnpublishedChanges(true);
      setEditor((cur) => ({ ...cur, open: false }));
      setReplacePreview(null);
      toast.success(
        result.createdDraft
          ? "Создан новый черновик. Клиент продолжает видеть опубликованную версию."
          : "Приём заменён. Есть неопубликованные изменения.",
      );
      onSaved?.();
    } catch (error) {
      if (seq !== replaceSeq.current) return;
      const message = (error as Error).message;
      setReplaceError(message);
      toast.error(message);
    } finally {
      if (seq === replaceSeq.current) setReplaceBusy(false);
    }
  };

  const requestReplacePreview = async (recipe: { id: string; name: string }) => {
    if (!editor.slot) return;
    if (recipe.name === editor.recipeName) {
      setReplacePreview(null);
      setReplaceError("Это уже текущий рецепт этого приёма.");
      return;
    }
    const seq = ++replaceSeq.current;
    setReplaceError(null);
    setReplacePreview(null);
    try {
      const { selfhostReplaceMeal } = await import("@/lib/selfhost/client-api");
      const result = (await selfhostReplaceMeal({
        clientId: userId,
        courseId,
        dayIndex: editor.dayIndex,
        slot: editor.slot,
        mealItemId: editor.itemId,
        expectedUpdatedAt: draftUpdatedAt,
        action: "preview",
        recipeId: recipe.id,
      })) as { preview?: MealReplacePreview };
      if (seq !== replaceSeq.current) return;
      setReplacePreview(result.preview ?? null);
    } catch (error) {
      if (seq !== replaceSeq.current) return;
      setReplacePreview(null);
      setReplaceError((error as Error).message);
    }
  };

  useEffect(() => {
    if (!editor.open || editor.mode !== "replace" || !editor.slot) return;
    const seq = ++replaceSeq.current;
    setReplacePreview(null);
    setReplaceError(null);
    void (async () => {
      try {
        const { selfhostReplaceMeal } = await import("@/lib/selfhost/client-api");
        const result = (await selfhostReplaceMeal({
          clientId: userId,
          courseId,
          dayIndex: editor.dayIndex,
          slot: editor.slot!,
          mealItemId: editor.itemId,
          expectedUpdatedAt: draftUpdatedAt,
          action: "suggest",
        })) as { options?: MealReplacePreview[] };
        if (seq !== replaceSeq.current) return;
        setReplaceSuggestions(result.options ?? []);
      } catch {
        if (seq !== replaceSeq.current) return;
        setReplaceSuggestions([]);
      }
    })();
  }, [
    editor.open,
    editor.mode,
    editor.dayIndex,
    editor.slot,
    editor.itemId,
    courseId,
    userId,
    draftUpdatedAt,
  ]);

  const handleEditorSubmit = async (value: MealEditorSubmit) => {
    if (!editorDay) return;
    if (editor.mode === "replace") {
      if (!editor.slot || replaceBusy) return;
      void replaceCurrentMeal(value);
      return;
    }
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
        nextDay = addMealToDay({ day: editorDay, item, products: catalog.products });
      }
      if (editor.slot && value.kind !== "suggest") {
        const added = nextDay.items.find((meal) => meal.slot === editor.slot);
        if (!added) return;
        const { selfhostDraftMeal } = await import("@/lib/selfhost/client-api");
        const result = (await selfhostDraftMeal({
          action: "add",
          clientId: userId,
          courseId,
          dayIndex: editor.dayIndex,
          slot: editor.slot,
          expectedUpdatedAt: draftUpdatedAt,
          name: added.recipe_name,
          steps: added.steps ?? [],
          prepTimeMin: added.prep_time_min,
          note: added.weighing_note,
          recipeId: added.recipe_id,
          lines: added.ingredients.map((line) => ({
            productId: line.product_id,
            grams: Number(line.grams),
          })),
        })) as { days?: ConstructorDay[]; updatedAt?: string | null; message?: string };
        applyServerDays(result);
        setEditor((cur) => ({ ...cur, open: false }));
        toast.success(result.message ?? "Приём добавлен");
        return;
      }
      const nextDays = replaceDaysDay(visibleDays, nextDay, catalog.products);
      await persistDraft(nextDays, "draft");
      const reloaded = await loadConstructorPlanFor(userId, courseId);
      if (!reloaded.plan) throw new Error("Черновик не подтверждён повторным чтением");
      applyDays(reloaded.days);
      setDraftUpdatedAt(reloaded.plan.updated_at ?? null);
      setUnpublishedChanges(true);
      setPlanStatus("draft");
      setEditor((cur) => ({ ...cur, open: false }));
      toast.success("Приём добавлен");
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
            {unpublishedChanges ? " Есть неопубликованные изменения." : ""}
          </p>
        )}
        {publishedVersion == null && unpublishedChanges && (
          <p className="mt-2 rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-xs text-warm-gray">
            Есть неопубликованные изменения.
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
                {key === "kcal"
                  ? "Ккал"
                  : key === "protein_g"
                    ? "Белки"
                    : key === "fat_g"
                      ? "Жиры"
                      : "Углеводы"}
              </span>
              <input
                type="number"
                value={targets[key]}
                readOnly={key === "kcal"}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setTargets((prev) => {
                    const next = { ...prev, [key]: v };
                    if (key !== "kcal")
                      next.kcal = syncedKcal(next.protein_g, next.fat_g, next.carbs_g);
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

      {varietyLine && (
        <p className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory">
          {varietyLine}
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
          {loading
            ? "Пересобираем…"
            : visibleDays.length > 0
              ? "Пересобрать рацион"
              : "Сгенерировать рацион"}
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
              disabled={saving || !planStructureValid(visibleDays, scheduleMode)}
              onClick={() => void handleCheck()}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
            >
              Проверить рацион
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleRefreshText()}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory hover:bg-gold/10 disabled:opacity-50"
            >
              Исправить названия и инструкции
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleDeleteDraft()}
              className="inline-flex items-center gap-2 rounded-full border border-coral/40 px-5 py-2.5 text-xs uppercase tracking-widest text-coral hover:bg-coral/10 disabled:opacity-50"
            >
              Удалить черновик рациона
            </button>
            <button
              type="button"
              disabled={saving || !planStructureValid(visibleDays, scheduleMode)}
              onClick={() => void handleSave(true)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-5 py-2.5 text-xs uppercase tracking-widest text-ivory disabled:opacity-40"
            >
              Опубликовать и открыть доступ
            </button>
            <SnapshotPdfButton
              kind="nutrition"
              courseId={courseId}
              clientId={userId}
              disabled={publishedVersion == null}
            />
          </>
        )}
      </div>

      {checkIssues.length > 0 && (
        <ul className="space-y-1 rounded-2xl border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          {checkIssues.map((issue, index) => (
            <li key={`${issue.dayIndex}-${issue.slot}-${index}`}>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => {
                  const view = document.querySelector("[data-constructor-day]");
                  view?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                День {issue.dayIndex + 1}
                {issue.slot ? ` · ${issue.slot}` : ""}: {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}

      {visibleDays.length > 0 && (
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
              label="Слот snack3"
              actual={visibleDays[0]?.items.some((i) => i.slot === "snack3") ? 1 : 0}
              expected={1}
            />
          )}
          <p className="sm:col-span-2 text-xs text-warm-gray">
            Статус:{" "}
            <span className={kbjuStatus.acceptable ? "text-gold" : "text-coral"}>
              {!planStructureValid(visibleDays, scheduleMode)
                ? "Не завершён"
                : kbjuStatusLabel(kbjuStatus)}
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
              <span className="mt-1 block text-coral">
                Отклонение выбранного дня: {deviationSummary}
              </span>
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
          onAddMeal={(dayIndex, slot) => setEditor({ open: true, mode: "add", dayIndex, slot })}
          onEditMeal={(dayIndex, slot) => setEditTarget({ dayIndex, slot })}
          onReplaceMeal={(dayIndex, slot) => {
            const current = visibleDays.find((day) => day.day_index === dayIndex);
            const item = current?.items.find((meal) => meal.slot === slot);
            setReplacePreview(null);
            setReplaceError(null);
            setEditor({
              open: true,
              mode: "replace",
              dayIndex,
              slot,
              itemId: item?.id,
              recipeId: item?.recipe_id,
              recipeName: item?.recipe_name ?? "",
            });
          }}
          onDeleteMeal={(dayIndex, slot) => {
            const current = visibleDays.find((day) => day.day_index === dayIndex);
            const item = current?.items.find((meal) => meal.slot === slot);
            if (!item?.id) return;
            const label = slotLabel(slot, scheduleMode, primarySlot);
            const confirmed = window.confirm(
              `Удалить «${item.recipe_name}»?\nДень ${dayIndex + 1} · ${label}`,
            );
            if (!confirmed) return;
            void (async () => {
              try {
                const { selfhostDraftMeal } = await import("@/lib/selfhost/client-api");
                const result = (await selfhostDraftMeal({
                  action: "delete",
                  clientId: userId,
                  courseId,
                  dayIndex,
                  slot,
                  mealItemId: item.id,
                  expectedUpdatedAt: draftUpdatedAt,
                })) as { days?: ConstructorDay[]; updatedAt?: string | null; message?: string };
                applyServerDays(result);
                toast.success(result.message ?? "Приём удалён");
              } catch (error) {
                toast.error((error as Error).message);
              }
            })();
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
        replaceTarget={
          editor.mode === "replace" && editor.slot
            ? {
                dayIndex: editor.dayIndex,
                slot: editor.slot,
                label: slotLabel(editor.slot, scheduleMode, primarySlot),
                recipeName: editor.recipeName ?? "",
              }
            : null
        }
        suggestions={replaceSuggestions}
        preview={replacePreview}
        previewError={replaceError}
        busy={replaceBusy}
        usedRecipeNames={visibleDays.flatMap((day) =>
          day.items
            .filter((item) => !(day.day_index === editor.dayIndex && item.slot === editor.slot))
            .map((item) => item.recipe_name),
        )}
        onSelectRecipe={(recipe) => void requestReplacePreview(recipe)}
        proposals={proposals}
        targetMacro={targets}
        onClose={() => setEditor((cur) => ({ ...cur, open: false }))}
        onSubmit={handleEditorSubmit}
      />
      <MealDraftEditor
        open={editTarget != null}
        title={
          editTarget
            ? `День ${editTarget.dayIndex + 1} · ${slotLabel(editTarget.slot, scheduleMode, primarySlot)}`
            : ""
        }
        item={
          editTarget
            ? (visibleDays
                .find((day) => day.day_index === editTarget.dayIndex)
                ?.items.find((meal) => meal.slot === editTarget.slot) ?? null)
            : null
        }
        products={[...catalog.products.values()]}
        busy={editBusy}
        onClose={() => setEditTarget(null)}
        onSave={(value) => {
          if (!editTarget) return;
          const item = visibleDays
            .find((day) => day.day_index === editTarget.dayIndex)
            ?.items.find((meal) => meal.slot === editTarget.slot);
          if (!item?.id) return;
          setEditBusy(true);
          void (async () => {
            try {
              const { selfhostDraftMeal } = await import("@/lib/selfhost/client-api");
              const result = (await selfhostDraftMeal({
                action: "update",
                clientId: userId,
                courseId,
                dayIndex: editTarget.dayIndex,
                slot: editTarget.slot,
                mealItemId: item.id,
                expectedUpdatedAt: draftUpdatedAt,
                ...value,
              })) as { days?: ConstructorDay[]; updatedAt?: string | null; message?: string };
              applyServerDays(result);
              setEditTarget(null);
              toast.success(
                result.message ?? "Изменения сохранены. Есть неопубликованные изменения.",
              );
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setEditBusy(false);
            }
          })();
        }}
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
