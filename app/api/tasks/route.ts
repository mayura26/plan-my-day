import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTaskUnified } from "@/lib/scheduler-utils";
import { generateDependencyId, generateTaskId, validateTaskData } from "@/lib/task-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { CreateTaskRequest, Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";

// Helper to map database row to Task object
function mapRowToTask(row: any): Task {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: row.description as string | null,
    priority: row.priority as number,
    status: row.status as Task["status"],
    duration: row.duration as number | null,
    scheduled_start: row.scheduled_start as string | null,
    scheduled_end: row.scheduled_end as string | null,
    due_date: row.due_date as string | null,
    locked: Boolean(row.locked),
    group_id: row.group_id as string | null,
    template_id: row.template_id as string | null,
    task_type: row.task_type as Task["task_type"],
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

// GET /api/tasks - Get all tasks for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const task_type = searchParams.get("task_type");
    const group_id = searchParams.get("group_id");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const parent_only = searchParams.get("parent_only"); // Exclude subtasks
    const include_subtasks = searchParams.get("include_subtasks"); // Include subtasks in response

    let query = `
      SELECT * FROM tasks 
      WHERE user_id = ?
    `;
    const params: any[] = [session.user.id];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND priority = ?`;
      params.push(parseInt(priority, 10));
    }

    if (task_type) {
      query += ` AND task_type = ?`;
      params.push(task_type);
    }

    if (group_id !== null && group_id !== undefined) {
      if (group_id === "") {
        // Empty string means filter for tasks with no group
        query += ` AND group_id IS NULL`;
      } else {
        query += ` AND group_id = ?`;
        params.push(group_id);
      }
    }

    // Filter to only show parent/standalone tasks (no subtasks)
    if (parent_only === "true") {
      query += ` AND parent_task_id IS NULL`;
    }

    query += ` ORDER BY priority ASC, scheduled_start ASC, created_at DESC`;

    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
    }

    if (offset) {
      query += ` OFFSET ?`;
      params.push(parseInt(offset, 10));
    }

    // Auto-complete events where scheduled_end has passed
    // Events should never be overdue - they auto-complete when time is up
    // Do this before fetching tasks so we get the correct status
    //
    // Timezone handling:
    // - scheduled_end is stored as UTC ISO string (e.g., "2024-01-15T10:30:00.000Z")
    // - When user schedules "5pm PST", it's converted to UTC and stored as ISO string
    // - We compare scheduled_end (UTC ISO string) against current UTC time (also ISO string)
    // - SQLite stores DATETIME as TEXT, and ISO 8601 format is lexicographically sortable
    // - So string comparison (<) works correctly: "2024-01-15T10:30:00.000Z" < "2024-01-15T11:30:00.000Z"
    // - No timezone conversion needed - both values are already in UTC ISO format
    const nowUTC = new Date();
    const nowISO = nowUTC.toISOString();

    await db.execute(
      `UPDATE tasks 
       SET status = 'completed', updated_at = ? 
       WHERE user_id = ? 
       AND task_type = 'event' 
       AND status NOT IN ('completed', 'cancelled')
       AND scheduled_end IS NOT NULL 
       AND scheduled_end < ?`,
      [nowISO, session.user.id, nowISO]
    );

    const result = await db.execute(query, params);
    const tasks = result.rows.map(mapRowToTask);

    // Get parent task IDs (tasks without parent_task_id)
    const parentTaskIds = tasks.filter((task) => !task.parent_task_id).map((task) => task.id);

    // Optimize: Fetch all subtask counts in a single query using aggregation
    const subtaskCountsMap = new Map<string, number>();
    if (parentTaskIds.length > 0) {
      const placeholders = parentTaskIds.map(() => "?").join(",");
      const subtaskCountsResult = await db.execute(
        `SELECT parent_task_id, COUNT(*) as count 
         FROM tasks 
         WHERE parent_task_id IN (${placeholders}) 
         GROUP BY parent_task_id`,
        parentTaskIds
      );

      for (const row of subtaskCountsResult.rows) {
        subtaskCountsMap.set(row.parent_task_id as string, Number(row.count));
      }
    }

    // Optionally include full subtask details - fetch all in a single batch query
    const subtasksMap = new Map<string, Task[]>();
    if (include_subtasks === "true" && parentTaskIds.length > 0) {
      const placeholders = parentTaskIds.map(() => "?").join(",");
      const allSubtasksResult = await db.execute(
        `SELECT * FROM tasks 
         WHERE parent_task_id IN (${placeholders}) 
         ORDER BY parent_task_id, step_order ASC, created_at ASC`,
        parentTaskIds
      );

      const allSubtasks = allSubtasksResult.rows.map(mapRowToTask);

      // Group subtasks by parent_task_id
      for (const subtask of allSubtasks) {
        if (subtask.parent_task_id) {
          const existing = subtasksMap.get(subtask.parent_task_id) || [];
          existing.push(subtask);
          subtasksMap.set(subtask.parent_task_id, existing);
        }
      }
    }

    // Build the final tasks array with subtask counts and optionally subtasks
    const tasksWithSubtaskCounts = tasks.map((task) => {
      // Only add subtask_count for parent tasks (tasks without parent_task_id)
      if (task.parent_task_id) {
        return { ...task, subtask_count: 0 };
      }

      const subtaskCount = subtaskCountsMap.get(task.id) || 0;

      if (include_subtasks === "true") {
        const subtasks = subtasksMap.get(task.id) || [];
        return {
          ...task,
          subtasks,
          subtask_count: subtaskCount,
          completed_subtask_count: subtasks.filter((st) => st.status === "completed").length,
        };
      }

      return { ...task, subtask_count: subtaskCount };
    });

    return NextResponse.json({ tasks: tasksWithSubtaskCounts });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: CreateTaskRequest = await request.json();

    // Validate task data
    const errors = validateTaskData(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    // Validate group_id - ensure it's not a parent group
    if (body.group_id) {
      const groupResult = await db.execute(
        `SELECT is_parent_group FROM task_groups WHERE id = ? AND user_id = ?`,
        [body.group_id, session.user.id]
      );
      if (groupResult.rows.length === 0) {
        return NextResponse.json({ error: "Task group not found" }, { status: 404 });
      }
      const isParentGroup = Boolean(groupResult.rows[0].is_parent_group);
      if (isParentGroup) {
        return NextResponse.json(
          { error: "Cannot assign tasks to parent groups. Please select a regular group." },
          { status: 400 }
        );
      }
    }

    // Validate parent task if creating a subtask
    let parentTaskData: any = null;
    if (body.parent_task_id) {
      const parentResult = await db.execute(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`, [
        body.parent_task_id,
        session.user.id,
      ]);
      if (parentResult.rows.length === 0) {
        return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
      }
      // Ensure parent is not itself a subtask (only one level deep)
      parentTaskData = parentResult.rows[0];
      if (parentTaskData.parent_task_id) {
        return NextResponse.json(
          { error: "Cannot create subtasks of subtasks (only one level allowed)" },
          { status: 400 }
        );
      }
    }

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    // Determine task type - if parent_task_id is set, it's a subtask
    const taskType = body.parent_task_id ? "subtask" : body.task_type || "task";

    // Subtasks inherit parent's properties if not provided
    const groupId = body.parent_task_id
      ? (parentTaskData?.group_id as string | null)
      : body.group_id || null;
    const priority = body.priority || (body.parent_task_id ? parentTaskData?.priority : 3) || 3;
    const energyLevel =
      body.energy_level_required ||
      (body.parent_task_id ? parentTaskData?.energy_level_required : 3) ||
      3;
    const dueDate =
      body.due_date || (body.parent_task_id ? parentTaskData?.due_date : null) || null;

    // Default duration to 30 minutes for tasks, todos, and subtasks (not events)
    const defaultDuration = taskType === "event" ? null : 30;
    const duration = body.duration !== undefined ? body.duration : defaultDuration;

    const task: Task = {
      id: taskId,
      user_id: session.user.id,
      title: body.title,
      description: body.description || null,
      priority,
      status: "pending",
      duration,
      scheduled_start: body.scheduled_start || null,
      scheduled_end: body.scheduled_end || null,
      due_date: dueDate,
      locked: body.locked !== undefined ? Boolean(body.locked) : taskType === "event",
      group_id: groupId,
      template_id: body.template_id || null,
      task_type: taskType,
      google_calendar_event_id: null,
      notification_sent: false,
      lead_reminder_sent: false,
      due_reminder_sent: false,
      depends_on_task_id: body.depends_on_task_id || null,
      energy_level_required: energyLevel,
      parent_task_id: body.parent_task_id || null,
      continued_from_task_id: null,
      ignored: false,
      created_at: now,
      updated_at: now,
    };

    await db.execute(
      `
      INSERT INTO tasks (
        id, user_id, title, description, priority, status, duration,
        scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
        task_type, google_calendar_event_id, notification_sent,
        depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
        ignored, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        task.id,
        task.user_id,
        task.title,
        task.description || null,
        task.priority,
        task.status,
        task.duration || null,
        task.scheduled_start || null,
        task.scheduled_end || null,
        task.due_date || null,
        task.locked,
        task.group_id || null,
        task.template_id || null,
        task.task_type,
        task.google_calendar_event_id || null,
        task.notification_sent,
        task.depends_on_task_id || null,
        task.energy_level_required,
        task.parent_task_id || null,
        task.continued_from_task_id || null,
        task.ignored,
        task.created_at,
        task.updated_at,
      ]
    );

    // Handle multiple dependencies if provided
    if (body.dependency_ids && body.dependency_ids.length > 0) {
      for (const depId of body.dependency_ids) {
        // Verify the dependency task exists
        const depResult = await db.execute(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`, [
          depId,
          session.user.id,
        ]);
        if (depResult.rows.length > 0) {
          await db.execute(
            `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
            [generateDependencyId(), task.id, depId]
          );
        }
      }
    }

    // Handle auto-schedule if enabled
    if (
      body.auto_schedule &&
      (task.task_type === "task" || task.task_type === "todo") &&
      task.duration &&
      task.duration > 0 &&
      !task.scheduled_start &&
      !task.scheduled_end
    ) {
      try {
        // Get user's timezone and awake hours
        const userResult = await db.execute(
          "SELECT timezone, awake_hours FROM users WHERE id = ?",
          [session.user.id]
        );
        const userTimezone =
          userResult.rows.length > 0
            ? getUserTimezone(userResult.rows[0].timezone as string | null)
            : "UTC";

        let awakeHours = null;
        if (userResult.rows.length > 0 && userResult.rows[0].awake_hours) {
          try {
            awakeHours = JSON.parse(userResult.rows[0].awake_hours as string);
          } catch (e) {
            console.error("Error parsing awake_hours JSON:", e);
            awakeHours = null;
          }
        }

        // Get task's group if it has one
        let taskGroup: TaskGroup | null = null;
        if (task.group_id) {
          const groupResult = await db.execute(
            "SELECT * FROM task_groups WHERE id = ? AND user_id = ?",
            [task.group_id, session.user.id]
          );
          if (groupResult.rows.length > 0) {
            const row = groupResult.rows[0];
            let autoScheduleHours = null;
            if (row.auto_schedule_hours) {
              try {
                autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
              } catch (e) {
                console.error("Error parsing auto_schedule_hours JSON:", e);
              }
            }
            taskGroup = {
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
        }

        // Get all tasks for the user to check for conflicts (including the newly created task)
        const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
          session.user.id,
        ]);
        const allTasks = allTasksResult.rows.map((row: any) => {
          // Map row to Task format
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
            ignored: Boolean(row.ignored ?? false),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string,
          } as Task;
        });

        // Fetch all user groups for displaced task group hour lookups
        const allGroupsResult = await db.execute(
          "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
          [session.user.id]
        );
        const allGroups = allGroupsResult.rows.map(mapRowToGroup);

        // Use unified scheduler with the selected mode (default to "now" if not specified)
        const scheduleMode = body.schedule_mode || "now";
        const result = scheduleTaskUnified({
          mode: scheduleMode,
          task,
          allTasks,
          taskGroup,
          allGroups,
          awakeHours,
          timezone: userTimezone,
        });

        if (result.slot) {
          // Update task with the scheduled times
          const updatedAt = new Date().toISOString();
          await db.execute(
            `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [
              result.slot.start.toISOString(),
              result.slot.end.toISOString(),
              updatedAt,
              task.id,
              session.user.id,
            ]
          );

          task.scheduled_start = result.slot.start.toISOString();
          task.scheduled_end = result.slot.end.toISOString();
          task.updated_at = updatedAt;
        }
      } catch (error) {
        console.error("Error auto-scheduling task:", error);
        // Continue with task creation even if auto-schedule fails
      }
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
