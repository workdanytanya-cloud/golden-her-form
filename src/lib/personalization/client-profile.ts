import {
  inferGoal,
  inferLevel,
  needsJointCare,
  type ProgramInput,
} from "@/lib/training";
import { evaluateSafetyGate } from "@/lib/personalization/safety-gate";
import type { ClientProfile } from "@/lib/personalization/types";

export type OnboardingForProfile = {
  user_id: string;
  goal_primary?: string | null;
  goal_details?: string | null;
  timeframe?: string | null;
  experience?: string | null;
  activity_level?: string | null;
  training_days_per_week?: number | null;
  session_duration_min?: number | null;
  training_location?: string | null;
  equipment?: string[] | null;
  focus_areas?: string[] | null;
  has_injuries?: boolean | null;
  injuries_details?: string | null;
  health_conditions?: string | null;
  medications?: string | null;
  pregnancy_status?: string | null;
  meals_per_day?: number | null;
  favorite_foods?: string | null;
  disliked_foods?: string | null;
  allergies?: string | null;
  diet_type?: string | null;
  sleep_hours?: number | null;
  stress_level?: number | null;
  energy_level?: number | null;
  job_type?: string | null;
  extra?: Record<string, unknown> | null;
};

export type ProfileDemographics = {
  gender?: "female" | "male" | null;
  birth_date?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
};

function calcAge(birth_date: string | null | undefined): number | null {
  if (!birth_date) return null;
  const age = Math.floor((Date.now() - new Date(birth_date).getTime()) / 31557600000);
  return Number.isFinite(age) && age > 0 ? age : null;
}

/** Собрать CLIENT_PROFILE из анкеты + профиля + веса. */
export function buildClientProfile(
  onboarding: OnboardingForProfile,
  demographics: ProfileDemographics,
): ClientProfile {
  const primary_goal = inferGoal(onboarding.goal_primary);
  const training_level = inferLevel(onboarding.activity_level ?? onboarding.experience);
  const programInput: ProgramInput = {
    sessions_per_week: (onboarding.training_days_per_week ?? 3) >= 4 ? 4 : 3,
    goal: primary_goal,
    level: training_level,
    has_injuries: Boolean(onboarding.has_injuries),
    injuries_details: onboarding.injuries_details,
    equipment: onboarding.equipment ?? [],
    location: onboarding.training_location,
    weight_kg: demographics.weight_kg,
  };

  const safety = evaluateSafetyGate({
    pregnancy_status: onboarding.pregnancy_status,
    has_injuries: onboarding.has_injuries,
    injuries_details: onboarding.injuries_details,
    health_conditions: onboarding.health_conditions,
    medications: onboarding.medications,
    extra: onboarding.extra,
  });

  return {
    user_id: onboarding.user_id,
    age: calcAge(demographics.birth_date),
    gender: demographics.gender ?? null,
    height_cm: demographics.height_cm ?? null,
    weight_kg: demographics.weight_kg ?? null,
    goal_primary: onboarding.goal_primary ?? null,
    goal_details: onboarding.goal_details ?? null,
    timeframe: onboarding.timeframe ?? null,
    experience: onboarding.experience ?? null,
    activity_level: onboarding.activity_level ?? null,
    training_days_per_week: onboarding.training_days_per_week ?? 3,
    session_duration_min: onboarding.session_duration_min ?? null,
    training_location: onboarding.training_location ?? null,
    equipment: onboarding.equipment ?? [],
    focus_areas: onboarding.focus_areas ?? [],
    has_injuries: Boolean(onboarding.has_injuries),
    injuries_details: onboarding.injuries_details ?? null,
    health_conditions: onboarding.health_conditions ?? null,
    medications: onboarding.medications ?? null,
    pregnancy_status: onboarding.pregnancy_status ?? null,
    meals_per_day: onboarding.meals_per_day ?? null,
    favorite_foods: onboarding.favorite_foods ?? null,
    disliked_foods: onboarding.disliked_foods ?? null,
    allergies: onboarding.allergies ?? null,
    diet_type: onboarding.diet_type ?? null,
    sleep_hours: onboarding.sleep_hours ?? null,
    stress_level: onboarding.stress_level ?? null,
    energy_level: onboarding.energy_level ?? null,
    job_type: onboarding.job_type ?? null,
    primary_goal,
    training_level,
    joint_care: needsJointCare(programInput),
    safety,
  };
}

/** Краткое объяснение для клиента — почему программа именно такая. */
export function explainProgramForClient(profile: ClientProfile): string {
  const parts: string[] = [];
  const goal = profile.goal_primary ?? "ваша цель";
  parts.push(`Программа собрана под «${goal}» с учётом вашего уровня и ${profile.training_days_per_week} тренировок в неделю.`);

  if (profile.joint_care) {
    parts.push("Мы убрали ударные и прыжковые упражнения — так нагрузка будет мягче для суставов.");
  }
  if (profile.session_duration_min) {
    parts.push(`Объём рассчитан на ~${profile.session_duration_min} минут за занятие.`);
  }
  if (profile.equipment.length > 0 && !profile.equipment.includes("Ничего")) {
    parts.push("Упражнения подобраны под ваш доступный инвентарь.");
  }
  return parts.slice(0, 4).join(" ");
}
