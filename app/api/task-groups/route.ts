import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateGroupId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { CreateTaskGroupRequest, TaskGroup } from "@/lib/types";

// GET /api/task-groups - Get all task groups for the authenticated user
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
      [session.user.id]
    );

    const groups: TaskGroup[] = result.rows.map((row) => {
      let autoScheduleHours = null;
      if (row.auto_schedule_hours) {
        try {
          autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
        } catch (e) {
          console.error("Error parsing auto_schedule_hours JSON:", e);
          autoScheduleHours = null;
        }
      }
      return {
        id: row.id as string,
        user_id: row.user_id as string,
        name: row.name as string,
        color: row.color as string,
        collapsed: Boolean(row.collapsed),
        parent_group_id: (row.parent_group_id as string) || null,
        is_parent_group: Boolean(row.is_parent_group),
        auto_schedule_enabled: Boolean(row.auto_schedule_enabled ?? false),
        auto_schedule_hours: autoScheduleHours,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      };
    });

    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Error fetching task groups:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/task-groups - Create a new task group
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: CreateTaskGroupRequest = await request.json();

    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Group name is required" }, { status: 400 });
    }

    // Validate that auto-schedule settings can only be set for non-parent groups
    if (
      (body.auto_schedule_enabled !== undefined || body.auto_schedule_hours !== undefined) &&
      body.is_parent_group
    ) {
      return NextResponse.json(
        { error: "Auto-schedule settings cannot be set for parent groups" },
        { status: 400 }
      );
    }

    // Validate parent_group_id if provided
    if (body.parent_group_id) {
      const parentGroup = await db.execute(
        "SELECT id FROM task_groups WHERE id = ? AND user_id = ?",
        [body.parent_group_id, session.user.id]
      );

      if (parentGroup.rows.length === 0) {
        return NextResponse.json(
          { error: "Parent group not found or does not belong to user" },
          { status: 400 }
        );
      }
    }

    // Validate auto_schedule_hours structure if provided
    if (body.auto_schedule_hours !== undefined && body.auto_schedule_hours !== null) {
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      const scheduleHours = body.auto_schedule_hours;

      for (const day of validDays) {
        const daySchedule = scheduleHours[day as keyof typeof scheduleHours];
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

    // Verify user exists in database, create if missing (handles edge cases)
    // Use INSERT OR IGNORE to avoid UNIQUE constraint errors if user exists by email
    const userCheck = await db.execute("SELECT id FROM users WHERE id = ?", [session.user.id]);

    if (userCheck.rows.length === 0) {
      // User doesn't exist by ID, try to create them
      // Use INSERT OR IGNORE to handle case where user exists by email but not by ID
      await db.execute(
        `
        INSERT OR IGNORE INTO users (id, name, email, image, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
        [
          session.user.id,
          session.user.name || null,
          session.user.email || null,
          session.user.image || null,
        ]
      );

      // Verify user was created (or already existed)
      const finalCheck = await db.execute("SELECT id FROM users WHERE id = ?", [session.user.id]);

      if (finalCheck.rows.length === 0) {
        // User still doesn't exist - this means they exist by email with different ID
        // This is a data inconsistency that requires user to re-authenticate
        return NextResponse.json(
          {
            error: "Account data inconsistency detected. Please sign out and sign in again.",
          },
          { status: 400 }
        );
      }
    }

    const groupId = generateGroupId();
    const now = new Date().toISOString();

    const autoScheduleEnabled = body.auto_schedule_enabled ?? false;
    const autoScheduleHoursJson =
      body.auto_schedule_hours === null || body.auto_schedule_hours === undefined
        ? null
        : JSON.stringify(body.auto_schedule_hours);

    const group: TaskGroup = {
      id: groupId,
      user_id: session.user.id,
      name: body.name.trim(),
      color: body.color || "#3B82F6",
      collapsed: false,
      parent_group_id: body.parent_group_id || null,
      is_parent_group: body.is_parent_group || false,
      auto_schedule_enabled: autoScheduleEnabled,
      auto_schedule_hours: body.auto_schedule_hours ?? null,
      created_at: now,
      updated_at: now,
    };

    await db.execute(
      `
      INSERT INTO task_groups (id, user_id, name, color, collapsed, parent_group_id, is_parent_group, auto_schedule_enabled, auto_schedule_hours, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        group.id,
        group.user_id,
        group.name,
        group.color,
        group.collapsed,
        group.parent_group_id ?? null,
        group.is_parent_group ?? false,
        autoScheduleEnabled,
        autoScheduleHoursJson,
        group.created_at,
        group.updated_at,
      ]
    );

    return NextResponse.json({ group }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating task group:", error);

    // Provide more specific error messages
    if (error?.code === "SQLITE_CONSTRAINT" || error?.cause?.code === "SQLITE_CONSTRAINT") {
      if (error.message?.includes("FOREIGN KEY")) {
        return NextResponse.json(
          {
            error: "User not found in database. Please sign out and sign in again.",
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
