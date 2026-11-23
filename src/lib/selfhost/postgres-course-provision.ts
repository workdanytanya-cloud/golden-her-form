import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  buildCourseTitleFromISO,
  courseEndDate,
  parseISODate,
  toISODate,
} from "@/lib/client-courses/format";
import type { ClientCourse } from "@/lib/client-courses/repo";
import {
  decideGenerationStage,
  trainingDraftNeedsRebuild,
  mapGender,
  mapMealSchedule,
  mapPrimarySlot,
  resolveProvisionMealSchedule,
  mapTrainingDays,
  mapTrainingLevel,
  missingProgramFields,
  missingProgramMessage,
  type ProgramGenerationStatus,
  type ProgramScope,
} from "@/lib/client-courses/program-readiness";
import { buildForbiddenProductIds } from "@/lib/nutrition-constructor/allergens";
import {
  calcMacroTargets,
  checkAutoGenerationSafety,
  isBlockingPregnancyStatus,
} from "@/lib/nutrition-constructor/targets";
import { generateAndValidateConstructorPlan } from "@/lib/nutrition-constructor/repo";
import {
  GOAL_FALLBACK_MESSAGE,
  resolveClientGoal,
  TRAINING_DIRECTION_LABELS,
  type TrainingDirection,
} from "@/lib/client-courses/goal-source";
import {
  assessTrainingVariety,
  INSUFFICIENT_EXERCISE_VARIETY,
  INSUFFICIENT_EXERCISE_VARIETY_MESSAGE,
} from "@/lib/course-continuation/training-variety";
import {
  defaultFaq,
  generateMultiWeekProgram,
  type ProgramGoal,
  type ProgramInput,
  type ProgramLevel,
} from "@/lib/training";
import { getPostgresPool } from "@/lib/selfhost/db";
import { mapCourse } from "@/lib/selfhost/postgres-courses";
import {
  cloneNutritionPlanPg,
  loadConstructorPlanPg,
  loadOptimizerContextPg,
  saveConstructorPlanPg,
} from "@/lib/selfhost/postgres-nutrition";
import {
  loadGeneratorPoolExercisesPg,
  loadPreviousTrainingContextPg,
  loadReadyBlocksPg,
  saveTrainingDraftPg,
} from "@/lib/selfhost/postgres-training";

export const GENERATION_TIMEOUT_MS = 90_000;

type StageName = "nutrition" | "training";

export type CourseProvisionResult = {
  course: ClientCourse;
  idempotent: boolean;
  stages: Record<StageName, { status: ProgramGenerationStatus | null; error: string | null }>;
  goalFallback: boolean;
};

type Facts = {
  goal: string | null;
  heightCm: number | null;
  weightKg: number | null;
  gender: "female" | "male" | null;
  birthDate: string | null;
  ageYears: number | null;
  activityLevel: string | null;
  trainingDays: number | null;
  allergies: string;
  dislikedFoods: string;
  pregnancyStatus: string | null;
  healthConditions: string | null;
  hasInjuries: boolean;
  injuriesDetails: string | null;
  equipment: string[];
  location: string | null;
  mealSchedule: ReturnType<typeof mapMealSchedule>;
  mealScheduleExplicit: boolean;
  primarySlot: ReturnType<typeof mapPrimarySlot>;
  goalText: string | null;
  goalFallback: boolean;
  direction: TrainingDirection;
  pregnancyLimitsLoad: boolean;
  chosenLevel?: ProgramLevel;
  chosenSessions?: 3 | 4;
  chosenDuration?: number | null;
  chosenLocation?: string | null;
  chosenEquipment?: string[];
};

export type TrainingProvisionChoices = {
  direction?: TrainingDirection;
  level?: ProgramLevel;
  sessionsPerWeek?: 3 | 4;
  durationMin?: number | null;
  location?: string | null;
  equipment?: string[];
};

export type CourseProvisionDeps = {
  generateNutrition: (clientId: string, courseId: string, facts: Facts) => Promise<void>;
  generateTraining: (
    clientId: string,
    courseId: string,
    facts: Facts,
    sourceCourseId: string | null,
  ) => Promise<void>;
};

const COURSE_RETURNING = `id, client_id, title, start_date::text, end_date::text, status, created_at, created_by, notes, program_scope, nutrition_generation_status, training_generation_status, nutrition_generation_error, training_generation_error`;

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    const fn = (value as { toNumber?: () => number }).toNumber;
    if (typeof fn === "function") return fn.call(value);
  }
  return Number(value);
}

