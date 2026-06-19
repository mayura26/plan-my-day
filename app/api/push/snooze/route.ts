import { type NextRequest, NextResponse } from "next/server";
import { performReminderActionFromToken } from "@/lib/push-action-handlers";
import { getPublicOriginFromRequest } from "@/lib/request-public-origin";

function wantsJsonResponse(request: NextRequest): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") || request.headers.get("x-push-action") === "1";
}

/**
 * Legacy snooze API — redirects to token page for browser opens; JSON for headless clients.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const outcome = await performReminderActionFromToken(token);

  if (wantsJsonResponse(request)) {
    if (!outcome.ok) {
      const status =
        outcome.error === "unauthorized" ? 403 : outcome.error === "not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: outcome.error }, { status });
    }
    return NextResponse.json({
      ok: true,
      minutes: outcome.minutes,
      taskTitle: outcome.taskTitle,
    });
  }

  const origin = getPublicOriginFromRequest(request);

  if (token) {
    return NextResponse.redirect(new URL(`/reminder/a/${token}`, origin));
  }

  if (!outcome.ok) {
    return NextResponse.redirect(new URL("/settings", origin));
  }

  return NextResponse.redirect(new URL("/tasks?snoozed=1", origin));
}
