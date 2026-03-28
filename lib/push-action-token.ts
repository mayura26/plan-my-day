import { createHmac, timingSafeEqual } from "node:crypto";

export type PushActionType = "snooze15" | "snooze60";

export interface PushActionPayload {
  taskId: string;
  userId: string;
  action: PushActionType;
  exp: number;
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

/**
 * Signed token for one-click snooze from push notifications (no session cookie).
 * Token is URL-safe base64 JSON + hex signature.
 */
export function encodePushActionToken(
  p: Omit<PushActionPayload, "exp"> & { exp?: number }
): string {
  const exp = p.exp ?? Date.now() + 60 * 60 * 1000;
  const body: PushActionPayload = {
    taskId: p.taskId,
    userId: p.userId,
    action: p.action,
    exp,
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
    if (!p?.taskId || !p?.userId || !p?.action || typeof p.exp !== "number") {
      return null;
    }
    const json = JSON.stringify(p);
    const expected = signPayload(json);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(s, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    if (Date.now() > p.exp) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function snoozeMinutesForAction(action: PushActionType): number {
  switch (action) {
    case "snooze15":
      return 15;
    case "snooze60":
      return 60;
    default:
      return 15;
  }
}

export function buildSnoozeApiUrl(
  baseUrl: string,
  taskId: string,
  userId: string,
  action: PushActionType
): string {
  const token = encodePushActionToken({ taskId, userId, action });
  const u = new URL("/api/push/snooze", baseUrl.replace(/\/$/, ""));
  u.searchParams.set("token", token);
  return u.href;
}
