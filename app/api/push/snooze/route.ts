import { type NextRequest, NextResponse } from "next/server";
import { executePushSnooze } from "@/lib/push-action-handlers";
import { getPublicOriginFromRequest } from "@/lib/request-public-origin";

function wantsJsonResponse(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") || request.headers.get("x-push-action") === "1";
}

/**
 * One-click snooze from push notification (signed token, no session).
 * Returns JSON for headless service worker fetch; redirects for direct browser opens.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const result = await executePushSnooze(token);

  if (wantsJsonResponse(request)) {
    if (!result.ok) {
      const status =
        result.error === "forbidden" ? 403 : result.error === "task_not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    return NextResponse.json({
      ok: true,
      minutes: result.minutes,
      taskTitle: result.taskTitle,
    });
  }

  const origin = getPublicOriginFromRequest(request);

  if (!result.ok) {
    if (result.error === "missing_token" || result.error === "invalid_token") {
      return NextResponse.redirect(new URL("/settings", origin));
    }
    if (result.error === "forbidden") {
      return NextResponse.redirect(new URL("/tasks?push=invalid", origin));
    }
    return NextResponse.redirect(new URL("/tasks", origin));
  }

  const dest = new URL("/tasks", origin);
  dest.searchParams.set("snoozed", "1");
  return NextResponse.redirect(dest);
}
