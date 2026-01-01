import { type NextRequest, NextResponse } from "next/server";
import { validateAPIKey } from "@/lib/api-auth";
import { generateGroupId, generateTaskId } from "@/lib/task-utils";
import { createDateInTimezone, getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { Task, TaskType } from "@/lib/types";

// Helper to normalize task type (case-insensitive)
function normalizeTaskType(type: string): TaskType | null {
  const normalized = type.toLowerCase().trim();
  if (normalized === "task") return "task";
  if (normalized === "event") return "event";
  if (normalized === "todo") return "todo";
  return null;
}

// Parse due date with flexible formats and default to 5pm if no time
function parseDueDate(dateStr: string | null | undefined, timezone: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  const trimmed = dateStr.trim();

  try {
    // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:mm)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const hours = isoMatch[5] ? parseInt(isoMatch[5], 10) : 17; // Default to 5pm
      const minutes = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;

      const date = new Date(year, month, day);
      const utcDate = createDateInTimezone(date, hours, minutes, timezone);
      return utcDate.toISOString();
    }

    // Try MM/DD/YYYY format
    const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
      const month = parseInt(usMatch[1], 10) - 1;
      const day = parseInt(usMatch[2], 10);
      const year = parseInt(usMatch[3], 10);

      const date = new Date(year, month, day);
      const utcDate = createDateInTimezone(date, 17, 0, timezone); // Default to 5pm
      return utcDate.toISOString();
    }

    // Try YYYY/MM/DD format
    const isoSlashMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (isoSlashMatch) {
      const year = parseInt(isoSlashMatch[1], 10);
      const month = parseInt(isoSlashMatch[2], 10) - 1;
      const day = parseInt(isoSlashMatch[3], 10);

      const date = new Date(year, month, day);
      const utcDate = createDateInTimezone(date, 17, 0, timezone); // Default to 5pm
      return utcDate.toISOString();
    }

    // Try to parse as general date
    const parsedDate = new Date(trimmed);
    if (!Number.isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear();
      const month = parsedDate.getMonth();
      const day = parsedDate.getDate();
      const utcDate = createDateInTimezone(new Date(year, month, day), 17, 0, timezone); // Default to 5pm
      return utcDate.toISOString();
    }

    return null;
  } catch (error) {
    console.error("Error parsing date:", error);
    return null;
  }
}

interface ImportTaskRequest {
  title: string;
  task_type?: string;
  group?: string;
  description?: string;
  duration?: number;
  due_date?: string;
  priority?: number;
  energy_level_required?: number;
}

interface TaskImportResult {
  task?: Task;
  error?: string;
  taskData?: ImportTaskRequest;
  parsedDueDate?: string | null;
}