function clipError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Не удалось создать черновик";
  return message.slice(0, 500);
}

async function loadFacts(db: Pool | PoolClient, clientId: string): Promise<Facts> {
  const { rows } = await db.query(
    `SELECT p.goal AS profile_goal, o.goal_primary, o.goal_details,
            p.height_cm, p.gender, p.birth_date::text AS birth_date, p.age_years, p.preferred_meal_schedule,
            o.activity_level, o.training_days_per_week, o.allergies, o.disliked_foods,
            o.pregnancy_status, o.health_conditions, o.has_injuries, o.injuries_details,
            o.equipment, o.training_location, o.extra
       FROM public.users u
       LEFT JOIN public.profiles p ON p.id = u.id
       LEFT JOIN public.onboarding_responses o ON o.user_id = u.id
      WHERE u.id = $1`,
    [clientId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error("Клиент не найден"), { statusCode: 404 });
  const weight = await db.query(
    `SELECT weight_kg FROM public.measurements
      WHERE user_id = $1 AND weight_kg IS NOT NULL
      ORDER BY measured_on DESC, created_at DESC LIMIT 1`,
    [clientId],
  );
  const extra = (row.extra as Record<string, unknown> | null) ?? {};
  const extraGoal = [extra.goal, extra.goal_text, extra.desired_result].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const resolved = resolveClientGoal({
    profileGoal: (row.profile_goal as string | null) ?? null,
    goalPrimary: (row.goal_primary as string | null) ?? null,
    goalDetails: (row.goal_details as string | null) ?? null,
    extraGoal: typeof extraGoal === "string" ? extraGoal : null,
  });
  const pregnancy = String(row.pregnancy_status ?? "")
    .trim()
    .toLowerCase();
  const schedule =
    (typeof row.preferred_meal_schedule === "string" ? row.preferred_meal_schedule : null) ??
    (typeof extra.meal_schedule_mode === "string" ? extra.meal_schedule_mode : null) ??
    (typeof extra.preferred_meal_schedule === "string" ? extra.preferred_meal_schedule : null);
  const slot = typeof extra.primary_meal_slot === "string" ? extra.primary_meal_slot : null;
  return {
    goal: resolved.text ?? resolved.direction,
    heightCm: row.height_cm == null ? null : Number(row.height_cm),
    weightKg:
      weight.rows[0]?.weight_kg == null
        ? null
        : Number(weight.rows[0].weight_kg as number | string),
    gender: mapGender((row.gender as string | null) ?? null),
    birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : null,
    ageYears: row.age_years == null ? null : Number(row.age_years),
    activityLevel: (row.activity_level as string | null) ?? null,
    trainingDays: row.training_days_per_week == null ? null : Number(row.training_days_per_week),
    allergies: typeof row.allergies === "string" ? row.allergies : "",
    dislikedFoods: typeof row.disliked_foods === "string" ? row.disliked_foods : "",
    pregnancyStatus: (row.pregnancy_status as string | null) ?? null,
    healthConditions: (row.health_conditions as string | null) ?? null,
    hasInjuries: Boolean(row.has_injuries),
    injuriesDetails: (row.injuries_details as string | null) ?? null,
    equipment: Array.isArray(row.equipment) ? (row.equipment as string[]) : [],
    location: (row.training_location as string | null) ?? null,
    mealSchedule: mapMealSchedule(schedule),
    mealScheduleExplicit: Boolean(
      schedule?.trim() && mapMealSchedule(schedule) === schedule.trim(),
    ),
    primarySlot: mapPrimarySlot(slot),
    goalText: resolved.text,
    goalFallback: resolved.fallback,
    direction: resolved.direction,
    pregnancyLimitsLoad: isBlockingPregnancyStatus(pregnancy),
  };
}

function assertReady(facts: Facts, scope: ProgramScope): void {
  const missing = missingProgramFields(
    {
      goal: facts.goal,
      heightCm: facts.heightCm,
      weightKg: facts.weightKg,
      gender: facts.gender,
      birthDate: facts.birthDate,
      ageYears: facts.ageYears,
      activityLevel: facts.activityLevel,
      trainingDays: facts.trainingDays,
    },
    scope,
  );
  if (missing.length > 0) {
    throw Object.assign(new Error(missingProgramMessage(missing)), {
      statusCode: 422,
      missing,
    });
  }
}

async function draftExists(
  db: Pool | PoolClient,
  clientId: string,
  courseId: string,
  kind: StageName,
): Promise<boolean> {
  const sql =
    kind === "nutrition"
      ? `SELECT EXISTS (
           SELECT 1 FROM public.nutrition_plans p
           JOIN public.nutrition_plan_days d ON d.plan_id = p.id
           WHERE p.user_id = $1 AND p.course_id = $2
         ) AS ok`
      : `SELECT EXISTS (
           SELECT 1 FROM public.training_programs p
           JOIN public.training_program_days d ON d.program_id = p.id
           WHERE p.user_id = $1 AND p.course_id = $2
         ) AS ok`;
  const { rows } = await db.query(sql, [clientId, courseId]);
  return Boolean(rows[0]?.ok);
}

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Превышено время генерации. Повторите этап."));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runStage(
  db: Pool,
  course: ClientCourse,
  facts: Facts,
  kind: StageName,
  deps: CourseProvisionDeps,
  sourceCourseId: string | null,
): Promise<void> {
  const statusColumn = `${kind}_generation_status`;
  const errorColumn = `${kind}_generation_error`;
  const tokenColumn = `${kind}_generation_token`;
  const startedColumn = `${kind}_generation_started_at`;
  const current = await db.query(
    `SELECT ${statusColumn} AS status, ${startedColumn} AS started_at
       FROM public.client_courses WHERE id = $1`,
    [course.id],
  );
  const status = (current.rows[0]?.status as ProgramGenerationStatus | null) ?? null;
  const startedAt = current.rows[0]?.started_at ? new Date(current.rows[0].started_at) : null;
  const exists = await draftExists(db, course.client_id, course.id, kind);
  const inScope = course.program_scope === "both" || course.program_scope === kind;
  const decision = decideGenerationStage({
    inScope,
    status,
    draftExists: exists,
    startedAt,
    now: new Date(),
    staleMs: GENERATION_TIMEOUT_MS,
  });
  if (decision === "skip") {
    if (exists && status == null) {
      await db.query(
        `UPDATE public.client_courses SET ${statusColumn} = 'ready', ${errorColumn} = NULL WHERE id = $1`,
        [course.id],
      );
    }
    return;
  }
  const token = randomUUID();
  const claimed = await db.query(
    `UPDATE public.client_courses
        SET ${statusColumn} = 'generating',
            ${errorColumn} = NULL,
            ${tokenColumn} = $2,
            ${startedColumn} = (now() AT TIME ZONE 'utc')
      WHERE id = $1
        AND (
          ${statusColumn} IS DISTINCT FROM 'generating'
          OR ${startedColumn} IS NULL
          OR ${startedColumn} < (now() AT TIME ZONE 'utc') - interval '90 seconds'
        )
      RETURNING id`,
    [course.id, token],
  );
  if (!claimed.rowCount) return;
  try {
    await withTimeout(
      kind === "nutrition"
        ? deps.generateNutrition(course.client_id, course.id, facts)
        : deps.generateTraining(course.client_id, course.id, facts, sourceCourseId),
      GENERATION_TIMEOUT_MS,
    );
    const saved = await draftExists(db, course.client_id, course.id, kind);
    if (!saved) throw new Error("Черновик не сохранился");
    await db.query(
      `UPDATE public.client_courses
          SET ${statusColumn} = 'ready', ${errorColumn} = NULL
        WHERE id = $1 AND ${tokenColumn} = $2`,
      [course.id, token],
    );
  } catch (error) {
    await db.query(
      `UPDATE public.client_courses
          SET ${statusColumn} = 'failed', ${errorColumn} = $3
        WHERE id = $1 AND ${tokenColumn} = $2`,
      [course.id, token, clipError(error)],
    );
  }
}

