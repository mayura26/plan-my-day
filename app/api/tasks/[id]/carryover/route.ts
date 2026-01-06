import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTask } from "@/lib/scheduler-utils";
import { generateTaskId } from "@/lib/task-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { CreateCarryoverTaskRequest, Task, TaskStatus, TaskType } from "@/lib/types";

// Helper to map database row to Task object
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
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// Helper function to calculate parent duration expansion needs
function calculateParentDurationExpansion(
  parentDuration: number | null,
  existingSubtasks: Task[],
  carryoverDuration: number
): {
  needsExpansion: boolean;
  currentTotal: number;
  requiredTotal: number;
  expansionAmount: number;
} {
  const currentTotal = existingSubtasks.reduce(
    (sum, subtask) => sum + (subtask.duration || 0),
    0
  );
  const requiredTotal = currentTotal + carryoverDuration;

  if (parentDuration === null || parentDuration === undefined) {
    // No parent duration set, so no expansion needed
    return {
      needsExpansion: false,
      currentTotal,
      requiredTotal,
      expansionAmount: 0,
    };
  }

  const needsExpansion = requiredTotal > parentDuration;
  const expansionAmount = needsExpansion ? requiredTotal - parentDuration : 0;

  return {
    needsExpansion,
    currentTotal,
    requiredTotal,
    expansionAmount,
  };
}

// Helper function to calculate created_at timestamp for proper sequencing
// Positions the carryover subtask immediately after the original subtask
function calculateCarryoverTimestamp(
  originalSubtask: Task,
  allSubtasks: Task[]
): string {
  // Sort subtasks by priority ASC, created_at ASC (same as query order)
  const sortedSubtasks = [...allSubtasks].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Find the index of the original subtask
  const originalIndex = sortedSubtasks.findIndex((st) => st.id === originalSubtask.id);

  if (originalIndex === -1) {
    // Original not found, use current time
    return new Date().toISOString();
  }

  // If original is the last subtask, use current time
  if (originalIndex === sortedSubtasks.length - 1) {
    return new Date().toISOString();
  }

  // Get the next subtask after the original
  const nextSubtask = sortedSubtasks[originalIndex + 1];

  // Calculate midpoint between original and next subtask
  const originalTime = new Date(originalSubtask.created_at).getTime();
  const nextTime = new Date(nextSubtask.created_at).getTime();

  // If they're the same time (unlikely but possible), add 1ms after original
  if (nextTime <= originalTime) {
    return new Date(originalTime + 1).toISOString();
  }

  // Use midpoint, but ensure it's at least 1ms after original
  const midpoint = Math.floor((originalTime + nextTime) / 2);
  const resultTime = Math.max(midpoint, originalTime + 1);

  return new Date(resultTime).toISOString();
}

