import {
  clientAvailableEquipmentKeys,
  exerciseMatchesEquipment,
} from "@/lib/personalization/equipment-filter";
import type { ClientProfile } from "@/lib/personalization/types";
import {
  isImpactOrJumpExercise,
  isExerciseAllowedForClientGender,
  type Exercise,
  type ExerciseCategory,
} from "@/lib/training";

export type SubstituteReason = "too_hard" | "discomfort" | "equipment" | "preference";

export type SubstituteSuggestion = {
  exercise_id: string;
  slug: string;
  name: string;
  reason: string;
};

export type SubstitutePickResult = {
  source: "llm" | "rules";
  suggestions: SubstituteSuggestion[];
};

function toCandidate(e: Exercise) {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    category: e.category,
    muscle_groups: e.muscle_groups,
    equipment: e.equipment,
    difficulty: e.difficulty,
  };
}

/** Кандидаты на замену — только из переданного каталога БД. */
export function buildSubstituteCandidates(
  current: Exercise,
  catalog: Exercise[],
  profile: Pick<
    ClientProfile,
    "equipment" | "training_location" | "joint_care" | "training_level" | "gender"
  >,
  reason: SubstituteReason,
): Exercise[] {
  const available = clientAvailableEquipmentKeys(profile.equipment, profile.training_location);
  const levelRank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  const maxLevel =
    reason === "too_hard"
      ? levelRank[profile.training_level]
      : levelRank.advanced;

  return catalog.filter((e) => {
    if (e.id === current.id) return false;
    if (!isExerciseAllowedForClientGender(e, profile.gender)) return false;
    if (e.category !== current.category && reason !== "preference") return false;
    if (!exerciseMatchesEquipment(e, available)) return false;
    if (profile.joint_care && isImpactOrJumpExercise(e)) return false;
    if (levelRank[e.difficulty] > maxLevel) return false;
    return true;
  });
}

function muscleOverlap(a: string[], b: string[]): number {
  const norm = (s: string) => s.toLowerCase();
  let score = 0;
  for (const m of a) {
    if (b.some((x) => norm(x).includes(norm(m)) || norm(m).includes(norm(x)))) score++;
  }
  return score;
}

/** Rule-based подбор — fallback без LLM. */
export function pickSubstitutesRuleBased(
  current: Exercise,
  candidates: Exercise[],
  reason: SubstituteReason,
  limit = 3,
): SubstituteSuggestion[] {
  const levelRank = { beginner: 0, intermediate: 1, advanced: 2 } as const;

  const scored = candidates.map((e) => {
    let score = muscleOverlap(current.muscle_groups, e.muscle_groups) * 3;
    if (e.difficulty === current.difficulty) score += 2;
    if (levelRank[e.difficulty] < levelRank[current.difficulty]) score += 2;
    if (e.tags.includes("low_impact")) score += 1;
    if (reason === "too_hard" && levelRank[e.difficulty] < levelRank[current.difficulty]) {
      score += 3;
    }
    if (reason === "equipment" && e.equipment.length <= current.equipment.length) score += 2;
    score += Math.random() * 0.3;
    return { e, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ e }) => ({
    exercise_id: e.id,
    slug: e.slug,
    name: e.name,
    reason: reasonText(reason, current, e),
  }));
}

function reasonText(reason: SubstituteReason, from: Exercise, to: Exercise): string {
  if (reason === "too_hard") {
    return `Мягче по уровню (${to.difficulty}), те же мышцы — вместо «${from.name}».`;
  }
  if (reason === "equipment") {
    return `Под ваш инвентарь: «${to.name}».`;
  }
  if (reason === "discomfort") {
    return `Меньше нагрузки на проблемную зону — «${to.name}».`;
  }
  return `Подходит по категории ${to.category}: «${to.name}».`;
}

type LlmConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

/** LLM выбирает только из переданного списка id (строгая валидация после ответа). */
export async function pickSubstitutesWithLlm(
  current: Exercise,
  candidates: Exercise[],
  profile: Partial<ClientProfile>,
  reason: SubstituteReason,
  config: LlmConfig,
  limit = 3,
): Promise<SubstituteSuggestion[] | null> {
  if (candidates.length === 0) return null;

  const pool = candidates.slice(0, 40).map(toCandidate);
  const allowedIds = new Set(pool.map((c) => c.id));

  const system = `Ты помощник персонального тренера. Выбери до ${limit} замен упражнения ТОЛЬКО из списка candidates.
Верни JSON-массив: [{"exercise_id":"uuid","reason":"коротко по-русски"}].
Нельзя придумывать exercise_id вне списка. Не назначай лечение. Тон спокойный, без пафоса.`;

  const userPayload = {
    reason,
    current: {
      id: current.id,
      name: current.name,
      category: current.category,
      muscle_groups: current.muscle_groups,
      difficulty: current.difficulty,
    },
    client: {
      goal: profile.goal_primary,
      level: profile.training_level,
      joint_care: profile.joint_care,
      equipment: profile.equipment,
    },
    candidates: pool,
  };

  const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = config.model ?? "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Данные:\n${JSON.stringify(userPayload)}\n\nОтвет: {"suggestions":[...]}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      suggestions?: Array<{ exercise_id?: string; reason?: string }>;
    };
    const list = parsed.suggestions ?? (Array.isArray(parsed) ? parsed : []);
    const byId = new Map(candidates.map((e) => [e.id, e]));
    const out: SubstituteSuggestion[] = [];

    for (const item of list) {
      const id = item.exercise_id;
      if (!id || !allowedIds.has(id)) continue;
      const ex = byId.get(id);
      if (!ex) continue;
      out.push({
        exercise_id: id,
        slug: ex.slug,
        name: ex.name,
        reason: (item.reason ?? reasonText(reason, current, ex)).slice(0, 280),
      });
      if (out.length >= limit) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function suggestExerciseSubstitutes(params: {
  current: Exercise;
  catalog: Exercise[];
  profile: Pick<
    ClientProfile,
    | "equipment"
    | "training_location"
    | "joint_care"
    | "training_level"
    | "goal_primary"
    | "gender"
  >;
  reason: SubstituteReason;
  llm?: LlmConfig | null;
  limit?: number;
}): Promise<SubstitutePickResult> {
  const candidates = buildSubstituteCandidates(
    params.current,
    params.catalog,
    params.profile,
    params.reason,
  );

  if (candidates.length === 0) {
    return { source: "rules", suggestions: [] };
  }

  if (params.llm?.apiKey) {
    const llm = await pickSubstitutesWithLlm(
      params.current,
      candidates,
      params.profile,
      params.reason,
      params.llm,
      params.limit ?? 3,
    );
    if (llm && llm.length > 0) {
      return { source: "llm", suggestions: llm };
    }
  }

  return {
    source: "rules",
    suggestions: pickSubstitutesRuleBased(
      params.current,
      candidates,
      params.reason,
      params.limit ?? 3,
    ),
  };
}

export function parseCategory(value: string): ExerciseCategory | null {
  const allowed: ExerciseCategory[] = [
    "warmup",
    "mobility",
    "activation",
    "core",
    "strength_lower",
    "strength_upper",
    "strength_full",
    "cardio",
    "cooldown",
  ];
  return allowed.includes(value as ExerciseCategory) ? (value as ExerciseCategory) : null;
}
