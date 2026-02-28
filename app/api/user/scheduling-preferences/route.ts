import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { SchedulingMode } from "@/lib/types";

const VALID_MODES: SchedulingMode[] = [
  "now",
  "today",
  "tomorrow",
  "next-week",
  "next-month",
  "asap",
  "due-date",
];

// GET /api/user/scheduling-preferences - Get user's scheduling preferences for new tasks
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      "SELECT auto_schedule_new_tasks, default_schedule_mode, default_ai_group_id FROM users WHERE id = ?",
      [session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const row = result.rows[0];
    const auto_schedule_new_tasks = Boolean(row.auto_schedule_new_tasks ?? 0);
    const rawMode = row.default_schedule_mode as string | null | undefined;
    const default_schedule_mode =
      rawMode && VALID_MODES.includes(rawMode as SchedulingMode)
        ? (rawMode as SchedulingMode)
        : "now";
    const default_ai_group_id = (row.default_ai_group_id as string | null) ?? null;

    return NextResponse.json({
      auto_schedule_new_tasks,
      default_schedule_mode,
      default_ai_group_id,
    });
  } catch (error) {
    console.error("Error fetching scheduling preferences:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/user/scheduling-preferences - Update user's scheduling preferences
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: {
      auto_schedule_new_tasks?: boolean;
      default_schedule_mode?: string;
      default_ai_group_id?: string | null;
    } = await request.json();

    if (body.default_schedule_mode !== undefined) {
      if (
        typeof body.default_schedule_mode !== "string" ||
        !VALID_MODES.includes(body.default_schedule_mode as SchedulingMode)
      ) {
        return NextResponse.json(
          {
            error: `default_schedule_mode must be one of: ${VALID_MODES.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const updates: string[] = [];
    const args: (string | number)[] = [];

    if (body.auto_schedule_new_tasks !== undefined) {
      updates.push("auto_schedule_new_tasks = ?");
      args.push(body.auto_schedule_new_tasks ? 1 : 0);
    }
    if (body.default_schedule_mode !== undefined) {
      updates.push("default_schedule_mode = ?");
      args.push(body.default_schedule_mode);
    }

    if (body.default_ai_group_id !== undefined) {
      if (body.default_ai_group_id === null) {
        updates.push("default_ai_group_id = NULL");
      } else {
        // Verify the group exists and belongs to this user
        const groupCheck = await db.execute(
          "SELECT id FROM task_groups WHERE id = ? AND user_id = ?",
          [body.default_ai_group_id, session.user.id]
        );
        if (groupCheck.rows.length === 0) {
          return NextResponse.json({ error: "Group not found" }, { status: 400 });
        }
        updates.push("default_ai_group_id = ?");
        args.push(body.default_ai_group_id);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: auto_schedule_new_tasks, default_schedule_mode, default_ai_group_id",
        },
        { status: 400 }
      );
    }

    updates.push('updated_at = datetime("now")');
    args.push(session.user.id);

    await db.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, args);

    const getResult = await db.execute(
      "SELECT auto_schedule_new_tasks, default_schedule_mode, default_ai_group_id FROM users WHERE id = ?",
      [session.user.id]
    );
    const row = getResult.rows[0];
    const auto_schedule_new_tasks = Boolean(row?.auto_schedule_new_tasks ?? 0);
    const rawMode = row?.default_schedule_mode as string | null | undefined;
    const default_schedule_mode =
      rawMode && VALID_MODES.includes(rawMode as SchedulingMode)
        ? (rawMode as SchedulingMode)
        : "now";
    const default_ai_group_id = (row?.default_ai_group_id as string | null) ?? null;

    return NextResponse.json({
      auto_schedule_new_tasks,
      default_schedule_mode,
      default_ai_group_id,
    });
  } catch (error) {
    console.error("Error updating scheduling preferences:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