// POST /api/tasks/[id]/carryover - Create a carryover task from an incomplete task
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: originalTaskId } = await params;
    const body: CreateCarryoverTaskRequest = await request.json();

    // Validate request
    if (!body.additional_duration || body.additional_duration <= 0) {
      return NextResponse.json(
        { error: "additional_duration is required and must be positive" },
        { status: 400 }
      );
    }

    // Verify original task exists and belongs to user
    const originalResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      originalTaskId,
      session.user.id,
    ]);

    if (originalResult.rows.length === 0) {
      return NextResponse.json({ error: "Original task not found" }, { status: 404 });
    }

    const originalTask = mapRowToTask(originalResult.rows[0]);

    // Task must not be completed to create a carryover
    if (originalTask.status === "completed") {
      return NextResponse.json(
        { error: "Cannot create carryover for a completed task" },
        { status: 400 }
      );
    }

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    // Handle subtask carryover
    if (originalTask.task_type === "subtask") {
      if (!originalTask.parent_task_id) {
        return NextResponse.json(
          { error: "Subtask missing parent task reference" },
          { status: 400 }
        );
      }

      // Fetch parent task
      const parentResult = await db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
        [originalTask.parent_task_id, session.user.id]
      );

      if (parentResult.rows.length === 0) {
        return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
      }

      const parentTask = mapRowToTask(parentResult.rows[0]);

      // Get all existing subtasks for the parent (excluding the original one for calculation)
      const existingSubtasksResult = await db.execute(
        `SELECT * FROM tasks WHERE parent_task_id = ? AND user_id = ? AND id != ?`,
        [originalTask.parent_task_id, session.user.id, originalTaskId]
      );
      const existingSubtasks = existingSubtasksResult.rows.map(mapRowToTask);

      // Calculate if parent duration expansion is needed
      const durationCheck = calculateParentDurationExpansion(
        parentTask.duration,
        existingSubtasks,
        body.additional_duration
      );

      // If expansion is needed, check if user confirmed it
      if (durationCheck.needsExpansion) {
        if (!body.extend_parent_duration) {
          return NextResponse.json(
            {
              error: "Subtask carryover duration exceeds parent task duration",
              details: [
                `Total subtask duration (${durationCheck.requiredTotal} min) exceeds parent task duration (${parentTask.duration} min) by ${durationCheck.expansionAmount} min`,
              ],
              current_total: durationCheck.currentTotal,
              carryover_duration: body.additional_duration,
              total_with_carryover: durationCheck.requiredTotal,
              parent_duration: parentTask.duration,
              required_extension: durationCheck.expansionAmount,
            },
            { status: 400 }
          );
        }

        // Expand parent task duration
        const newParentDuration = durationCheck.requiredTotal;
        await db.execute(
          `UPDATE tasks SET duration = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [newParentDuration, now, originalTask.parent_task_id, session.user.id]
        );
      }

      // Get all subtasks including the original for timestamp calculation
      const allSubtasksResult = await db.execute(
        `SELECT * FROM tasks WHERE parent_task_id = ? AND user_id = ? ORDER BY priority ASC, created_at ASC`,
        [originalTask.parent_task_id, session.user.id]
      );
      const allSubtasks = allSubtasksResult.rows.map(mapRowToTask);

      // Calculate timestamp to position carryover immediately after original
      const carryoverTimestamp = calculateCarryoverTimestamp(originalTask, allSubtasks);

      // Build description for carryover subtask
      let carryoverDescription = originalTask.description || "";
      if (body.notes) {
        carryoverDescription =
          body.notes +
          (carryoverDescription ? `\n\n---\nOriginal description:\n${carryoverDescription}` : "");
      }

      // Create the carryover subtask
      const carryoverSubtask: Task = {
        id: taskId,
        user_id: session.user.id,
        title: `${originalTask.title} (continued)`,
        description: carryoverDescription || null,
        priority: originalTask.priority,
        status: "pending",
        duration: body.additional_duration,
        scheduled_start: null,
        scheduled_end: null,
        due_date: originalTask.due_date || parentTask.due_date || null,
        locked: false,
        group_id: originalTask.group_id,
        template_id: null,
        task_type: "subtask",
        google_calendar_event_id: null,
        notification_sent: false,
        depends_on_task_id: null,
        energy_level_required: originalTask.energy_level_required,
        parent_task_id: originalTask.parent_task_id,
        continued_from_task_id: originalTaskId,
        ignored: false,
        created_at: carryoverTimestamp,
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
          carryoverSubtask.id,
          carryoverSubtask.user_id,
          carryoverSubtask.title,
          carryoverSubtask.description ?? null,
          carryoverSubtask.priority,
          carryoverSubtask.status,
          carryoverSubtask.duration ?? null,
          carryoverSubtask.scheduled_start ?? null,
          carryoverSubtask.scheduled_end ?? null,
          carryoverSubtask.due_date ?? null,
          carryoverSubtask.locked,
          carryoverSubtask.group_id ?? null,
          carryoverSubtask.template_id ?? null,
          carryoverSubtask.task_type,
          carryoverSubtask.google_calendar_event_id ?? null,
          carryoverSubtask.notification_sent,
          carryoverSubtask.depends_on_task_id ?? null,
          carryoverSubtask.energy_level_required,
          carryoverSubtask.parent_task_id ?? null,
          carryoverSubtask.continued_from_task_id ?? null,
          carryoverSubtask.ignored,
          carryoverSubtask.created_at,
          carryoverSubtask.updated_at,
        ]
      );

      // Mark the original subtask as rescheduled
      await db.execute(`UPDATE tasks SET status = 'rescheduled', updated_at = ? WHERE id = ?`, [
        now,
        originalTaskId,
      ]);

      // Return the carryover subtask
      return NextResponse.json(
        {
          carryover_task: carryoverSubtask,
          original_task: {
            ...originalTask,
            status: "rescheduled" as TaskStatus,
            updated_at: now,
          },
          message: "Carryover subtask created successfully. Original subtask marked as rescheduled.",
        },
        { status: 201 }
      );
    }

    // Handle regular task carryover (existing logic)
    // Build description for carryover task
    let carryoverDescription = originalTask.description || "";
    if (body.notes) {
      carryoverDescription =
        body.notes +
        (carryoverDescription ? `\n\n---\nOriginal description:\n${carryoverDescription}` : "");
    }

    // Create the carryover task with the same properties but new duration
    const carryoverTask: Task = {
      id: taskId,
      user_id: session.user.id,
      title: `${originalTask.title} (continued)`,
      description: carryoverDescription || null,
      priority: originalTask.priority,
      status: "pending",
      duration: body.additional_duration,
      scheduled_start: null, // User will schedule this
      scheduled_end: null,
      due_date: originalTask.due_date, // Keep the same due date
      locked: false,
      group_id: originalTask.group_id,
      template_id: originalTask.template_id,
      task_type: "task",
      google_calendar_event_id: null,
      notification_sent: false,
      depends_on_task_id: originalTask.depends_on_task_id,
      energy_level_required: originalTask.energy_level_required,
      parent_task_id: null,
      continued_from_task_id: originalTaskId, // Link to original task
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
        carryoverTask.id,
        carryoverTask.user_id,
        carryoverTask.title,
        carryoverTask.description ?? null,
        carryoverTask.priority,
        carryoverTask.status,
        carryoverTask.duration ?? null,
        carryoverTask.scheduled_start ?? null,
        carryoverTask.scheduled_end ?? null,
        carryoverTask.due_date ?? null,
        carryoverTask.locked,
        carryoverTask.group_id ?? null,
        carryoverTask.template_id ?? null,
        carryoverTask.task_type,
        carryoverTask.google_calendar_event_id ?? null,
        carryoverTask.notification_sent,
        carryoverTask.depends_on_task_id ?? null,
        carryoverTask.energy_level_required,
        carryoverTask.parent_task_id ?? null,
        carryoverTask.continued_from_task_id ?? null,
        carryoverTask.ignored,
        carryoverTask.created_at,
        carryoverTask.updated_at,
      ]
    );

    // Copy any dependencies from the original task to the carryover
    const depsResult = await db.execute(
      `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`,
      [originalTaskId]
    );

    for (const row of depsResult.rows) {
      await db.execute(
        `INSERT INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)`,
        [
          `dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          taskId,
          row.depends_on_task_id,
        ]
      );
    }

    // Auto-schedule the carryover task if requested
    if (body.auto_schedule) {
      // Get user's timezone and working hours
      const userResult = await db.execute(
        "SELECT timezone, working_hours FROM users WHERE id = ?",
        [session.user.id]
      );
      const userTimezone =
        userResult.rows.length > 0
          ? getUserTimezone(userResult.rows[0].timezone as string | null)
          : "UTC";

      let workingHours = null;
      if (userResult.rows.length > 0 && userResult.rows[0].working_hours) {
        try {
          workingHours = JSON.parse(userResult.rows[0].working_hours as string);
        } catch (e) {
          console.error("Error parsing working_hours JSON:", e);
          workingHours = null;
        }
      }

      // Get all tasks for the user to check for conflicts (including the newly created carryover)
      const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
        session.user.id,
      ]);
      const allTasks = allTasksResult.rows.map(mapRowToTask);

      // Auto-schedule: Use optimal scheduling strategy (respects due date)
      const slot = scheduleTask(carryoverTask, allTasks, workingHours, userTimezone, {
        strategy: "optimal",
      });

      if (slot) {
        // Update the carryover task with scheduled times
        const updatedAt = new Date().toISOString();
        await db.execute(
          `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ?`,
          [slot.start.toISOString(), slot.end.toISOString(), updatedAt, taskId]
        );

        // Update the carryoverTask object with scheduled times
        carryoverTask.scheduled_start = slot.start.toISOString();
        carryoverTask.scheduled_end = slot.end.toISOString();
        carryoverTask.updated_at = updatedAt;
      }
    }

    // Mark the original task as rescheduled (not cancelled, so it remains visible)
    await db.execute(`UPDATE tasks SET status = 'rescheduled', updated_at = ? WHERE id = ?`, [
      now,
      originalTaskId,
    ]);

    // Return both tasks
    return NextResponse.json(
      {
        carryover_task: carryoverTask,
        original_task: { ...originalTask, status: "rescheduled" as TaskStatus, updated_at: now },
        message: body.auto_schedule
          ? "Carryover task created and scheduled successfully. Original task marked as rescheduled."
          : "Carryover task created successfully. Original task marked as rescheduled.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating carryover task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/tasks/[id]/carryover - Get carryover history for a task
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(taskResult.rows[0]);

    // Get the chain of carryovers (both ancestors and descendants)
    const chain: Task[] = [task];

    // Find ancestors (tasks this was continued from)
    let currentId: string | null = task.continued_from_task_id ?? null;
    while (currentId) {
      const ancestorResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
        currentId,
        session.user.id,
      ]);
      if (ancestorResult.rows.length === 0) break;
      const ancestor = mapRowToTask(ancestorResult.rows[0]);
      chain.unshift(ancestor); // Add to beginning
      currentId = ancestor.continued_from_task_id ?? null;
    }

    // Find descendants (tasks continued from this one)
    const findDescendants = async (taskId: string): Promise<Task[]> => {
      const result = await db.execute(
        "SELECT * FROM tasks WHERE continued_from_task_id = ? AND user_id = ?",
        [taskId, session.user.id]
      );
      const descendants: Task[] = [];
      for (const row of result.rows) {
        const descendant = mapRowToTask(row);
        descendants.push(descendant);
        const furtherDescendants = await findDescendants(descendant.id);
        descendants.push(...furtherDescendants);
      }
      return descendants;
    };

    const descendants = await findDescendants(id);
    chain.push(...descendants);

    return NextResponse.json({
      task,
      carryover_chain: chain,
      is_carryover: !!task.continued_from_task_id,
      has_carryovers: descendants.length > 0,
    });
  } catch (error) {
    console.error("Error fetching carryover history:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
