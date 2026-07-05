export type AccessStatus =
  | "pending_onboarding"
  | "awaiting_approval"
  | "active"
  | "paused";

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  pending_onboarding: "Ожидает анкеты",
  awaiting_approval: "Ждёт подтверждения",
  active: "Активен",
  paused: "На паузе",
};

export const ACCESS_STATUS_TONE: Record<AccessStatus, string> = {
  pending_onboarding: "border-warm-gray/30 bg-warm-gray/10 text-warm-gray",
  awaiting_approval: "border-coral/40 bg-coral/15 text-coral",
  active: "border-gold/50 bg-gold/15 text-gold",
  paused: "border-warm-gray/30 bg-warm-gray/10 text-warm-gray",
};

export function isAccessStatus(v: unknown): v is AccessStatus {
  return (
    v === "pending_onboarding" ||
    v === "awaiting_approval" ||
    v === "active" ||
    v === "paused"
  );
}
