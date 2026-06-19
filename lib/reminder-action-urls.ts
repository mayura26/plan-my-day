import {
  encodePushActionToken,
  type ReminderEntityType,
  type ReminderNotificationAction,
} from "@/lib/push-action-token";

export interface BuildReminderActionPathsInput {
  entityType: ReminderEntityType;
  entityId: string;
  userId: string;
  subscriptionId?: string;
}

export function buildReminderActionTokenPath(token: string): string {
  return `/reminder/a/${token}`;
}

export function buildReminderActionPaths(
  input: BuildReminderActionPathsInput
): Record<ReminderNotificationAction, string> {
  const completeToken = encodePushActionToken({
    ...input,
    action: "complete",
  });
  const snoozeToken = encodePushActionToken({
    ...input,
    action: "snooze",
  });

  return {
    complete: buildReminderActionTokenPath(completeToken),
    snooze: buildReminderActionTokenPath(snoozeToken),
  };
}
