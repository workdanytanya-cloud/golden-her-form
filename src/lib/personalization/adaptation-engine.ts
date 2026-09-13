import type { AdaptationDecision, WeeklyCheckIn, WorkoutFeedback } from "@/lib/personalization/types";

/**
 * ADAPTATION ENGINE — одно решение после check-in.
 * LLM не принимает решение; правила в коде. AI может позже предлагать SUBSTITUTE-варианты.
 */
export function decideWeeklyAdaptation(checkIn: WeeklyCheckIn): AdaptationDecision {
  if (checkIn.pain_reported) return "REVIEW";

  const adherence =
    checkIn.workouts_planned > 0
      ? checkIn.workouts_completed / checkIn.workouts_planned
      : 1;

  if (adherence < 0.5) return "RECOVER";

  const difficulty = checkIn.training_difficulty_1_10 ?? 5;
  const energy = checkIn.energy_1_10 ?? 5;
  const hunger = checkIn.hunger_1_10 ?? 5;

  if (difficulty >= 9 || energy <= 3) return "REDUCE";
  if (difficulty <= 6 && energy >= 6 && adherence >= 0.85) return "PROGRESS";
  if (hunger >= 9) return "REVIEW";

  return "KEEP";
}

/** Прогрессия после одной тренировки (auto-regulation). */
export function decideWorkoutProgression(feedback: WorkoutFeedback): AdaptationDecision {
  if (feedback.pain_reported) return "REVIEW";
  if (!feedback.completed_fully) return "KEEP";

  const rpe = feedback.difficulty_1_10;
  if (rpe <= 6) return "PROGRESS";
  if (rpe >= 9) return "REDUCE";
  return "KEEP";
}

/** Человеческое объяснение решения для клиента. */
export function explainAdaptation(decision: AdaptationDecision): string {
  switch (decision) {
    case "KEEP":
      return "На этой неделе оставляем программу без изменений — она работает стабильно.";
    case "PROGRESS":
      return "Вы уверенно справляетесь — на следующей неделе добавим небольшую прогрессию.";
    case "REDUCE":
      return "Нагрузка давалась тяжело — немного уменьшим объём, чтобы восстановиться и двигаться дальше.";
    case "SUBSTITUTE":
      return "Заменим отдельные упражнения или блюда — так программа будет удобнее именно для вас.";
    case "RECOVER":
      return "На этой неделе сделаем акцент на восстановлении и более мягком режиме.";
    case "REVIEW":
      return "Тренер проверит программу перед следующими изменениями.";
  }
}
