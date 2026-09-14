/** Lightweight cross-component sync without Realtime or polling loops. */
export const SELFHOST_NOTIFICATIONS_EVENT = "selfhost-notifications-changed";

export type SelfhostNotificationsChangedDetail = {
  scope: "client" | "admin";
};

export function emitSelfhostNotificationsChanged(scope: "client" | "admin") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SelfhostNotificationsChangedDetail>(SELFHOST_NOTIFICATIONS_EVENT, {
      detail: { scope },
    }),
  );
}
