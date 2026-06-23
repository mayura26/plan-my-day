import { type NextRequest, NextResponse } from "next/server";
import { performReminderAction } from "@/lib/push-action-handlers";
import {
  type ReminderEntityType,
  type ReminderNotificationAction,
} from "@/lib/push-action-token";

function getSearchParam(req: NextRequest, key: string): string | undefined {
  const value = req.nextUrl.searchParams.get(key);
  return value ?? undefined;
}

function isEntityType(value: string | undefined): value is ReminderEntityType {
  return value === "task-critical" || value === "test";
}

function isAction(value: string | undefined): value is ReminderNotificationAction {
  return value === "complete" || value === "snooze";
}

function parseReminderActionRequest(req: NextRequest) {
  return {
    entityType: getSearchParam(req, "entityType"),
    entityId: getSearchParam(req, "entityId"),
    action: getSearchParam(req, "action"),
    actionToken: getSearchParam(req, "actionToken"),
  };
}

async function handleReminderAction(req: NextRequest) {
  const query = parseReminderActionRequest(req);
  let body: Record<string, unknown> = {};

  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const entityType = (body.entityType as string | undefined) ?? query.entityType;
  const entityId = (body.entityId as string | undefined) ?? query.entityId;
  const action = (body.action as string | undefined) ?? query.action;
  const actionToken = (body.actionToken as string | undefined) ?? query.actionToken;

  if (!isEntityType(entityType) || !entityId || !isAction(action) || !actionToken) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const outcome = await performReminderAction({
      entityType,
      entityId,
      action,
      actionToken,
    });

    if (!outcome.ok) {
      const status =
        outcome.error === "unauthorized" ? 401 : outcome.error === "not_found" ? 404 : 400;
      return NextResponse.json({ error: outcome.error }, { status });
    }

    return NextResponse.json(outcome);
  } catch (error) {
    console.error("Reminder action API failed:", error);
    return NextResponse.json({ error: "invalid" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleReminderAction(req);
}

export async function POST(req: NextRequest) {
  return handleReminderAction(req);
}
