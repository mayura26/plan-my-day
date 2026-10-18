import { type NextRequest, NextResponse } from "next/server";
import { validateAPIKey } from "@/lib/api-auth";
import type { Task, TaskStatus, TaskType } from "@/lib/types";

/** Slim scheduled item returned by the external agenda API */
export interface AgendaItem {
  id: string;
  title: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: number;
  duration: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  group_id: string | null;
  parent_task_id: string | null;
  energy_level_required: number;
  locked: boolean;
}

export type RequireApiUserResult =
  | { userId: string; error?: never }
  | { userId?: never; error: NextResponse };

/**
 * Validate API key auth for external endpoints.
 * Returns userId on success, or a 401 NextResponse on failure.
 */
export async function requireApiUser(request: NextRequest): Promise<RequireApiUserResult> {
  const userId = await validateAPIKey(request);
  if (!userId) {
    return {
      error: NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 }),
    };
  }
  return { userId };
}

/** Map a DB row to a slim agenda item for external pollers */
export function mapRowToAgendaItem(row: Record<string, unknown>): AgendaItem {
  return {
    id: row.id as string,
    title: row.title as string,
    task_type: row.task_type as TaskType,
    status: row.status as TaskStatus,
    priority: row.priority as number,
    duration: (row.duration as number | null) ?? null,
    scheduled_start: (row.scheduled_start as string | null) ?? null,
    scheduled_end: (row.scheduled_end as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    group_id: (row.group_id as string | null) ?? null,
    parent_task_id: (row.parent_task_id as string | null) ?? null,
    energy_level_required: row.energy_level_required as number,
    locked: Boolean(row.locked),
  };
}

/** Map a DB row to a full Task (for complete / schedule responses) */
export function mapRowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    priority: row.priority as number,
    status: row.status as TaskStatus,
    duration: (row.duration as number | null) ?? null,
    scheduled_start: (row.scheduled_start as string | null) ?? null,
    scheduled_end: (row.scheduled_end as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    locked: Boolean(row.locked),
    group_id: (row.group_id as string | null) ?? null,
    template_id: (row.template_id as string | null) ?? null,
    task_type: row.task_type as TaskType,
    google_calendar_event_id: (row.google_calendar_event_id as string | null) ?? null,
    notification_sent: Boolean(row.notification_sent),
    lead_reminder_sent: Boolean(row.lead_reminder_sent ?? 0),
    due_reminder_sent: Boolean(row.due_reminder_sent ?? 0),
    critical_reminder_snoozed_until:
      (row.critical_reminder_snoozed_until as string | null) ?? null,
    critical_reminder_last_sent_at: (row.critical_reminder_last_sent_at as string | null) ?? null,
    depends_on_task_id: (row.depends_on_task_id as string | null) ?? null,
    energy_level_required: row.energy_level_required as number,
    parent_task_id: (row.parent_task_id as string | null) ?? null,
    continued_from_task_id: (row.continued_from_task_id as string | null) ?? null,
    step_order:
      row.step_order !== null && row.step_order !== undefined ? Number(row.step_order) : null,
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Format a local calendar date as YYYY-MM-DD */
export function formatDateKey(year: number, monthIndex: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD into { year, monthIndex, day } or null */
export function parseDateOnly(value: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const monthIndex = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, monthIndex, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== monthIndex ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, monthIndex, day };
}