async function generateFreshNutrition(clientId: string, courseId: string, facts: Facts) {
  const safety = checkAutoGenerationSafety({
    birth_date: facts.birthDate,
    age_years: facts.ageYears,
    pregnancy_status: facts.pregnancyStatus,
    health_conditions: facts.healthConditions,
    profile_complete: true,
  });
  if (safety.blocked) throw new Error(safety.reasons.join(" "));
  const pool = getPostgresPool();
  const catalog = await loadOptimizerContextPg(pool);
  const { forbiddenIds } = buildForbiddenProductIds([...catalog.products.values()], {
    allergies: facts.allergies,
    disliked_foods: facts.dislikedFoods,
  });
  const profile = {
    gender: facts.gender,
    birth_date: facts.birthDate,
    age_years: facts.ageYears,
    height_cm: facts.heightCm,
    weight_kg: facts.weightKg,
    activity_level: facts.activityLevel,
    goal_primary: facts.goal,
    pregnancy_status: facts.pregnancyStatus,
    health_conditions: facts.healthConditions,
    profile_complete: true,
  };
  const calculated = calcMacroTargets(profile);
  const schedule = resolveProvisionMealSchedule({
    explicit: facts.mealScheduleExplicit,
    storedMode: facts.mealSchedule,
    carbsG: numeric(calculated.targets.carbs_g),
  });
  const generated = await generateAndValidateConstructorPlan({
    clientId,
    courseId,
    profile,
    days_count: 7,
    excluded_product_ids: [...forbiddenIds],
    meal_schedule_mode: schedule.mode,
    primary_meal_slot: facts.primarySlot,
    search_timeout_ms: 45_000,
  });
  if (!generated.is_valid || generated.days.length === 0) {
    throw new Error(generated.message || "Не удалось собрать черновик питания");
  }
  const lowCarbNote = schedule.adjustedForLowCarb
    ? "Для этих КБЖУ схема из 5 приёмов не собирается: на перекусы не хватает углеводов. Черновик собран из трёх основных приёмов."
    : null;
  await saveConstructorPlanPg(pool, {
    userId: clientId,
    courseId,
    days: generated.days,
    targets: {
      kcal: numeric(generated.targets.kcal),
      protein_g: numeric(generated.targets.protein_g),
      fat_g: numeric(generated.targets.fat_g),
      carbs_g: numeric(generated.targets.carbs_g),
    },
    plan_days_count: 7,
    plan_status: "draft",
    bmr: numeric(generated.bmr),
    tdee: numeric(generated.tdee),
    calorie_adjustment_pct: generated.adjustment_pct,
    excluded_products: [...forbiddenIds],
    targets_manual: false,
    meal_schedule_mode: schedule.mode,
    primary_meal_slot: facts.primarySlot,
    requires_manual_review: generated.requires_manual_review || schedule.adjustedForLowCarb,
    review_reason: [generated.review_reason, lowCarbNote].filter(Boolean).join("\n") || null,
  });
}

