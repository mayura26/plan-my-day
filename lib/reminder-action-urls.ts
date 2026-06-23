import {
  type ReminderEntityType,
  type ReminderNotificationAction,
  signPushActionToken,
} from "@/lib/push-action-token";

export interface BuildReminderActionPathsInput {
  entityType: ReminderEntityType;
  entityId: string;
  userId: string;
  subscriptionId?: string;
}

interface ReminderActionUrlInput {
  entityType: ReminderEntityType;
  entityId: string;
  action: ReminderNotificationAction;
  actionToken: string;
}

/** Stable action page — short query params instead of a long path segment. */
export function buildReminderActionPath({
  entityType,
  entityId,
  action,
  actionToken,
}: ReminderActionUrlInput): string {
  const params = new URLSearchParams({
    entityType,
    entityId,
    action,
    actionToken,
  });
  return `/reminder/action?${params.toString()}`;
}

/** @deprecated Legacy path-token URLs */
export function buildReminderActionTokenPath(token: string): string {
  return `/reminder/a/${token}`;
}

export function buildReminderActionPaths(
  input: BuildReminderActionPathsInput
): Record<ReminderNotificationAction, string> {
  const completeToken = signPushActionToken({
    ...input,
    action: "complete",
  });
  const snoozeToken = signPushActionToken({
    ...input,
    action: "snooze",
  });

  return {
    complete: buildReminderActionPath({
      entityType: input.entityType,
      entityId: input.entityId,
      action: "complete",
      actionToken: completeToken,
    }),
    snooze: buildReminderActionPath({
      entityType: input.entityType,
      entityId: input.entityId,
      action: "snooze",
      actionToken: snoozeToken,
    }),
  };
}
