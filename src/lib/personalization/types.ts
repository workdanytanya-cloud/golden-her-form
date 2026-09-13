import type { NutritionTargets } from "@/lib/nutrition";
import type { Exercise, ProgramDay, ProgramGoal, ProgramLevel } from "@/lib/training";

/** Решение адаптационного движка после weekly check-in. */
export type AdaptationDecision =
  | "KEEP"
  | "PROGRESS"
  | "REDUCE"
  | "SUBSTITUTE"
  | "RECOVER"
  | "REVIEW";

export type SafetyFlag =
  | "pregnancy"
  | "recent_surgery"
  | "serious_injury"
  | "severe_pain"
  | "fainting"
  | "health_condition"
  | "eating_disorder"
  | "medication_review"
  | "other_medical";

export type SafetyGateResult = {
  requires_trainer_review: boolean;
  requires_medical_clearance: boolean;
  flags: SafetyFlag[];
  /** Сообщение клиенту (нейтральное, без диагнозов). */
  client_message: string | null;
  /** Заметка тренеру. */
  trainer_note: string | null;
};

export type ClientProfile = {
  user_id: string;
  age: number | null;
  gender: "female" | "male" | null;
  height_cm: number | null;
  weight_kg: number | null;
  goal_primary: string | null;
  goal_details: string | null;
  timeframe: string | null;
  experience: string | null;
  activity_level: string | null;
  training_days_per_week: number;
  session_duration_min: number | null;
  training_location: string | null;
  equipment: string[];
  focus_areas: string[];
  has_injuries: boolean;
  injuries_details: string | null;
  health_conditions: string | null;
  medications: string | null;
  pregnancy_status: string | null;
  meals_per_day: number | null;
  favorite_foods: string | null;
  disliked_foods: string | null;
  allergies: string | null;
  diet_type: string | null;
  sleep_hours: number | null;
  stress_level: number | null;
  energy_level: number | null;
  job_type: string | null;
  /** Производные поля стратегии (не показывать клиенту как «рассуждения»). */
  primary_goal: ProgramGoal;
  training_level: ProgramLevel;
  joint_care: boolean;
  safety: SafetyGateResult;
};

export type ProgramValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type ProgramValidationResult = {
  ok: boolean;
  issues: ProgramValidationIssue[];
};

export type GeneratedProgramMeta = {
  program_version: string;
  generated_at: string;
  client_profile_snapshot: Partial<ClientProfile>;
  safety_flags: SafetyFlag[];
  requires_trainer_review: boolean;
  requires_medical_clearance: boolean;
  validation: ProgramValidationResult;
  reason_for_changes: string | null;
};

export type BackendProgramPayload = {
  client_profile: Partial<ClientProfile>;
  program_version: string;
  generated_at: string;
  goal: ProgramGoal;
  calorie_target: number;
  calorie_range: [number, number] | null;
  protein_target: number;
  fat_target: number;
  carb_target: number;
  daily_activity_target: number | null;
  training_days: ProgramDay[];
  exercise_ids: string[];
  safety_flags: SafetyFlag[];
  requires_trainer_review: boolean;
  reason_for_changes: string | null;
};

export type WeeklyCheckIn = {
  avg_weight_kg: number | null;
  waist_cm: number | null;
  workouts_completed: number;
  workouts_planned: number;
  avg_steps: number | null;
  hunger_1_10: number | null;
  energy_1_10: number | null;
  sleep_hours: number | null;
  training_difficulty_1_10: number | null;
  nutrition_adherence_pct: number | null;
  pain_reported: boolean;
  notes: string | null;
};

export type WorkoutFeedback = {
  completed_fully: boolean;
  difficulty_1_10: number;
  pain_reported: boolean;
  too_easy_exercises: string[];
  too_hard_exercises: string[];
  actual_weights: Record<string, number | null>;
  actual_reps: Record<string, string | null>;
  energy_before_1_10: number | null;
  wellbeing_after_1_10: number | null;
};

export type MacroTargets = NutritionTargets;

export type ExerciseCatalog = Exercise[];