/**
 * POST /api/tasks/import
 * Import one or more tasks via API key authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const userId = await validateAPIKey(request);
    if (!userId) {
      return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
    }

    // Get user's timezone
    const userResult = await db.execute("SELECT timezone FROM users WHERE id = ?", [userId]);
    const userTimezone =
      userResult.rows.length > 0
        ? getUserTimezone(userResult.rows[0].timezone as string | null)
        : "UTC";

    const body = await request.json();

    // Handle single task or batch
    // Batch format: { tasks: [...] }
    // Single format: { title, task_type, ... }
    const isBatch = body.tasks && Array.isArray(body.tasks);
    const tasksToProcess: ImportTaskRequest[] = isBatch ? body.tasks : [body];

    if (tasksToProcess.length === 0) {
      return NextResponse.json({ error: "No tasks provided" }, { status: 400 });
    }

    // Get user's groups for lookup
    const groupsResult = await db.execute("SELECT id, name FROM task_groups WHERE user_id = ?", [
      userId,
    ]);
    const groupMap = new Map<string, string>();
    groupsResult.rows.forEach((row) => {
      groupMap.set(row.name as string, row.id as string);
    });

    const results: TaskImportResult[] = [];
    const groupsToCreate = new Set<string>();

    // Validate and prepare tasks
    for (const taskData of tasksToProcess) {
      const errors: string[] = [];

      // Validate required fields
      if (!taskData.title || !taskData.title.trim()) {
        errors.push("Title is required");
      }

      const taskType = normalizeTaskType(taskData.task_type || "task");
      if (!taskType) {
        errors.push("task_type must be 'task', 'event', or 'todo'");
      }

      // Validate priority if provided
      if (taskData.priority !== undefined && (taskData.priority < 1 || taskData.priority > 5)) {
        errors.push("Priority must be between 1 and 5");
      }

      // Validate energy if provided
      if (
        taskData.energy_level_required !== undefined &&
        (taskData.energy_level_required < 1 || taskData.energy_level_required > 5)
      ) {
        errors.push("Energy level must be between 1 and 5");
      }

      // Parse due date
      let parsedDueDate: string | null = null;
      if (taskData.due_date) {
        const parsed = parseDueDate(taskData.due_date, userTimezone);
        if (!parsed) {
          errors.push("Invalid due_date format");
        } else {
          parsedDueDate = parsed;
        }
      }

      // Track groups that need to be created
      if (taskData.group && !groupMap.has(taskData.group)) {
        groupsToCreate.add(taskData.group);
      }

      if (errors.length > 0) {
        results.push({
          error: errors.join(", "),
          taskData,
        });
      } else {
        results.push({
          taskData: {
            ...taskData,
            task_type: taskType || "task",
          },
          parsedDueDate,
        });
      }
    }

    // Create missing groups
    for (const groupName of groupsToCreate) {
      try {
        const groupId = generateGroupId();
        await db.execute(
          `INSERT INTO task_groups (id, user_id, name, color, collapsed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [groupId, userId, groupName, "#3B82F6", false]
        );
        groupMap.set(groupName, groupId);
      } catch (error) {
        console.error(`Failed to create group "${groupName}":`, error);
      }
    }

    // Process tasks
    const created: Task[] = [];
    const failed: Array<{ task: ImportTaskRequest; error: string }> = [];

    for (const result of results) {
      if (result.error || !result.taskData) {
        failed.push({
          task: result.taskData || ({} as ImportTaskRequest),
          error: result.error || "Validation failed",
        });
        continue;
      }

      const taskData = result.taskData;
      try {
        const taskId = generateTaskId();
        const now = new Date().toISOString();
        const priority = taskData.priority || 3;
        const energyLevel = taskData.energy_level_required || 3;
        const groupId = taskData.group && groupMap.has(taskData.group)
          ? (groupMap.get(taskData.group) ?? null)
          : null;

        // Default duration to 30 minutes for tasks and todos (not events)
        const defaultDuration = taskData.task_type === "event" ? null : 30;
        const duration = taskData.duration !== undefined ? taskData.duration : defaultDuration;

        const task: Task = {
          id: taskId,
          user_id: userId,
          title: taskData.title,
          description: taskData.description || null,
          priority,
          status: "pending",
          duration,
          scheduled_start: null,
          scheduled_end: null,
          due_date: result.parsedDueDate || null,
          locked: false,
          group_id: groupId,
          template_id: null,
          task_type: (taskData.task_type || "task") as TaskType,
          google_calendar_event_id: null,
          notification_sent: false,
          depends_on_task_id: null,
          energy_level_required: energyLevel,
          parent_task_id: null,
          continued_from_task_id: null,
          created_at: now,
          updated_at: now,
        };

        await db.execute(
          `INSERT INTO tasks (
            id, user_id, title, description, priority, status, duration,
            scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
            task_type, google_calendar_event_id, notification_sent,
            depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

        created.push(task);
      } catch (error) {
        console.error("Error creating task:", error);
        failed.push({
          task: taskData,
          error: error instanceof Error ? error.message : "Failed to create task",
        });
      }
    }

    // Return response
    if (isBatch) {
      return NextResponse.json({
        success: true,
        created,
        failed,
      });
    } else {
      // Single task response
      if (created.length > 0) {
        return NextResponse.json({
          success: true,
          task: created[0],
        });
      } else {
        return NextResponse.json(
          {
            success: false,
            error: failed[0]?.error || "Failed to create task",
          },
          { status: 400 }
        );
      }
    }
  } catch (error) {
    console.error("Error in task import API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
