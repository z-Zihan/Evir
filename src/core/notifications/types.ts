export type SystemNotificationEvent =
  "run-completed" | "approval-required" | "run-failed" | "update-available";

export interface SystemNotificationSettings {
  enabled: boolean;
  events: Readonly<Record<SystemNotificationEvent, boolean>>;
  onlyWhenAppUnfocused: boolean;
  includeSensitivePreview: boolean;
  playSound: boolean;
}

export const DEFAULT_SYSTEM_NOTIFICATION_SETTINGS: SystemNotificationSettings = {
  enabled: false,
  events: {
    "run-completed": true,
    "approval-required": true,
    "run-failed": true,
    "update-available": false,
  },
  onlyWhenAppUnfocused: true,
  includeSensitivePreview: false,
  playSound: false,
};

export interface NotificationPayload {
  title: string;
  body?: string;
  event: SystemNotificationEvent;
}

export interface NotificationPort {
  getPermissionState(): Promise<"default" | "granted" | "denied" | "unsupported">;
  requestPermissionFromUserGesture(): Promise<"granted" | "denied" | "unsupported">;
  send(payload: NotificationPayload): Promise<void>;
}
