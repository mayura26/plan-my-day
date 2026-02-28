import { parseISO } from "date-fns";
import type { Task } from "@/lib/types";

/**
 * Check if two tasks overlap in time
 * @param task1 First task
 * @param task2 Second task
 * @returns true if tasks overlap, false otherwise
 */
export function doTasksOverlap(task1: Task, task2: Task): boolean {
  if (!task1.scheduled_start || !task1.scheduled_end) return false;
  if (!task2.scheduled_start || !task2.scheduled_end) return false;

  try {
    const start1 = parseISO(task1.scheduled_start).getTime();
    const end1 = parseISO(task1.scheduled_end).getTime();
    const start2 = parseISO(task2.scheduled_start).getTime();
    const end2 = parseISO(task2.scheduled_end).getTime();

    // Tasks overlap if: start1 < end2 && end1 > start2
    return start1 < end2 && end1 > start2;
  } catch (error) {
    console.error("Error checking task overlap:", error);
    return false;
  }
}

/**
 * Detect overlaps between active and completed tasks
 * @param activeTasks Array of active tasks (non-completed)
 * @param completedTasks Array of completed tasks
 * @returns Map of active task IDs to arrays of overlapping completed task IDs
 */
export function detectTaskOverlaps(
  activeTasks: Task[],
  completedTasks: Task[]
): Map<string, Task[]> {
  const overlaps = new Map<string, Task[]>();

  for (const activeTask of activeTasks) {
    const overlappingCompleted: Task[] = [];

    for (const completedTask of completedTasks) {
      if (doTasksOverlap(activeTask, completedTask)) {
        overlappingCompleted.push(completedTask);
      }
    }

    if (overlappingCompleted.length > 0) {
      overlaps.set(activeTask.id, overlappingCompleted);
    }
  }

  return overlaps;
}

/**
 * True if `inner` is fully contained within `outer` (not identical)
 */
export function isTaskNestedInside(inner: Task, outer: Task): boolean {
  if (!inner.scheduled_start || !inner.scheduled_end) return false;
  if (!outer.scheduled_start || !outer.scheduled_end) return false;
  try {
    const innerStart = parseISO(inner.scheduled_start).getTime();
    const innerEnd = parseISO(inner.scheduled_end).getTime();
    const outerStart = parseISO(outer.scheduled_start).getTime();
    const outerEnd = parseISO(outer.scheduled_end).getTime();
    return (
      outerStart <= innerStart &&
      innerEnd <= outerEnd &&
      !(outerStart === innerStart && outerEnd === innerEnd)
    );
  } catch {
    return false;
  }
}

export interface NestingResult {
  hostToGuests: Map<string, Task[]>; // host id → sorted guest tasks
  guestIds: Set<string>; // all guest task ids
}

/**
 * Detect which active tasks are fully nested inside other active tasks.
 * Returns a map of host task ids to their sorted guest tasks, plus the set of all guest ids.
 */
export function detectNestedTasks(activeTasks: Task[]): NestingResult {
  const hostToGuests = new Map<string, Task[]>();
  const guestIds = new Set<string>();

  for (const candidate of activeTasks) {
    for (const other of activeTasks) {
      if (candidate.id === other.id) continue;
      if (isTaskNestedInside(candidate, other)) {
        if (!hostToGuests.has(other.id)) hostToGuests.set(other.id, []);
        hostToGuests.get(other.id)?.push(candidate);
        guestIds.add(candidate.id);
      }
    }
  }

  // Sort each host's guests by start time
  for (const [id, guests] of hostToGuests) {
    hostToGuests.set(
      id,
      guests.sort(
        (a, b) =>
          (a.scheduled_start ? parseISO(a.scheduled_start).getTime() : 0) -
          (b.scheduled_start ? parseISO(b.scheduled_start).getTime() : 0)
      )
    );
  }

  return { hostToGuests, guestIds };
}

export interface TaskSegment {
  segmentStart: string; // UTC ISO
  segmentEnd: string; // UTC ISO
  segmentIndex: number;
  totalSegments: number;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * Calculate the visual segments a host task should render as,
 * given its sorted list of guest tasks that split it.
 */
export function calculateHostSegments(hostTask: Task, guestTasks: Task[]): TaskSegment[] {
  if (!hostTask.scheduled_start || !hostTask.scheduled_end || !guestTasks.length) return [];

  const raw: Array<{ segmentStart: string; segmentEnd: string }> = [];
  let cursor = hostTask.scheduled_start;

  for (const guest of guestTasks) {
    if (!guest.scheduled_start || !guest.scheduled_end) continue;
    const gapMs = parseISO(guest.scheduled_start).getTime() - parseISO(cursor).getTime();
    if (gapMs > 0) raw.push({ segmentStart: cursor, segmentEnd: guest.scheduled_start });
    cursor = guest.scheduled_end;
  }

  const trailingMs = parseISO(hostTask.scheduled_end).getTime() - parseISO(cursor).getTime();
  if (trailingMs > 0) raw.push({ segmentStart: cursor, segmentEnd: hostTask.scheduled_end });

  const total = raw.length;
  return raw.map((seg, i) => ({
    ...seg,
    segmentIndex: i,
    totalSegments: total,
    isFirst: i === 0,
    isLast: i === total - 1,
  }));
}
