import type { SafetyFlag, SafetyGateResult } from "@/lib/personalization/types";

export type OnboardingSafetyInput = {
  pregnancy_status?: string | null;
  has_injuries?: boolean | null;
  injuries_details?: string | null;
  health_conditions?: string | null;
  medications?: string | null;
  extra?: Record<string, unknown> | null;
};

const PREGNANCY_RE =
  /беремен|кормл|lactat|pregnan|trimester|послерод|postpartum/i;
const SURGERY_RE =
  /операц|операци|хирург|surgery|оперирован|реконструкц|эндопротез|перелом\s*(?:<|менее|недав)/i;
const SEVERE_PAIN_RE =
  /сильн.*бол|острая\s*боль|не\s*могу\s*(?:ходить|двиг)|выражен.*бол|severe\s*pain/i;
const FAINTING_RE = /обморок|потеря\s*сознан|syncope|faint/i;
const HEALTH_CONDITION_RE =
  /диабет|инсулин|гипертон|аритми|астм|онколог|эпилеп|сердеч|ишем|инфаркт|инсульт|гипотиреоз|аутоиммун|рассеян/i;
const EATING_DISORDER_RE =
  /расстройств.*питан|анorexi|bulimi|компульсив.*переед|РПП|булими|анорекс/i;
const MEDICATION_RE =
  /антикоагул|варfarin|варфарин|инсулин|стероид|иммунодепress|химиотерап/i;

function textBlob(o: OnboardingSafetyInput): string {
  return [
    o.pregnancy_status,
    o.injuries_details,
    o.health_conditions,
    o.medications,
    JSON.stringify(o.extra ?? {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function pushFlag(flags: SafetyFlag[], flag: SafetyFlag) {
  if (!flags.includes(flag)) flags.push(flag);
}

/**
 * SAFETY GATE — не создаём «лечебную» программу автоматически.
 * При рисках — флаг review / medical clearance + нейтральное сообщение клиенту.
 */
export function evaluateSafetyGate(input: OnboardingSafetyInput): SafetyGateResult {
  const flags: SafetyFlag[] = [];
  const blob = textBlob(input);

  if (PREGNANCY_RE.test(blob) || PREGNANCY_RE.test(input.pregnancy_status ?? "")) {
    pushFlag(flags, "pregnancy");
  }
  if (SURGERY_RE.test(blob)) pushFlag(flags, "recent_surgery");
  if (input.has_injuries && SEVERE_PAIN_RE.test(blob)) pushFlag(flags, "severe_pain");
  if (FAINTING_RE.test(blob)) pushFlag(flags, "fainting");
  if (HEALTH_CONDITION_RE.test(blob)) pushFlag(flags, "health_condition");
  if (EATING_DISORDER_RE.test(blob)) pushFlag(flags, "eating_disorder");
  if (MEDICATION_RE.test(blob)) pushFlag(flags, "medication_review");

  if (input.has_injuries && (input.injuries_details ?? "").trim().length > 20) {
    pushFlag(flags, "serious_injury");
  }

  const requires_medical_clearance =
    flags.includes("pregnancy") ||
    flags.includes("recent_surgery") ||
    flags.includes("eating_disorder") ||
    flags.includes("health_condition");

  const requires_trainer_review =
    requires_medical_clearance ||
    flags.length > 0;

  let client_message: string | null = null;
  let trainer_note: string | null = null;

  if (requires_trainer_review) {
    client_message =
      "Мы получили вашу анкету. Программа будет подготовлена после дополнительной проверки специалистом — это нужно, чтобы нагрузка и питание были безопасными именно для вас.";
    trainer_note = `Safety gate: ${flags.join(", ") || "manual review"}. Проверьте анкету перед активацией курса.`;
  }

  return {
    requires_trainer_review,
    requires_medical_clearance,
    flags,
    client_message,
    trainer_note,
  };
}
