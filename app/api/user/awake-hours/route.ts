import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { GroupScheduleHours } from "@/lib/types";

// GET /api/user/awake-hours - Get user's awake hours
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute("SELECT awake_hours FROM users WHERE id = ?", [
      session.user.id,
    ]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let awakeHours: GroupScheduleHours | null = null;
    if (result.rows[0].awake_hours) {
      try {
        awakeHours = JSON.parse(result.rows[0].awake_hours as string);
      } catch (e) {
        console.error("Error parsing awake_hours JSON:", e);
        awakeHours = null;
      }
    }

    return NextResponse.json({ awake_hours: awakeHours });
  } catch (error) {
    console.error("Error fetching awake hours:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/user/awake-hours - Update user's awake hours
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: { awake_hours: GroupScheduleHours | null } = await request.json();

    // Validate awake_hours structure if provided
    if (body.awake_hours !== null && body.awake_hours !== undefined) {
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      const scheduleHours = body.awake_hours;

      for (const day of validDays) {
        const daySchedule = scheduleHours[day as keyof GroupScheduleHours];
        if (daySchedule !== undefined && daySchedule !== null) {
          if (
            typeof daySchedule.start !== "number" ||
            typeof daySchedule.end !== "number" ||
            daySchedule.start < 0 ||
            daySchedule.start > 23 ||
            daySchedule.end < 0 ||
            daySchedule.end > 23 ||
            daySchedule.start >= daySchedule.end
          ) {
            return NextResponse.json(
              {
                error: `Invalid time range for ${day}. Start and end must be valid hours (0-23) and start must be before end.`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    const awakeHoursJson =
      body.awake_hours === null || body.awake_hours === undefined
        ? null
        : JSON.stringify(body.awake_hours);

    const now = new Date().toISOString();

    await db.execute(`UPDATE users SET awake_hours = ?, updated_at = ? WHERE id = ?`, [
      awakeHoursJson,
      now,
      session.user.id,
    ]);

    return NextResponse.json({
      awake_hours: body.awake_hours,
      message: "Awake hours updated successfully",
    });
  } catch (error) {
    console.error("Error updating awake hours:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

