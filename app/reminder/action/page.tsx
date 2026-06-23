import { ReminderActionView } from "@/components/reminder/ReminderActionView";
import {
  performReminderAction,
  type ReminderActionOutcome,
} from "@/lib/push-action-handlers";
import {
  type ReminderEntityType,
  type ReminderNotificationAction,
} from "@/lib/push-action-token";

interface ReminderActionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function isEntityType(value: string | undefined): value is ReminderEntityType {
  return value === "task-critical" || value === "test";
}

function isAction(value: string | undefined): value is ReminderNotificationAction {
  return value === "complete" || value === "snooze";
}

export default async function ReminderActionPage({ searchParams }: ReminderActionPageProps) {
  const params = await searchParams;
  const entityType = getParam(params, "entityType");
  const entityId = getParam(params, "entityId");
  const action = getParam(params, "action");
  const actionToken = getParam(params, "actionToken");

  if (!isEntityType(entityType) || !entityId || !isAction(action) || !actionToken) {
    return <ReminderActionView outcome={{ ok: false, error: "invalid" }} />;
  }

  let outcome: ReminderActionOutcome;
  try {
    outcome = await performReminderAction({
      entityType,
      entityId,
      action,
      actionToken,
    });
  } catch (error) {
    console.error("Reminder action failed:", error);
    return <ReminderActionView outcome={{ ok: false, error: "invalid" }} />;
  }

  return <ReminderActionView outcome={outcome} />;
}
