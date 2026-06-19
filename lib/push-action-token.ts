import { createHmac, timingSafeEqual } from "node:crypto";

export type ReminderEntityType = "task-critical" | "test";
export type ReminderNotificationAction = "complete" | "snooze";

/** @deprecated Legacy action types for old notification links */
export type PushActionType = "snooze15" | "snooze60" | "complete";

export interface PushActionPayload {
  entityType: ReminderEntityType;
  entityId: string;
  userId: string;
  action: ReminderNotificationAction;
  exp: number;
  subscriptionId?: string;
}

function getSecret(): string {
  const s = process.env.PUSH_ACTION_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) {
    throw new Error("PUSH_ACTION_SECRET or NEXTAUTH_SECRET must be set for push action tokens");
  }
  return s;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

const PUSH_ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function encodePushActionToken(
  p: Omit<PushActionPayload, "exp"> & { exp?: number }
): string {
  const exp = p.exp ?? Date.now() + PUSH_ACTION_TOKEN_TTL_MS;
  const body: PushActionPayload = {
    entityType: p.entityType,
    entityId: p.entityId,
    userId: p.userId,
    action: p.action,
    exp,
    ...(p.subscriptionId ? { subscriptionId: p.subscriptionId } : {}),
  };
  const json = JSON.stringify(body);
  const sig = signPayload(json);
  const combined = JSON.stringify({ p: body, s: sig });
  return Buffer.from(combined, "utf8").toString("base64url");
}

export function decodePushActionToken(token: string): PushActionPayload | null {
  try {
    const combined = Buffer.from(token, "base64url").toString("utf8");
    const { p, s } = JSON.parse(combined) as { p: PushActionPayload; s: string };
    if (!p?.userId || !p?.action || typeof p.exp !== "number") {
      return null;
    }

    // Support legacy tokens that used taskId instead of entityId
    const entityId = p.entityId ?? (p as { taskId?: string }).taskId;
    const entityType = p.entityType ?? "task-critical";
    if (!entityId) {
      return null;
    }

    const normalized: PushActionPayload = {
      entityType,
      entityId,
      userId: p.userId,
      action: normalizeAction(p.action),
      exp: p.exp,
      subscriptionId: p.subscriptionId,
    };

    const json = JSON.stringify(p);
    const expected = signPayload(json);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(s, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    if (Date.now() > normalized.exp) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function normalizeAction(action: string): ReminderNotificationAction {
  if (action === "snooze" || action === "snooze15" || action === "snooze60") {
    return "snooze";
  }
  return "complete";
}

export function snoozeMinutesForAction(_action?: ReminderNotificationAction): number {
  return 15;
}

/** @deprecated Use buildReminderActionPaths — kept for old links */
export function buildSnoozeApiUrl(taskId: string, userId: string, action: PushActionType): string {
  const token = encodePushActionToken({
    entityType: "task-critical",
    entityId: taskId,
    userId,
    action: action === "complete" ? "complete" : "snooze",
  });
  return `/api/push/snooze?token=${encodeURIComponent(token)}`;
}

/** @deprecated Use buildReminderActionPaths — kept for old links */
export function buildCompletePageUrl(taskId: string, userId: string): string {
  const token = encodePushActionToken({
    entityType: "task-critical",
    entityId: taskId,
    userId,
    action: "complete",
  });
  return `/push/complete?token=${encodeURIComponent(token)}`;
}
