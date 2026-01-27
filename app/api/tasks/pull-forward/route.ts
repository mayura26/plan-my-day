import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pullForwardTasksForGroup } from "@/lib/scheduler-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";

function mapRowToTask(row: any): Task {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: row.description as string | null,
    priority: row.priority as number,
    status: row.status as TaskStatus,
    duration: row.duration as number | null,
    scheduled_start: row.scheduled_start as string | null,
    scheduled_end: row.scheduled_end as string | null,
    due_date: row.due_date as string | null,
    locked: Boolean(row.locked),
    group_id: row.group_id as string | null,
    template_id: row.template_id as string | null,
    task_type: row.task_type as TaskType,
    google_calendar_event_id: row.google_calendar_event_id as string | null,
    notification_sent: Boolean(row.notification_sent),
    depends_on_task_id: row.depends_on_task_id as string | null,
    energy_level_required: row.energy_level_required as number,
    parent_task_id: row.parent_task_id as string | null,
    continued_from_task_id: row.continued_from_task_id as string | null,
    step_order:
      row.step_order !== null && row.step_order !== undefined ? Number(row.step_order) : null,
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapRowToGroup(row: any): TaskGroup {
  let autoScheduleHours = null;
  if (row.auto_schedule_hours) {
    try {
      autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
    } catch (e) {
      console.error("Error parsing auto_schedule_hours JSON:", e);
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
    priority: row.priority ? (row.priority as number) : undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// POST /api/tasks/pull-forward - Pull future tasks from a group into today
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { date, groupId, timezone: clientTimezone } = body;

    if (!date || !groupId) {
      return NextResponse.json({ error: "Missing date or groupId parameter" }, { status: 400 });
    }

    // Get user timezone and awake hours
    const userResult = await db.execute("SELECT timezone, awake_hours FROM users WHERE id = ?", [
      session.user.id,
    ]);
    const userTimezone = clientTimezone ||
      (userResult.rows.length > 0
        ? getUserTimezone(userResult.rows[0].timezone as string | null)
        : "UTC");

    let awakeHours = null;
    if (userResult.rows.length > 0 && userResult.rows[0].awake_hours) {
      try {
        awakeHours = JSON.parse(userResult.rows[0].awake_hours as string);
      } catch (e) {
        console.error("Error parsing awake_hours JSON:", e);
      }
    }

    // Fetch all user tasks
    const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
      session.user.id,
    ]);
    const allTasks = allTasksResult.rows.map(mapRowToTask);

    // Fetch all user task groups
    const allGroupsResult = await db.execute(
      "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
      [session.user.id],
    );
    const allGroups = allGroupsResult.rows.map(mapRowToGroup);

    // Run the pull-forward algorithm
    const result = pullForwardTasksForGroup({
      targetDate: date,
      groupId,
      allTasks,
      allGroups,
      awakeHours,
      timezone: userTimezone,
    });

    if (result.error) {
      return NextResponse.json(
        { error: result.error, feedback: result.feedback },
        { status: 422 },
      );
    }

    // Update all moved tasks in the database
    const now = new Date().toISOString();
    for (const moved of result.movedTasks) {
      await db.execute(
        `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        [moved.newStart, moved.newEnd, now, moved.taskId, session.user.id],
      );
    }

    // Re-fetch updated tasks to return fresh data
    const updatedTaskIds = result.movedTasks.map((m) => m.taskId);
    let updatedTasks: Task[] = [];
    if (updatedTaskIds.length > 0) {
      const placeholders = updatedTaskIds.map(() => "?").join(", ");
      const updatedResult = await db.execute(
        `SELECT * FROM tasks WHERE id IN (${placeholders}) AND user_id = ?`,
        [...updatedTaskIds, session.user.id],
      );
      updatedTasks = updatedResult.rows.map(mapRowToTask);
    }

    return NextResponse.json({
      updatedTasks,
      feedback: result.feedback,
      movedCount: result.movedTasks.length,
    });
  } catch (error) {
    console.error("Error pulling forward tasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
