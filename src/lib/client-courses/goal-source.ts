export type TrainingDirection =
  "weight_loss" | "general_fitness" | "strength" | "endurance" | "mobility";

export type GoalSources = {
  profileGoal?: string | null;
  goalPrimary?: string | null;
  goalDetails?: string | null;
  extraGoal?: string | null;
};

export const TRAINING_DIRECTION_LABELS: Record<TrainingDirection, string> = {
  weight_loss: "Снижение веса",
  general_fitness: "Общая физическая подготовка",
  strength: "Укрепление мышц",
  endurance: "Повышение выносливости",
  mobility: "Мобильность и восстановление",
};

export const GOAL_FALLBACK_MESSAGE =
  "Клиент не указал цель. Для тренировок выбрана общая физическая подготовка. Вы можете изменить направленность";

const TEXT_FIELDS = ["profileGoal", "goalPrimary", "goalDetails", "extraGoal"] as const;

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Первая непустая цель из карточки, анкеты или legacy-поля. Ожидания и медицина сюда не входят. */
export function goalTextFromSources(sources: GoalSources): string | null {
  for (const field of TEXT_FIELDS) {
    const text = clean(sources[field]);
    if (text) return text;
  }
  return null;
}

export function directionFromGoalText(raw: string | null | undefined): TrainingDirection | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (/(похуд|снижен|жир|weight_loss|lose_weight|lose|минус|\d+\s*кг|набор веса нет)/.test(value)) {
    return "weight_loss";
  }
  if (/(вынослив|endurance|cardio)/.test(value)) return "endurance";
  if (/(мобиль|восстанов|реабилит|rehab|mobility)/.test(value)) return "mobility";
  if (/(укреп|сил|набор|мышц|muscle|strength|gain)/.test(value)) return "strength";
  if (/(общая|general_fitness|\bgeneral\b|тонус|tone|поддержан|maintain)/.test(value)) {
    return "general_fitness";
  }
  return null;
}

export function resolveClientGoal(sources: GoalSources): {
  text: string | null;
  direction: TrainingDirection;
  fallback: boolean;
} {
  const text = goalTextFromSources(sources);
  const direction = directionFromGoalText(text);
  if (!text) return { text: null, direction: "general_fitness", fallback: true };
  if (!direction) return { text, direction: "general_fitness", fallback: false };
  return { text, direction, fallback: false };
}
