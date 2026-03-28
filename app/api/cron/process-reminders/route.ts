import { type NextRequest, NextResponse } from "next/server";
import { processReminders } from "@/lib/reminder-processor";

/**
 * Vercel Cron or external monitor: GET with Authorization: Bearer CRON_SECRET
 * Configure schedule in vercel.json (e.g. every minute).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processReminders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("process-reminders cron failed:", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
