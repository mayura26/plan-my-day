import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateDependencyId, generateTaskId, validateTaskData } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { CreateTaskRequest, Task } from "@/lib/types";

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
    depends_on_task_id: row.depends_on_task_id as string | null,
    energy_level_required: row.energy_level_required as number,
    parent_task_id: row.parent_task_id as string | null,
    continued_from_task_id: row.continued_from_task_id as string | null,
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

    if (group_id) {
      query += ` AND group_id = ?`;
      params.push(group_id);
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

    const result = await db.execute(query, params);
    const tasks = result.rows.map(mapRowToTask);

    // Get subtask counts for all tasks (for filtering purposes)
    const tasksWithSubtaskCounts = await Promise.all(
      tasks.map(async (task) => {
        // Only check subtask count for parent tasks (tasks without parent_task_id)
        if (task.parent_task_id) {
          return { ...task, subtask_count: 0 };
        }

        const subtaskCountResult = await db.execute(
          `SELECT COUNT(*) as count FROM tasks WHERE parent_task_id = ?`,
          [task.id]
        );
        const subtaskCount = subtaskCountResult.rows[0]?.count || 0;

        // Optionally include full subtask details
        if (include_subtasks === "true") {
          const subtasksResult = await db.execute(
            `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY priority ASC, created_at ASC`,
            [task.id]
          );
          return {
            ...task,
            subtasks: subtasksResult.rows.map(mapRowToTask),
            subtask_count: Number(subtaskCount),
            completed_subtask_count: subtasksResult.rows.filter(
              (r) => r.status === "completed"
            ).length,
          };
        }

        return { ...task, subtask_count: Number(subtaskCount) };
      })
    );

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

    // Validate parent task if creating a subtask
    let parentTaskData: any = null;
    if (body.parent_task_id) {
      const parentResult = await db.execute(
        `SELECT * FROM tasks WHERE id = ? AND user_id = ?`,
        [body.parent_task_id, session.user.id]
      );
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
    const dueDate = body.due_date || (body.parent_task_id ? parentTaskData?.due_date : null) || null;

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
      locked: false,
      group_id: groupId,
      template_id: body.template_id || null,
      task_type: taskType,
      google_calendar_event_id: null,
      notification_sent: false,
      depends_on_task_id: body.depends_on_task_id || null,
      energy_level_required: energyLevel,
      parent_task_id: body.parent_task_id || null,
      continued_from_task_id: null,
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
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        task.created_at,
        task.updated_at,
      ]
    );

    // Handle multiple dependencies if provided
    if (body.dependency_ids && body.dependency_ids.length > 0) {
      for (const depId of body.dependency_ids) {
        // Verify the dependency task exists
        const depResult = await db.execute(
          `SELECT id FROM tasks WHERE id = ? AND user_id = ?`,
          [depId, session.user.id]
        );
        if (depResult.rows.length > 0) {
          await db.execute(
            `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
            [generateDependencyId(), task.id, depId]
          );
        }
      }
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
