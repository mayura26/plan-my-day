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