function programGoalFor(direction: TrainingDirection): ProgramGoal {
  if (direction === "weight_loss") return "weight_loss";
  if (direction === "strength") return "muscle_gain";
  if (direction === "mobility") return "rehab";
  if (direction === "endurance") return "weight_loss";
  return "tone";
}

async function generateTrainingDraft(
  clientId: string,
  courseId: string,
  facts: Facts,
  sourceCourseId: string | null,
) {
  if (facts.weightKg == null) {
    throw new Error(missingProgramMessage(["вес"]));
  }
  const direction = facts.direction;
  const contraindicated = facts.hasInjuries || facts.pregnancyLimitsLoad;
  const requestedLevel = facts.chosenLevel ?? mapTrainingLevel(facts.activityLevel ?? "low");
  const level: ProgramLevel = contraindicated ? "beginner" : requestedLevel;
  const input: ProgramInput = {
    sessions_per_week: facts.chosenSessions ?? mapTrainingDays(facts.trainingDays ?? 3),
    goal: programGoalFor(direction),
    level,
    has_injuries: facts.hasInjuries || facts.pregnancyLimitsLoad,
    injuries_details: facts.injuriesDetails,
    equipment: facts.chosenEquipment ?? facts.equipment,
    location: facts.chosenLocation ?? facts.location,
    weight_kg: facts.weightKg,
    gender: facts.gender,
  };
  const pool = getPostgresPool();
  const exercises = await loadGeneratorPoolExercisesPg(pool);
  const previous = sourceCourseId
    ? await loadPreviousTrainingContextPg(pool, clientId, courseId, sourceCourseId)
    : null;
  const previousIds = new Set(
    (previous?.days ?? []).flatMap((day) => day.exercises.map((item) => item.exercise_id)),
  );
  const available =
    previousIds.size > 0
      ? exercises.filter((exercise) => !previousIds.has(exercise.id))
      : exercises;
  const days = generateMultiWeekProgram(available, input, 4, {
    strict: true,
    blocks: await loadReadyBlocksPg(pool),
  });
  const variety = assessTrainingVariety(days, previous?.days ?? null);
  if (!variety.ok) {
    throw Object.assign(new Error(INSUFFICIENT_EXERCISE_VARIETY_MESSAGE), {
      code: INSUFFICIENT_EXERCISE_VARIETY,
    });
  }
  const notes = [
    facts.goalFallback ? GOAL_FALLBACK_MESSAGE : null,
    `Направленность: ${TRAINING_DIRECTION_LABELS[direction]}.`,
    contraindicated && requestedLevel !== "beginner"
      ? "Ограничения анкеты важнее выбранного уровня: оставлен начальный."
      : null,
    facts.chosenDuration ? `Длительность тренировки: ${facts.chosenDuration} мин.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  await saveTrainingDraftPg(pool, {
    clientId,
    courseId,
    sessions_per_week: input.sessions_per_week,
    goal: input.goal,
    level: input.level,
    has_injuries: input.has_injuries,
    injuries_details: input.injuries_details ?? null,
    equipment: input.equipment ?? [],
    location: input.location ?? null,
    notes,
    faq: defaultFaq(input),
    targets_manual: false,
    program_weeks: 4,
    days: days.map((day) => ({
      week_index: day.week_index ?? 0,
      day_index: day.day_index,
      is_rest: day.is_rest,
      title: day.title,
      focus: day.focus,
      description: day.description,
      warmup: day.warmup,
      exercises: day.exercises,
      cooldown: day.cooldown,
      day_note: day.day_note,
    })),
  });
}

async function generateNutritionDraft(clientId: string, courseId: string, facts: Facts) {
  const pool = getPostgresPool();
  const source = await sourceCourseId(pool, clientId, courseId);
  if (source) {
    await cloneNutritionPlanPg(pool, source, courseId, clientId);
    const copied = await loadConstructorPlanPg(pool, clientId, courseId);
    if (copied.plan && copied.days.length > 0) return;
  }
  await generateFreshNutrition(clientId, courseId, facts);
}

const defaultDeps: CourseProvisionDeps = {
  generateNutrition: generateNutritionDraft,
  generateTraining: generateTrainingDraft,
};

async function sourceCourseId(
  db: Pool | PoolClient,
  clientId: string,
  courseId: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM public.client_courses
      WHERE client_id = $1 AND id <> $2 AND status <> 'draft'
      ORDER BY start_date DESC LIMIT 1`,
    [clientId, courseId],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

async function reloadCourse(db: Pool | PoolClient, courseId: string): Promise<ClientCourse> {
  const { rows } = await db.query(
    `SELECT ${COURSE_RETURNING} FROM public.client_courses WHERE id = $1`,
    [courseId],
  );
  return mapCourse(rows[0] as Record<string, unknown>);
}

async function refreshTrainingDraftIfChoicesChanged(
  db: Pool,
  courseId: string,
  facts: Facts,
): Promise<void> {
  const published = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM public.training_program_versions
        WHERE course_id = $1 AND status = 'published'
     ) AS published`,
    [courseId],
  );
  if (published.rows[0]?.published) return;
  const { rows } = await db.query(
    `SELECT goal, level, sessions_per_week, notes
       FROM public.training_programs
      WHERE course_id = $1`,
    [courseId],
  );
  const row = rows[0] as
    | {
        goal: string | null;
        level: string | null;
        sessions_per_week: number | null;
        notes: string | null;
      }
    | undefined;
  const contraindicated = facts.hasInjuries || facts.pregnancyLimitsLoad;
  const needs = trainingDraftNeedsRebuild(
    row
      ? {
          goal: row.goal,
          level: row.level,
          sessions: row.sessions_per_week,
          notes: row.notes,
        }
      : null,
    {
      goal: programGoalFor(facts.direction),
      level: contraindicated
        ? "beginner"
        : (facts.chosenLevel ?? mapTrainingLevel(facts.activityLevel ?? "low")),
      sessions: facts.chosenSessions ?? mapTrainingDays(facts.trainingDays ?? 3),
      directionLabel: TRAINING_DIRECTION_LABELS[facts.direction],
    },
  );
  if (!needs) return;
  await db.query(
    `UPDATE public.client_courses
        SET training_generation_status = 'pending', training_generation_error = NULL
      WHERE id = $1 AND training_generation_status = 'ready'`,
    [courseId],
  );
}

function stagesOf(course: ClientCourse): CourseProvisionResult["stages"] {
  return {
    nutrition: {
      status: course.nutrition_generation_status ?? null,
      error: course.nutrition_generation_error ?? null,
    },
    training: {
      status: course.training_generation_status ?? null,
      error: course.training_generation_error ?? null,
    },
  };
}

export async function provisionClientCoursePg(
  pool: Pool,
  input: {
    clientId: string;
    programScope: ProgramScope;
    activate?: boolean;
    actorId: string;
    startDate?: string;
    training?: TrainingProvisionChoices;
  },
  deps: CourseProvisionDeps = defaultDeps,
): Promise<CourseProvisionResult> {
  const client = await pool.connect();
  const lockKey = `course-provision:${input.clientId}`;
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
    const facts = await loadFacts(client, input.clientId);
    assertReady(facts, input.programScope);
    const start = input.startDate ? parseISODate(input.startDate) : new Date();
    const startIso = toISODate(start);
    const endIso = toISODate(courseEndDate(start));
    await client.query("BEGIN");
    let created: ClientCourse;
    let idempotent = false;
    try {
      const existing = await client.query(
        `SELECT ${COURSE_RETURNING}
           FROM public.client_courses
          WHERE client_id = $1 AND start_date = $2::date AND program_scope = $3
            AND status = 'draft'
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [input.clientId, startIso, input.programScope],
      );
      if (existing.rows[0]) {
        created = mapCourse(existing.rows[0] as Record<string, unknown>);
        idempotent = true;
      } else {
        const inserted = await client.query(
          `INSERT INTO public.client_courses
             (client_id, title, start_date, end_date, status, created_by, program_scope,
              nutrition_generation_status, training_generation_status)
           VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9)
           RETURNING ${COURSE_RETURNING}`,
          [
            input.clientId,
            buildCourseTitleFromISO(startIso),
            startIso,
            endIso,
            "draft",
            input.actorId,
            input.programScope,
            input.programScope === "training" ? null : "pending",
            input.programScope === "nutrition" ? null : "pending",
          ],
        );
        created = mapCourse(inserted.rows[0] as Record<string, unknown>);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const trainingFacts: Facts = {
      ...facts,
      direction: input.training?.direction ?? facts.direction,
      goalFallback: input.training?.direction ? false : facts.goalFallback,
      chosenLevel: input.training?.level,
      chosenSessions: input.training?.sessionsPerWeek,
      chosenDuration: input.training?.durationMin,
      chosenLocation: input.training?.location,
      chosenEquipment: input.training?.equipment,
    };
    const source = await sourceCourseId(pool, input.clientId, created.id);
    if (created.program_scope !== "training") {
      await runStage(pool, created, trainingFacts, "nutrition", deps, source);
    }
    if (created.program_scope !== "nutrition") {
      if (input.training) {
        await refreshTrainingDraftIfChoicesChanged(pool, created.id, trainingFacts);
      }
      await runStage(pool, created, trainingFacts, "training", deps, source);
    }
    const course = await reloadCourse(pool, created.id);
    return {
      course,
      idempotent,
      stages: stagesOf(course),
      goalFallback: trainingFacts.goalFallback,
    };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => undefined);
    client.release();
  }
}

