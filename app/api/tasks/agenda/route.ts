import { type NextRequest, NextResponse } from "next/server";
import {
  formatDateKey,
  mapRowToAgendaItem,
  parseDateOnly,
  requireApiUser,
  type AgendaItem,
} from "@/lib/external-api";
import { createDateInTimezone, getDateInTimezone, getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";

const MAX_AGENDA_DAYS = 31;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/tasks/agenda?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Returns scheduled items owned by the API key user, grouped by day (inclusive range).
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiUser(request);
    if (authResult.error) return authResult.error;
    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "Query parameters 'start' and 'end' are required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    if (!DATE_ONLY_RE.test(startParam) || !DATE_ONLY_RE.test(endParam)) {
      return NextResponse.json(
        { error: "start and end must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const startParts = parseDateOnly(startParam);
    const endParts = parseDateOnly(endParam);
    if (!startParts || !endParts) {
      return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
    }

    const startUtcProbe = Date.UTC(startParts.year, startParts.monthIndex, startParts.day);
    const endUtcProbe = Date.UTC(endParts.year, endParts.monthIndex, endParts.day);
    if (endUtcProbe < startUtcProbe) {
      return NextResponse.json({ error: "end must be on or after start" }, { status: 400 });
    }

    const dayCount = Math.floor((endUtcProbe - startUtcProbe) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_AGENDA_DAYS) {
      return NextResponse.json(
        { error: `Date range cannot exceed ${MAX_AGENDA_DAYS} days` },
        { status: 400 }
      );
    }

    const userResult = await db.execute("SELECT timezone FROM users WHERE id = ?", [userId]);
    const timezone =
      userResult.rows.length > 0
        ? getUserTimezone(userResult.rows[0].timezone as string | null)
        : "UTC";

    // Inclusive local-day bounds → UTC ISO for overlap query
    const rangeStartLocal = new Date(
      startParts.year,
      startParts.monthIndex,
      startParts.day,
      12,
      0,
      0,
      0
    );
    const rangeStartUtc = createDateInTimezone(rangeStartLocal, 0, 0, timezone);
    const rangeEndExclusiveUtc = createDateInTimezone(
      new Date(endParts.year, endParts.monthIndex, endParts.day + 1, 12, 0, 0, 0),
      0,
      0,
      timezone
    );

    const tasksResult = await db.execute(
      `SELECT * FROM tasks
       WHERE user_id = ?
         AND status != 'cancelled'
         AND scheduled_start IS NOT NULL
         AND scheduled_start < ?
         AND COALESCE(scheduled_end, scheduled_start) > ?
       ORDER BY scheduled_start ASC`,
      [userId, rangeEndExclusiveUtc.toISOString(), rangeStartUtc.toISOString()]
    );

    // Seed every day in range with empty arrays
    const daysMap = new Map<string, AgendaItem[]>();
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(startUtcProbe + i * 24 * 60 * 60 * 1000);
      const key = formatDateKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      daysMap.set(key, []);
    }

    for (const row of tasksResult.rows) {
      const item = mapRowToAgendaItem(row as Record<string, unknown>);
      if (!item.scheduled_start) continue;

      const localDay = getDateInTimezone(item.scheduled_start, timezone);
      const key = formatDateKey(
        localDay.getFullYear(),
        localDay.getMonth(),
        localDay.getDate()
      );

      const bucket = daysMap.get(key);
      if (bucket) {
        bucket.push(item);
      }
    }

    const days = Array.from(daysMap.entries()).map(([date, items]) => ({
      date,
      items,
    }));

    return NextResponse.json({
      timezone,
      start: startParam,
      end: endParam,
      days,
    });
  } catch (error) {
    console.error("Error fetching agenda:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
