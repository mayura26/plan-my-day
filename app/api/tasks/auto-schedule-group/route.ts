import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTaskUnified } from "@/lib/scheduler-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { SchedulingMode, Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";

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
    lead_reminder_sent: Boolean(row.lead_reminder_sent ?? 0),
    due_reminder_sent: Boolean(row.due_reminder_sent ?? 0),
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

const VALID_MODES: SchedulingMode[] = [
  "now",
  "today",
  "tomorrow",
  "next-week",
  "next-month",
  "asap",
];

// POST /api/tasks/auto-schedule-group - Auto-schedule top N unscheduled tasks in a group
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { groupId, mode, maxTasks = 5, timezone: clientTimezone } = body;

    if (!groupId) {
      return NextResponse.json({ error: "Missing groupId parameter" }, { status: 400 });
    }

    if (!mode || !VALID_MODES.includes(mode)) {
      return NextResponse.json(
        { error: `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}` },
        { status: 400 }
      );
    }

    const taskLimit = Math.min(Math.max(Number(maxTasks) || 5, 1), 20);

    // Get user timezone and awake hours
    const userResult = await db.execute("SELECT timezone, awake_hours FROM users WHERE id = ?", [
      session.user.id,
    ]);
    const userTimezone =
      clientTimezone ||
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
    let allTasks = allTasksResult.rows.map(mapRowToTask);

    // Fetch all user groups for displaced task group hour lookups
    const allGroupsResult = await db.execute(
      "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
      [session.user.id]
    );
    const allGroups = allGroupsResult.rows.map(mapRowToGroup);

    // Fetch the target group
    const groupResult = await db.execute("SELECT * FROM task_groups WHERE id = ? AND user_id = ?", [
      groupId,
      session.user.id,
    ]);
    if (groupResult.rows.length === 0) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    const taskGroup = mapRowToGroup(groupResult.rows[0]);

    // Build dependency map
    const dependencyMap = new Map<string, string[]>();
    const depsResult = await db.execute(
      "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ?)",
      [session.user.id]
    );
    for (const row of depsResult.rows) {
      const taskId = row.task_id as string;
      const dependsOnId = row.depends_on_task_id as string;
      if (!dependencyMap.has(taskId)) {
        dependencyMap.set(taskId, []);
      }
      const deps = dependencyMap.get(taskId);
      if (deps) {
        deps.push(dependsOnId);
      }
    }

    // Filter candidates: unscheduled tasks in this group
    const candidates = allTasks.filter(
      (t) =>
        t.group_id === groupId &&
        !t.scheduled_start &&
        (t.status === "pending" || t.status === "in_progress") &&
        t.duration &&
        t.duration > 0 &&
        !t.parent_task_id
    );

    // Sort: priority ASC (1=highest), due_date ASC (nearest first, nulls last), created_at ASC
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return a.created_at.localeCompare(b.created_at);
    });

    const selected = candidates.slice(0, taskLimit);

    if (selected.length === 0) {
      return NextResponse.json(
        {
          error: "No eligible tasks to schedule in this group",
          feedback: [
            "No unscheduled tasks found with a duration set. Tasks must be unscheduled, have a duration, and not be completed/cancelled.",
          ],
        },
        { status: 422 }
      );
    }

    // Schedule each task sequentially
    const feedback: string[] = [];
    const scheduledTasks: Task[] = [];
    const allShuffledTasks: Array<{ taskId: string; newSlot: { start: Date; end: Date } }> = [];

    feedback.push(
      `Auto-scheduling ${selected.length} task${selected.length !== 1 ? "s" : ""} from "${taskGroup.name}" (${mode})`
    );

    for (const task of selected) {
      const result = scheduleTaskUnified({
        mode: mode as SchedulingMode,
        task,
        allTasks,
        taskGroup,
        allGroups,
        awakeHours,
        timezone: userTimezone,
        dependencyMap,
      });

      if (result.slot) {
        // Update task in DB
        const now = new Date().toISOString();
        await db.execute(
          `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [
            result.slot.start.toISOString(),
            result.slot.end.toISOString(),
            now,
            task.id,
            session.user.id,
          ]
        );

        // Fetch updated task
        const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
          task.id,
          session.user.id,
        ]);
        const updatedTask = mapRowToTask(updatedResult.rows[0]);
        scheduledTasks.push(updatedTask);

        // Update allTasks so subsequent scheduling considers this task's new slot
        allTasks = allTasks.map((t) => (t.id === task.id ? updatedTask : t));

        feedback.push(`Scheduled "${task.title}"`);

        if (result.shuffledTasks) {
          for (const shuffled of result.shuffledTasks) {
            allShuffledTasks.push(shuffled);
          }
        }
      } else {
        const errorMsg = result.error || "No available time slot";
        feedback.push(`Failed to schedule "${task.title}": ${errorMsg}`);
      }

      // Include scheduling feedback
      if (result.feedback.length > 0) {
        feedback.push(...result.feedback);
      }
    }

    // Update any shuffled tasks in the DB
    const now = new Date().toISOString();
    for (const shuffled of allShuffledTasks) {
      await db.execute(
        `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        [
          shuffled.newSlot.start.toISOString(),
          shuffled.newSlot.end.toISOString(),
          now,
          shuffled.taskId,
          session.user.id,
        ]
      );
    }

    // Re-fetch all updated tasks (scheduled + shuffled)
    const allUpdatedIds = [
      ...scheduledTasks.map((t) => t.id),
      ...allShuffledTasks.map((s) => s.taskId),
    ];
    let updatedTasks: Task[] = [];
    if (allUpdatedIds.length > 0) {
      const uniqueIds = [...new Set(allUpdatedIds)];
      const placeholders = uniqueIds.map(() => "?").join(", ");
      const updatedResult = await db.execute(
        `SELECT * FROM tasks WHERE id IN (${placeholders}) AND user_id = ?`,
        [...uniqueIds, session.user.id]
      );
      updatedTasks = updatedResult.rows.map(mapRowToTask);
    }

    return NextResponse.json({
      updatedTasks,
      feedback,
      scheduledCount: scheduledTasks.length,
      totalCandidates: candidates.length,
    });
  } catch (error) {
    console.error("Error auto-scheduling group tasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