export async function retryCourseGenerationPg(
  pool: Pool,
  input: { clientId: string; courseId: string; kind?: StageName },
  deps: CourseProvisionDeps = defaultDeps,
): Promise<CourseProvisionResult> {
  const client = await pool.connect();
  const lockKey = `course-provision:${input.clientId}`;
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
    const course = await reloadCourse(client, input.courseId);
    if (course.client_id !== input.clientId) {
      throw Object.assign(new Error("Курс не найден"), { statusCode: 404 });
    }
    const facts = await loadFacts(client, input.clientId);
    assertReady(facts, course.program_scope);
    const source = await sourceCourseId(client, input.clientId, course.id);
    const kinds: StageName[] =
      input.kind != null
        ? [input.kind]
        : course.program_scope === "both"
          ? ["nutrition", "training"]
          : [course.program_scope];
    for (const kind of kinds) {
      if (course.program_scope !== "both" && course.program_scope !== kind) continue;
      const status =
        kind === "nutrition"
          ? course.nutrition_generation_status
          : course.training_generation_status;
      if (status === "ready") continue;
      await runStage(pool, course, facts, kind, deps, source);
    }
    const next = await reloadCourse(pool, course.id);
    return {
      course: next,
      idempotent: true,
      stages: stagesOf(next),
      goalFallback: facts.goalFallback,
    };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => undefined);
    client.release();
  }
}
