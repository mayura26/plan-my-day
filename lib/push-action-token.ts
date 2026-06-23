import { createHmac, timingSafeEqual } from "node:crypto";

export type ReminderEntityType = "task-critical" | "test";
export type ReminderNotificationAction = "complete" | "snooze";

/** @deprecated Legacy action types for old notification links */
export type PushActionType = "snooze15" | "snooze60" | "complete";

export interface SignedPushActionPayload {
  v: 1;
  userId: string;
  subscriptionId?: string;
  entityType: ReminderEntityType;
  entityId: string;
  action: ReminderNotificationAction;
  expiresAt: number;
}

/** @deprecated Legacy wrapped JSON token payload */
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

function signEncodedPayload(encodedPayload: string): string {
  return createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

function signLegacyPayload(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export const PUSH_ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isSignedPushActionPayload(value: unknown): value is SignedPushActionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === 1 &&
    typeof payload.userId === "string" &&
    payload.userId.length > 0 &&
    (payload.subscriptionId === undefined ||
      (typeof payload.subscriptionId === "string" && payload.subscriptionId.length > 0)) &&
    (payload.entityType === "task-critical" || payload.entityType === "test") &&
    typeof payload.entityId === "string" &&
    payload.entityId.length > 0 &&
    (payload.action === "complete" || payload.action === "snooze") &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt)
  );
}

export function signPushActionToken(
  input: Omit<SignedPushActionPayload, "v" | "expiresAt"> & { expiresAt?: number }
): string {
  const payload: SignedPushActionPayload = {
    v: 1,
    userId: input.userId,
    ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    expiresAt: input.expiresAt ?? Date.now() + PUSH_ACTION_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signEncodedPayload(encodedPayload)}`;
}

export function verifyPushActionToken(token: string): SignedPushActionPayload | null {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) return null;

  const expected = signEncodedPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    return null;
  }

  if (!isSignedPushActionPayload(payload)) return null;
  if (payload.expiresAt <= Date.now()) return null;
  return payload;
}

/** @deprecated Legacy path-token format — use signPushActionToken + query URLs */
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
  const sig = signLegacyPayload(json);
  const combined = JSON.stringify({ p: body, s: sig });
  return Buffer.from(combined, "utf8").toString("base64url");
}

/** @deprecated Legacy path-token format */
export function decodePushActionToken(token: string): PushActionPayload | null {
  try {
    const combined = Buffer.from(token, "base64url").toString("utf8");
    const { p, s } = JSON.parse(combined) as { p: PushActionPayload; s: string };
    if (!p?.userId || !p?.action || typeof p.exp !== "number") {
      return null;
    }

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
    const expected = signLegacyPayload(json);
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

/** @deprecated Use buildReminderActionPaths */
export function buildSnoozeApiUrl(taskId: string, userId: string, action: PushActionType): string {
  const token = encodePushActionToken({
    entityType: "task-critical",
    entityId: taskId,
    userId,
    action: action === "complete" ? "complete" : "snooze",
  });
  return `/api/push/snooze?token=${encodeURIComponent(token)}`;
}

/** @deprecated Use buildReminderActionPaths */
export function buildCompletePageUrl(taskId: string, userId: string): string {
  const token = encodePushActionToken({
    entityType: "task-critical",
    entityId: taskId,
    userId,
    action: "complete",
  });
  return `/push/complete?token=${encodeURIComponent(token)}`;
}
