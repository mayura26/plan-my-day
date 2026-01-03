import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { GroupScheduleHours } from "@/lib/types";

// GET /api/user/working-hours - Get user's working hours
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute("SELECT working_hours FROM users WHERE id = ?", [
      session.user.id,
    ]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let workingHours: GroupScheduleHours | null = null;
    if (result.rows[0].working_hours) {
      try {
        workingHours = JSON.parse(result.rows[0].working_hours as string);
      } catch (e) {
        console.error("Error parsing working_hours JSON:", e);
        workingHours = null;
      }
    }

    return NextResponse.json({ working_hours: workingHours });
  } catch (error) {
    console.error("Error fetching working hours:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/user/working-hours - Update user's working hours
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: { working_hours: GroupScheduleHours | null } = await request.json();

    // Validate working_hours structure if provided
    if (body.working_hours !== null && body.working_hours !== undefined) {
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const scheduleHours = body.working_hours;

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

    const workingHoursJson =
      body.working_hours === null || body.working_hours === undefined
        ? null
        : JSON.stringify(body.working_hours);

    const now = new Date().toISOString();

    await db.execute(
      `UPDATE users SET working_hours = ?, updated_at = ? WHERE id = ?`,
      [workingHoursJson, now, session.user.id]
    );

    return NextResponse.json({
      working_hours: body.working_hours,
      message: "Working hours updated successfully",
    });
  } catch (error) {
    console.error("Error updating working hours:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

