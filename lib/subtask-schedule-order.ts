import { scheduleTask } from "@/lib/scheduler-utils";
import type { GroupScheduleHours, Task, TaskGroup } from "@/lib/types";

export function orderSubtaskSchedules(
  tasks: Task[],
  parentIds: Set<string>,
  groups: TaskGroup[],
  awakeHours: GroupScheduleHours | null,
  timezone: string
): Task[] {
  const working = tasks.map((task) => ({ ...task }));
  const moved: Task[] = [];
  for (const parentId of parentIds) {
    const steps = working
      .filter(
        (task) =>
          task.parent_task_id === parentId &&
          !["completed", "cancelled", "rescheduled"].includes(task.status)
      )
      .sort(
        (a, b) =>
          (a.step_order ?? 0) - (b.step_order ?? 0) ||
          a.created_at.localeCompare(b.created_at) ||
          a.id.localeCompare(b.id)
      );
    let previousEnd: Date | null = null;
    for (const step of steps) {
      if (!step.scheduled_start || !step.scheduled_end) continue;
      const start = new Date(step.scheduled_start);
      const end = new Date(step.scheduled_end);
      if (previousEnd && start < previousEnd) {
        if (step.locked) {
          throw new Error(
            `“${step.title}” is locked and would occur before an earlier step finishes. Unlock it or choose an earlier time for the preceding step.`
          );
        }
        const group = groups.find((group) => group.id === step.group_id);
        const hours =
          group?.auto_schedule_enabled && group.auto_schedule_hours
            ? group.auto_schedule_hours
            : awakeHours;
        const duration = (end.getTime() - start.getTime()) / 60000;
        // Remove later movable steps as obstacles: they will be checked next.
        const laterIds = new Set(
          steps
            .slice(steps.indexOf(step) + 1)
            .filter((task) => !task.locked)
            .map((task) => task.id)
        );
        const slot = scheduleTask(
          { ...step, duration },
          working.filter((task) => !laterIds.has(task.id) && task.id !== parentId),
          hours,
          timezone,
          { startFrom: previousEnd, maxDaysAhead: 365 }
        );
        if (!slot) {
          throw new Error(
            `There is no available time for “${step.title}” after the preceding step. Adjust its duration or scheduling hours and try again.`
          );
        }
        step.scheduled_start = slot.start.toISOString();
        step.scheduled_end = slot.end.toISOString();
        moved.push(step);
      }
      previousEnd = new Date(step.scheduled_end);
    }
  }
  return moved;
}
