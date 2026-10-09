import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { orderSubtaskSchedules } from "@/lib/subtask-schedule-order";
import { db, withTaskTransaction } from "@/lib/turso";
import type { Task, TaskGroup } from "@/lib/types";

class SchedulingConflict extends Error {}
class FailedTaskMutation extends Error {
  constructor(readonly response: Response) {
    super("Task mutation failed");
  }
}

/** Apply ordering to every task mutation, including edits, shuffles and bulk schedules. */
export function withSubtaskScheduleOrder<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args) => {
    const session = await auth();
    if (!session?.user?.id) return handler(...args);
    const userId = session.user.id;
    try {
      return await withTaskTransaction(async () => {
        const before = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [userId]);
        const response = await handler(...args);
        if (!response.ok) throw new FailedTaskMutation(response);
        const after = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [userId]);
        const tasks = after.rows.map((row) => ({
          ...row,
          locked: Boolean(row.locked),
        })) as unknown as Task[];
        const oldTasks = new Map(before.rows.map((row) => [String(row.id), row]));
        const parentIds = new Set<string>();
        for (const task of tasks) {
          const old = oldTasks.get(task.id);
          if (
            task.parent_task_id &&
            (!old ||
              old.scheduled_start !== task.scheduled_start ||
              old.scheduled_end !== task.scheduled_end ||
              old.step_order !== task.step_order ||
              old.parent_task_id !== task.parent_task_id)
          ) {
            parentIds.add(task.parent_task_id);
          }
        }
        if (!parentIds.size) return response;
        const [user, groupRows] = await Promise.all([
          db.execute("SELECT timezone, awake_hours FROM users WHERE id = ?", [userId]),
          db.execute("SELECT * FROM task_groups WHERE user_id = ?", [userId]),
        ]);
        const groups = groupRows.rows.map((row) => ({
          ...row,
          auto_schedule_enabled: Boolean(row.auto_schedule_enabled),
          auto_schedule_hours: row.auto_schedule_hours
            ? JSON.parse(String(row.auto_schedule_hours))
            : null,
        })) as unknown as TaskGroup[];
        let moved: Task[];
        try {
          moved = orderSubtaskSchedules(
            tasks,
            parentIds,
            groups,
            user.rows[0]?.awake_hours ? JSON.parse(String(user.rows[0].awake_hours)) : null,
            String(user.rows[0]?.timezone || "UTC")
          );
        } catch (error) {
          throw new SchedulingConflict(
            error instanceof Error ? error.message : "Unable to maintain subtask order."
          );
        }
        const now = new Date().toISOString();
        for (const task of moved) {
          await db.execute(
            "UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ?, notification_sent = 0, lead_reminder_sent = 0 WHERE id = ? AND user_id = ?",
            [task.scheduled_start ?? null, task.scheduled_end ?? null, now, task.id, userId]
          );
        }
        if (!moved.length) return response;
        const updated = new Map(
          moved.map((task) => [
            task.id,
            { ...task, updated_at: now, notification_sent: false, lead_reminder_sent: false },
          ])
        );
        // Refresh any task objects in the existing response, including bulk results.
        const refresh = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(refresh);
          if (value && typeof value === "object") {
            const object = value as Record<string, unknown>;
            if (typeof object.id === "string" && updated.has(object.id))
              return { ...object, ...updated.get(object.id) };
            return Object.fromEntries(
              Object.entries(object).map(([key, item]) => [key, refresh(item)])
            );
          }
          return value;
        };
        const body = refresh(await response.json()) as Record<string, unknown>;
        return NextResponse.json(
          { ...body, adjustedSubtasks: [...updated.values()] },
          { status: response.status }
        );
      });
    } catch (error) {
      if (error instanceof FailedTaskMutation) return error.response;
      if (error instanceof SchedulingConflict) {
        return NextResponse.json(
          { error: error.message, needs_clarification: true },
          { status: 409 }
        );
      }
      throw error;
    }
  };
}
