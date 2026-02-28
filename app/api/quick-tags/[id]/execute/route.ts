import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTaskId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { Task } from "@/lib/types";

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

// POST /api/quick-tags/[id]/execute - Create a task from a quick tag
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch the quick tag (any authenticated user can execute — supports shared NFC tags)
    const tagResult = await db.execute({
      sql: "SELECT * FROM quick_tags WHERE id = ?",
      args: [id],
    });

    if (tagResult.rows.length === 0) {
      return NextResponse.json({ error: "Quick tag not found" }, { status: 404 });
    }

    const tag = tagResult.rows[0];

    // Accept optional body overrides (for confirm form flow)
    let overrides: {
      task_title?: string;
      task_description?: string;
      schedule_offset_minutes?: number;
      priority?: number;
      duration_minutes?: number;
      energy_level?: number;
    } = {};
    try {
      const body = await request.json();
      overrides = body || {};
    } catch {
      // No body or invalid JSON is fine - use tag defaults
    }

    const taskTitle = overrides.task_title || (tag.task_title as string);
    const taskDescription =
      overrides.task_description !== undefined
        ? overrides.task_description
        : (tag.task_description as string | null);
    const offsetMinutes =
      overrides.schedule_offset_minutes ?? (tag.schedule_offset_minutes as number);
    const priority = overrides.priority ?? (tag.priority as number);
    const durationMinutes = overrides.duration_minutes ?? (tag.duration_minutes as number | null);
    const energyLevel = overrides.energy_level ?? (tag.energy_level as number);
    const taskType = tag.task_type as string;

    // Verify group exists for the executing user — fall back to no group if it doesn't
    let groupId: string | null = tag.group_id as string | null;
    if (groupId) {
      const groupCheck = await db.execute({
        sql: "SELECT id FROM task_groups WHERE id = ? AND user_id = ?",
        args: [groupId, session.user.id],
      });
      if (groupCheck.rows.length === 0) {
        groupId = null;
      }
    }

    const now = new Date();
    const scheduledStart = new Date(now.getTime() + offsetMinutes * 60 * 1000);
    const duration = durationMinutes || 30;
    const scheduledEnd = new Date(scheduledStart.getTime() + duration * 60 * 1000);

    const taskId = generateTaskId();
    const nowISO = now.toISOString();

    await db.execute({
      sql: `INSERT INTO tasks (
        id, user_id, title, description, priority, status, duration,
        scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
        task_type, google_calendar_event_id, notification_sent,
        depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
        ignored, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        taskId,
        session.user.id,
        taskTitle,
        taskDescription || null,
        priority,
        "pending",
        duration,
        scheduledStart.toISOString(),
        scheduledEnd.toISOString(),
        null, // due_date
        0, // locked
        groupId,
        null, // template_id
        taskType,
        null, // google_calendar_event_id
        0, // notification_sent
        null, // depends_on_task_id
        energyLevel,
        null, // parent_task_id
        null, // continued_from_task_id
        0, // ignored
        nowISO,
        nowISO,
      ],
    });

    const taskResult = await db.execute({
      sql: "SELECT * FROM tasks WHERE id = ?",
      args: [taskId],
    });

    const task = mapRowToTask(taskResult.rows[0]);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error executing quick tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
