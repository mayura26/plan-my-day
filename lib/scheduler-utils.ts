import { createDateInTimezone } from "@/lib/timezone-utils";
import type { GroupScheduleHours, SchedulingMode, Task, TaskGroup } from "@/lib/types";

interface TimeSlot {
  start: Date;
  end: Date;
}

/**
 * Dependency map type: maps task ID to array of dependency task IDs
 */
export type DependencyMap = Map<string, string[]>;

/**
 * Get all dependency task IDs for a task
 * Checks both depends_on_task_id (legacy) and dependencyMap (from task_dependencies table)
 *
 * @param task The task to get dependencies for
 * @param dependencyMap Map of task_id -> [depends_on_task_id, ...] from task_dependencies table
 * @returns Array of dependency task IDs
 */
export function getTaskDependencies(task: Task, dependencyMap: DependencyMap): string[] {
  const dependencies: string[] = [];

  // Check legacy depends_on_task_id field
  if (task.depends_on_task_id) {
    dependencies.push(task.depends_on_task_id);
  }

  // Check task_dependencies table via dependencyMap
  const tableDependencies = dependencyMap.get(task.id);
  if (tableDependencies) {
    for (const depId of tableDependencies) {
      if (!dependencies.includes(depId)) {
        dependencies.push(depId);
      }
    }
  }

  return dependencies;
}

/**
 * Get dependency constraint - the latest scheduled_end time from incomplete dependencies
 * Returns null if no constraints or if any incomplete dependency is not scheduled
 *
 * @param task The task to schedule
 * @param allTasks All tasks (to look up dependency tasks)
 * @param dependencyMap Map of task_id -> [depends_on_task_id, ...] from task_dependencies table
 * @returns Latest scheduled_end time from incomplete dependencies, or null
 */
export function getDependencyConstraint(
  task: Task,
  allTasks: Task[],
  dependencyMap: DependencyMap
): Date | null {
  const dependencyIds = getTaskDependencies(task, dependencyMap);
  if (dependencyIds.length === 0) {
    return null;
  }

  // Create a map of task ID to task for quick lookup
  const taskMap = new Map<string, Task>();
  for (const t of allTasks) {
    taskMap.set(t.id, t);
  }

  let latestEndTime: Date | null = null;
  let hasUnscheduledDependency = false;

  for (const depId of dependencyIds) {
    const depTask = taskMap.get(depId);
    if (!depTask) {
      // Dependency task not found - skip it
      continue;
    }

    // Only consider incomplete dependencies
    if (depTask.status === "completed") {
      continue;
    }

    // If dependency is not scheduled, we can't determine when it will complete
    if (!depTask.scheduled_end) {
      hasUnscheduledDependency = true;
      continue;
    }

    // Track the latest scheduled_end time
    const depEndTime = new Date(depTask.scheduled_end);
    if (!latestEndTime || depEndTime > latestEndTime) {
      latestEndTime = depEndTime;
    }
  }

  // If any incomplete dependency is unscheduled, return null (can't determine constraint)
  if (hasUnscheduledDependency) {
    return null;
  }

  return latestEndTime;
}

/**
 * Find the nearest available time slot for a task
 * All date math is done in UTC. Working hours are checked by converting UTC times to user's timezone.
 *
 * @param task The task to schedule
 * @param existingTasks All existing scheduled tasks (scheduled_start/end are in UTC)
 * @param startFrom The earliest time to start searching from (in UTC)
 * @param workingHours Per-day working hours configuration (defaults to 9-17 for all days if not provided)
 * @param maxDaysAhead Maximum days to search ahead (default 7)
 * @param timezone User's timezone (used only to check if UTC times fall within working hours)
 * @param dependencyMap Optional map of task_id -> [depends_on_task_id, ...] for dependency checking
 * @param allTasks Optional all tasks array (required if dependencyMap is provided)
 * @returns Time slot in UTC or null if no slot found
 */
export function findNearestAvailableSlot(
  task: Task,
  existingTasks: Task[],
  startFrom: Date = new Date(),
  workingHours: GroupScheduleHours | null = null,
  maxDaysAhead: number = 7,
  timezone: string = "UTC",
  dependencyMap?: DependencyMap,
  allTasks?: Task[]
): TimeSlot | null {
  if (!task.duration || task.duration <= 0) {
    return null;
  }

  // Check dependency constraints if dependencyMap is provided
  let adjustedStartFrom = startFrom;
  if (dependencyMap && allTasks) {
    const constraintTime = getDependencyConstraint(task, allTasks, dependencyMap);
    if (constraintTime) {
      // Start searching after the latest dependency completion time
      adjustedStartFrom = new Date(Math.max(startFrom.getTime(), constraintTime.getTime()));
    }
  }

  const durationMs = task.duration * 60 * 1000; // Convert minutes to milliseconds

  // All times are in UTC from here on
  const nowUTC = new Date();
  const maxSearchTime = new Date(adjustedStartFrom);
  maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + maxDaysAhead);

  // Get all scheduled time slots from existing tasks (all UTC)
  // This is CRITICAL for conflict detection - must include all scheduled tasks except the one being scheduled
  const scheduledSlots: TimeSlot[] = existingTasks
    .filter(
      (t) =>
        t.id !== task.id && // Exclude the task being scheduled
        t.scheduled_start && // Must have a scheduled start
        t.scheduled_end && // Must have a scheduled end
        t.status !== "completed" && // Don't check conflicts with completed tasks
        t.status !== "cancelled" && // Don't check conflicts with cancelled tasks
        t.status !== "rescheduled" // Don't check conflicts with rescheduled (carried over) tasks
    )
    .map((t) => {
      if (!t.scheduled_start || !t.scheduled_end) {
        throw new Error("Scheduled start and end must be defined");
      }
      return {
        start: new Date(t.scheduled_start),
        end: new Date(t.scheduled_end),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime()); // Sort by start time for easier debugging

  // Helper: Get what day/time a UTC timestamp represents in the user's timezone
  const getTimeInTimezone = (
    utcDate: Date
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  } => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcDate);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "monday";
    return {
      year: parseInt(parts.find((p) => p.type === "year")?.value || "0", 10),
      month: parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1,
      day: parseInt(parts.find((p) => p.type === "day")?.value || "0", 10),
      hour: parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10),
      minute: parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10),
      dayOfWeek: weekday as
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday",
    };
  };

  // Helper: Get working hours for a specific day (defaults to 9-17 if not configured)
  const getWorkingHoursForDay = (day: string): { start: number; end: number } | null => {
    const daySchedule = workingHours?.[day as keyof GroupScheduleHours];
    if (daySchedule && daySchedule !== null) {
      return daySchedule;
    }
    // Default to 9 AM - 5 PM if not configured
    if (!workingHours || Object.keys(workingHours).length === 0) {
      return { start: 9, end: 17 };
    }
    // If working hours are configured but this day is not, skip this day
    return null;
  };

  // Start searching from adjustedStartFrom (UTC), but not before now
  // Round to next 15-minute interval in UTC
  let currentTimeUTC = new Date(Math.max(adjustedStartFrom.getTime(), nowUTC.getTime()));
  const currentMinutes = currentTimeUTC.getUTCMinutes();
  // Round up to next 15-minute mark
  const roundedMinutes = Math.ceil(currentMinutes / 15) * 15;
  if (roundedMinutes >= 60) {
    currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
  } else {
    currentTimeUTC.setUTCMinutes(roundedMinutes, 0, 0);
  }

  // Search slot by slot (in 15-minute intervals in UTC)
  while (currentTimeUTC < maxSearchTime) {
    const slotStartUTC = new Date(currentTimeUTC);
    const slotEndUTC = new Date(slotStartUTC.getTime() + durationMs);

    // Get what day/time this slot represents in user's timezone
    const slotTzTime = getTimeInTimezone(slotStartUTC);
    const dayHours = getWorkingHoursForDay(slotTzTime.dayOfWeek);

    // Skip this day if it has no working hours configured
    if (!dayHours) {
      // Move to start of next day - find when the next day starts in user's timezone
      // Add 24 hours and search for the next midnight in timezone
      const nextDay = new Date(slotStartUTC);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      // Search around this time for midnight in the timezone
      for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
        const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTz = getTimeInTimezone(candidate);
        if (candidateTz.hour === 0 && candidateTz.minute === 0) {
          currentTimeUTC = candidate;
          break;
        }
      }
      // If we didn't find exact midnight, just add 24 hours as fallback
      if (currentTimeUTC === slotStartUTC) {
        currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
        currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      }
      continue;
    }

    // Check if the slot start is within working hours (or after hours on today)
    const nowTzTime = getTimeInTimezone(nowUTC);
    const isToday =
      slotTzTime.year === nowTzTime.year &&
      slotTzTime.month === nowTzTime.month &&
      slotTzTime.day === nowTzTime.day;

    const slotTimeInMinutes = slotTzTime.hour * 60 + slotTzTime.minute;
    const startInMinutes = dayHours.start * 60;
    const endInMinutes = dayHours.end * 60;
    const isInWorkingHours =
      slotTimeInMinutes >= startInMinutes && slotTimeInMinutes < endInMinutes;

    if (!isInWorkingHours) {
      // Not in working hours - if it's after working hours on today, immediately jump to next working day
      // This prevents getting stuck when scheduling outside work hours
      if (isToday && slotTimeInMinutes >= endInMinutes) {
        // After working hours today - jump to start of next working day
        const nextDay = new Date(slotStartUTC);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        // Find the next working day
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
          const candidateDay = new Date(nextDay);
          candidateDay.setUTCDate(candidateDay.getUTCDate() + dayOffset);
          const candidateTz = getTimeInTimezone(candidateDay);
          const candidateDayHours = getWorkingHoursForDay(candidateTz.dayOfWeek);
          if (candidateDayHours) {
            // Found a working day, set to start of working hours
            for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
              const candidate = new Date(candidateDay.getTime() + offsetHours * 60 * 60 * 1000);
              const candidateTzTime = getTimeInTimezone(candidate);
              if (
                candidateTzTime.year === candidateTz.year &&
                candidateTzTime.month === candidateTz.month &&
                candidateTzTime.day === candidateTz.day &&
                candidateTzTime.hour === candidateDayHours.start &&
                candidateTzTime.minute === 0
              ) {
                currentTimeUTC = candidate;
                break;
              }
            }
            // Check if we successfully moved
            const checkTzTime = getTimeInTimezone(currentTimeUTC);
            if (
              checkTzTime.year === candidateTz.year &&
              checkTzTime.month === candidateTz.month &&
              checkTzTime.day === candidateTz.day &&
              checkTzTime.hour === candidateDayHours.start
            ) {
              break; // Successfully moved to next working day
            }
          }
        }
        // Fallback: add 24 hours
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
        }
        continue;
      } else if (!isToday || slotTimeInMinutes >= 23 * 60) {
        // Not today, or after 11 PM - move to next day
        const nextDay = new Date(slotStartUTC);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        // Find start of next day in timezone
        for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
          const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
          const candidateTz = getTimeInTimezone(candidate);
          if (candidateTz.hour === dayHours.start && candidateTz.minute === 0) {
            currentTimeUTC = candidate;
            currentTimeUTC.setUTCMinutes(
              Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15,
              0,
              0
            );
            break;
          }
        }
        // If we didn't find exact start, just add 24 hours as fallback
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
        }
        continue;
      }
      // Before working hours on today - allow it, but check if slot end fits
    }

    // Check if slot end is within working hours (or same day if after hours today)
    const slotEndTzTime = getTimeInTimezone(slotEndUTC);
    const slotEndTimeInMinutes = slotEndTzTime.hour * 60 + slotEndTzTime.minute;
    const endIsInWorkingHours =
      slotEndTimeInMinutes >= startInMinutes && slotEndTimeInMinutes <= endInMinutes;
    const endIsToday =
      slotEndTzTime.year === nowTzTime.year &&
      slotEndTzTime.month === nowTzTime.month &&
      slotEndTzTime.day === nowTzTime.day;

    if (!endIsInWorkingHours && (!endIsToday || slotEndTzTime.hour >= 23)) {
      // Can't fit, move to next day
      const nextDay = new Date(slotStartUTC);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      // Find start of next day in timezone
      for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
        const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTz = getTimeInTimezone(candidate);
        if (candidateTz.hour === dayHours.start && candidateTz.minute === 0) {
          currentTimeUTC = candidate;
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
          break;
        }
      }
      // If we didn't find exact start, just add 24 hours as fallback
      if (currentTimeUTC === slotStartUTC) {
        currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
        currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      }
      continue;
    }

    // Check for conflicts with existing scheduled tasks (all UTC)
    // CRITICAL: This check must happen for ALL strategies (both ASAP and Optimal)
    // We need to check if our proposed slot overlaps with any existing scheduled task
    let hasConflict = false;
    let latestConflictEnd: Date | null = null;

    for (const scheduledSlot of scheduledSlots) {
      // Check if there's any overlap (all times are UTC)
      // Overlap occurs if:
      // - Our start is within the scheduled slot [scheduled.start, scheduled.end), OR
      // - Our end is within the scheduled slot (scheduled.start, scheduled.end], OR
      // - We completely contain the scheduled slot, OR
      // - The scheduled slot completely contains us
      const ourStart = slotStartUTC.getTime();
      const ourEnd = slotEndUTC.getTime();
      const theirStart = scheduledSlot.start.getTime();
      const theirEnd = scheduledSlot.end.getTime();

      // Check for any overlap - using <= and >= to handle edge cases
      const hasOverlap = ourStart < theirEnd && ourEnd > theirStart; // Standard overlap check

      if (hasOverlap) {
        hasConflict = true;
        // Track the latest conflict end time (to jump past all overlapping conflicts)
        if (!latestConflictEnd || theirEnd > latestConflictEnd.getTime()) {
          latestConflictEnd = new Date(scheduledSlot.end);
        }
      }
    }

    if (hasConflict && latestConflictEnd) {
      // Move to the end of the latest conflicting slot, rounded to next 15 minutes in UTC
      // This ensures we jump past all overlapping conflicts at once
      currentTimeUTC = new Date(latestConflictEnd);
      currentTimeUTC.setUTCMinutes(Math.ceil(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      if (currentTimeUTC.getUTCMinutes() >= 60) {
        currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
        currentTimeUTC.setUTCMinutes(0, 0, 0);
      }
      // Continue to next iteration - this will recalculate slotStartUTC and slotEndUTC
      // from the new currentTimeUTC and check working hours and conflicts again
      continue;
    }

    // No conflicts found - we have a valid slot!
    // Double-check: verify slotEndUTC is still valid after conflict checks
    return {
      start: slotStartUTC,
      end: slotEndUTC,
    };
  }

  // No slot found within the search window
  return null;
}

/**
 * Scheduling strategy types
 */
export type SchedulingStrategy = "asap" | "optimal";

/**
 * Interface for scheduling options
 */
export interface ScheduleTaskOptions {
  strategy?: SchedulingStrategy; // "asap" (ignores due date) or "optimal" (respects due date)
  maxDaysAhead?: number; // Override default max days (default: 7 for asap, calculated for optimal)
  startFrom?: Date; // Override start time (default: now)
}

/**
 * High-level function to schedule a task using the appropriate strategy
 * This is the main entry point for all auto-scheduling operations
 *
 * @param task The task to schedule (must have duration)
 * @param allTasks All existing tasks for conflict checking
 * @param workingHours User's working hours configuration
 * @param timezone User's timezone
 * @param options Scheduling options
 * @returns Time slot in UTC or null if no slot found
 */
export function scheduleTask(
  task: Task,
  allTasks: Task[],
  workingHours: GroupScheduleHours | null,
  timezone: string,
  options: ScheduleTaskOptions = {}
): TimeSlot | null {
  if (!task.duration || task.duration <= 0) {
    return null;
  }

  const strategy = options.strategy || "asap";
  const now = options.startFrom || new Date();

  let startFrom: Date;
  let maxDaysAhead: number;

  if (strategy === "asap") {
    // ASAP scheduling: ignore due date, schedule as soon as possible
    startFrom = now;
    maxDaysAhead = options.maxDaysAhead ?? 7;
  } else {
    // Optimal scheduling: respect due date, find best slot within due date window
    startFrom = now;

    if (options.maxDaysAhead !== undefined) {
      maxDaysAhead = options.maxDaysAhead;
    } else if (task.due_date) {
      const dueDate = new Date(task.due_date);
      if (dueDate > now) {
        // Calculate days until due date (cap at 30 days for performance)
        const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        maxDaysAhead = Math.min(Math.max(daysUntilDue, 1), 30);
      } else {
        // Due date is in the past or today, default to 7 days
        maxDaysAhead = 7;
      }
    } else {
      // No due date, default to 7 days
      maxDaysAhead = 7;
    }
  }

  // Use the core scheduling algorithm
  return findNearestAvailableSlot(task, allTasks, startFrom, workingHours, maxDaysAhead, timezone);
}

/**
 * Helper: Get what day/time a UTC timestamp represents in the user's timezone
 */
function getTimeInTimezone(
  utcDate: Date,
  timezone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "monday";
  return {
    year: parseInt(parts.find((p) => p.type === "year")?.value || "0", 10),
    month: parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1,
    day: parseInt(parts.find((p) => p.type === "day")?.value || "0", 10),
    hour: parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10),
    minute: parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10),
    dayOfWeek: weekday as
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday"
      | "sunday",
  };
}

/**
 * Helper: Get working hours for a specific day (defaults to 9-17 if not configured)
 */
function getWorkingHoursForDay(
  day: string,
  workingHours: GroupScheduleHours | null
): { start: number; end: number } | null {
  const daySchedule = workingHours?.[day as keyof GroupScheduleHours];
  if (daySchedule && daySchedule !== null) {
    return daySchedule;
  }
  // Default to 9 AM - 5 PM if not configured
  if (!workingHours || Object.keys(workingHours).length === 0) {
    return { start: 9, end: 17 };
  }
  // If working hours are configured but this day is not, skip this day
  return null;
}

/**
 * Find the next working hours slot from a given time
 * If after hours, returns start of next working day
 */
export function findNextWorkingHoursSlot(
  startFrom: Date,
  workingHours: GroupScheduleHours | null,
  timezone: string
): Date {
  const nowUTC = new Date();
  let currentTimeUTC = new Date(Math.max(startFrom.getTime(), nowUTC.getTime()));

  // Round to next 15-minute interval
  const currentMinutes = currentTimeUTC.getUTCMinutes();
  const roundedMinutes = Math.ceil(currentMinutes / 15) * 15;
  if (roundedMinutes >= 60) {
    currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
  } else {
    currentTimeUTC.setUTCMinutes(roundedMinutes, 0, 0);
  }

  // Find next working hours slot
  const maxSearchTime = new Date(currentTimeUTC);
  maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + 7); // Search up to 7 days ahead

  while (currentTimeUTC < maxSearchTime) {
    const tzTime = getTimeInTimezone(currentTimeUTC, timezone);
    const dayHours = getWorkingHoursForDay(tzTime.dayOfWeek, workingHours);

    if (!dayHours) {
      // No working hours for this day, move to next day
      const nextDay = new Date(currentTimeUTC);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
        const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTz = getTimeInTimezone(candidate, timezone);
        if (candidateTz.hour === 0 && candidateTz.minute === 0) {
          currentTimeUTC = candidate;
          break;
        }
      }
      if (currentTimeUTC.getTime() === nextDay.getTime() - 12 * 60 * 60 * 1000) {
        currentTimeUTC = new Date(currentTimeUTC.getTime() + 24 * 60 * 60 * 1000);
        currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      }
      continue;
    }

    const timeInMinutes = tzTime.hour * 60 + tzTime.minute;
    const startInMinutes = dayHours.start * 60;
    const endInMinutes = dayHours.end * 60;

    if (timeInMinutes >= startInMinutes && timeInMinutes < endInMinutes) {
      // Within working hours
      return currentTimeUTC;
    }

    // Not in working hours, move to start of working hours for this day or next day
    if (timeInMinutes < startInMinutes) {
      // Before working hours today, move to start of working hours
      const nowTzTime = getTimeInTimezone(nowUTC, timezone);
      const isToday =
        tzTime.year === nowTzTime.year &&
        tzTime.month === nowTzTime.month &&
        tzTime.day === nowTzTime.day;

      if (isToday) {
        // Set to start of working hours today
        for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
          const candidate = new Date(currentTimeUTC.getTime() + offsetHours * 60 * 60 * 1000);
          const candidateTz = getTimeInTimezone(candidate, timezone);
          if (
            candidateTz.year === tzTime.year &&
            candidateTz.month === tzTime.month &&
            candidateTz.day === tzTime.day &&
            candidateTz.hour === dayHours.start &&
            candidateTz.minute === 0
          ) {
            return candidate;
          }
        }
      }
    }

    // After working hours or couldn't find today's start, move to next working day
    // Start from tomorrow and iterate through the next 7 days to find a working day
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
      // Create a date for the target day at noon UTC (to avoid timezone edge cases)
      const targetDayUTC = new Date(currentTimeUTC);
      targetDayUTC.setUTCDate(targetDayUTC.getUTCDate() + dayOffset);
      targetDayUTC.setUTCHours(12, 0, 0, 0); // Set to noon to get the date in timezone

      // Get what date this represents in the user's timezone
      const candidateTz = getTimeInTimezone(targetDayUTC, timezone);
      const candidateDayHours = getWorkingHoursForDay(candidateTz.dayOfWeek, workingHours);

      if (candidateDayHours) {
        // Found a working day, find the UTC time that represents start of working hours on this day
        // Search from 24 hours before to 24 hours after noon UTC to find the right time
        for (let offsetHours = -24; offsetHours <= 24; offsetHours++) {
          const candidate = new Date(targetDayUTC.getTime() + offsetHours * 60 * 60 * 1000);
          const candidateTzTime = getTimeInTimezone(candidate, timezone);
          if (
            candidateTzTime.year === candidateTz.year &&
            candidateTzTime.month === candidateTz.month &&
            candidateTzTime.day === candidateTz.day &&
            candidateTzTime.hour === candidateDayHours.start &&
            candidateTzTime.minute === 0
          ) {
            return candidate;
          }
        }
      }
    }

    // Fallback: add 24 hours
    currentTimeUTC = new Date(currentTimeUTC.getTime() + 24 * 60 * 60 * 1000);
    currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
  }

  // Fallback: return current time rounded
  return currentTimeUTC;
}

/**
 * Check if a time slot is within working hours
 */
export function isWithinWorkingHours(
  slot: TimeSlot,
  workingHours: GroupScheduleHours | null,
  timezone: string
): boolean {
  const startTz = getTimeInTimezone(slot.start, timezone);
  const endTz = getTimeInTimezone(slot.end, timezone);
  const dayHours = getWorkingHoursForDay(startTz.dayOfWeek, workingHours);

  if (!dayHours) {
    return false;
  }

  const startInMinutes = startTz.hour * 60 + startTz.minute;
  const endInMinutes = endTz.hour * 60 + endTz.minute;
  const startWorkingMinutes = dayHours.start * 60;
  const endWorkingMinutes = dayHours.end * 60;

  // Check if both start and end are within working hours
  // Also allow if it's the same day and we're after hours (for today only)
  const nowUTC = new Date();
  const nowTz = getTimeInTimezone(nowUTC, timezone);
  const isToday =
    startTz.year === nowTz.year && startTz.month === nowTz.month && startTz.day === nowTz.day;

  if (isToday && startInMinutes >= endWorkingMinutes && startInMinutes < 23 * 60) {
    // After hours today but before 11 PM - allow it
    return true;
  }

  return (
    startInMinutes >= startWorkingMinutes &&
    startInMinutes < endWorkingMinutes &&
    endInMinutes >= startWorkingMinutes &&
    endInMinutes <= endWorkingMinutes
  );
}

/**
 * Get the start of the next working day
 */
export function getStartOfNextWorkingDay(
  currentDate: Date,
  workingHours: GroupScheduleHours | null,
  timezone: string
): Date {
  // Start from tomorrow and iterate through the next 7 days to find a working day
  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    // Create a date for the target day at noon UTC (to avoid timezone edge cases)
    const targetDayUTC = new Date(currentDate);
    targetDayUTC.setUTCDate(targetDayUTC.getUTCDate() + dayOffset);
    targetDayUTC.setUTCHours(12, 0, 0, 0); // Set to noon to get the date in timezone

    // Get what date this represents in the user's timezone
    const candidateTz = getTimeInTimezone(targetDayUTC, timezone);
    const candidateDayHours = getWorkingHoursForDay(candidateTz.dayOfWeek, workingHours);

    if (candidateDayHours) {
      // Found a working day, find the UTC time that represents start of working hours on this day
      // Search from 24 hours before to 24 hours after noon UTC to find the right time
      for (let offsetHours = -24; offsetHours <= 24; offsetHours++) {
        const candidate = new Date(targetDayUTC.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTzTime = getTimeInTimezone(candidate, timezone);
        if (
          candidateTzTime.year === candidateTz.year &&
          candidateTzTime.month === candidateTz.month &&
          candidateTzTime.day === candidateTz.day &&
          candidateTzTime.hour === candidateDayHours.start &&
          candidateTzTime.minute === 0
        ) {
          return candidate;
        }
      }
    }
  }

  // Fallback: add 24 hours and set to 9 AM
  const fallback = new Date(currentDate);
  fallback.setUTCDate(fallback.getUTCDate() + 1);
  fallback.setUTCHours(9, 0, 0, 0);
  return fallback;
}

/**
 * Reschedule a task with ASAP shuffling - places task at next working hours slot
 * and recursively shuffles conflicting tasks forward
 */
export function rescheduleTaskWithShuffling(
  task: Task,
  allTasks: Task[],
  workingHours: GroupScheduleHours | null,
  timezone: string
): {
  taskSlot: TimeSlot;
  shuffledTasks: Array<{ taskId: string; newSlot: TimeSlot }>;
} {
  if (!task.duration || task.duration <= 0) {
    throw new Error("Task must have a duration to be rescheduled");
  }

  const durationMs = task.duration * 60 * 1000;
  const nowUTC = new Date();

  // Find next working hours slot for the task
  const nextWorkingSlotStart = findNextWorkingHoursSlot(nowUTC, workingHours, timezone);
  const nextWorkingSlotEnd = new Date(nextWorkingSlotStart.getTime() + durationMs);
  const taskSlot: TimeSlot = {
    start: nextWorkingSlotStart,
    end: nextWorkingSlotEnd,
  };

  // Get all scheduled tasks (excluding the one being rescheduled, completed, cancelled, and rescheduled)
  const scheduledTasks = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      t.scheduled_start &&
      t.scheduled_end &&
      t.status !== "completed" &&
      t.status !== "cancelled" &&
      t.status !== "rescheduled"
  );

  // Track shuffled tasks to prevent infinite loops
  const shuffledTasks: Array<{ taskId: string; newSlot: TimeSlot }> = [];
  const shuffledTaskIds = new Set<string>();
  const shuffledTaskSlots = new Map<string, TimeSlot>(); // Map of task ID to new slot
  const maxRecursionDepth = 100; // Prevent infinite loops
  const recursionDepth = 0;

  // Helper function to check if two time slots overlap
  const slotsOverlap = (slot1: TimeSlot, slot2: TimeSlot): boolean => {
    return (
      slot1.start.getTime() < slot2.end.getTime() && slot1.end.getTime() > slot2.start.getTime()
    );
  };

  // Recursive function to shuffle a conflicting task
  const shuffleTask = (
    conflictingTask: Task,
    newSlotStart: Date,
    depth: number
  ): TimeSlot | null => {
    if (depth > maxRecursionDepth) {
      console.error("Maximum recursion depth reached in shuffling algorithm");
      return null;
    }

    if (shuffledTaskIds.has(conflictingTask.id)) {
      // Already shuffled this task, skip to prevent circular dependencies
      return null;
    }

    if (conflictingTask.locked) {
      // Locked tasks cannot be shuffled - this will cause a conflict that we can't resolve
      // For now, we'll skip locked tasks and let the caller handle it
      return null;
    }

    const taskDuration = (conflictingTask.duration || 30) * 60 * 1000;
    let candidateSlotStart = new Date(newSlotStart);

    // Round to next 15-minute interval
    const minutes = candidateSlotStart.getUTCMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    if (roundedMinutes >= 60) {
      candidateSlotStart.setUTCHours(candidateSlotStart.getUTCHours() + 1, 0, 0, 0);
    } else {
      candidateSlotStart.setUTCMinutes(roundedMinutes, 0, 0);
    }

    const candidateSlotEnd = new Date(candidateSlotStart.getTime() + taskDuration);
    const candidateSlot: TimeSlot = {
      start: candidateSlotStart,
      end: candidateSlotEnd,
    };

    // Check if slot is within working hours
    if (!isWithinWorkingHours(candidateSlot, workingHours, timezone)) {
      // Move to start of next working day
      candidateSlotStart = getStartOfNextWorkingDay(candidateSlotStart, workingHours, timezone);
      candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
      candidateSlot.start = candidateSlotStart;
      candidateSlot.end = candidateSlotEnd;
    }

    // Check for conflicts with other scheduled tasks
    // Must check against both original slots and new shuffled slots
    const conflicts: Task[] = [];

    // Check conflicts with original scheduled tasks (not yet shuffled)
    for (const otherTask of scheduledTasks) {
      if (
        otherTask.id === conflictingTask.id ||
        shuffledTaskIds.has(otherTask.id) ||
        otherTask.status === "completed" ||
        otherTask.status === "cancelled" ||
        otherTask.status === "rescheduled"
      ) {
        continue;
      }

      if (!otherTask.scheduled_start || !otherTask.scheduled_end) {
        continue;
      }

      const otherSlot: TimeSlot = {
        start: new Date(otherTask.scheduled_start),
        end: new Date(otherTask.scheduled_end),
      };

      if (slotsOverlap(candidateSlot, otherSlot)) {
        conflicts.push(otherTask);
      }
    }

    // Check conflicts with already-shuffled tasks (using their new slots)
    for (const [taskId, shuffledSlot] of shuffledTaskSlots.entries()) {
      if (taskId === conflictingTask.id) {
        continue;
      }

      if (slotsOverlap(candidateSlot, shuffledSlot)) {
        // Find the task from scheduledTasks to add to conflicts
        const shuffledTask = scheduledTasks.find((t) => t.id === taskId);
        if (shuffledTask && !conflicts.includes(shuffledTask)) {
          conflicts.push(shuffledTask);
        }
      }
    }

    // If there are conflicts, recursively shuffle them first
    if (conflicts.length > 0) {
      // Sort conflicts chronologically by scheduled_start
      conflicts.sort((a, b) => {
        const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
        const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
        return aStart - bStart;
      });

      // Shuffle each conflicting task
      let latestConflictEnd = candidateSlot.end;
      for (const conflictTask of conflicts) {
        const shuffledSlot = shuffleTask(conflictTask, latestConflictEnd, depth + 1);
        if (shuffledSlot) {
          shuffledTasks.push({ taskId: conflictTask.id, newSlot: shuffledSlot });
          shuffledTaskIds.add(conflictTask.id);
          shuffledTaskSlots.set(conflictTask.id, shuffledSlot); // Track new slot
          latestConflictEnd = shuffledSlot.end;
        }
      }

      // Update our slot to start after the last shuffled conflict
      candidateSlotStart = new Date(latestConflictEnd);
      // Round to next 15-minute interval
      const newMinutes = candidateSlotStart.getUTCMinutes();
      const newRoundedMinutes = Math.ceil(newMinutes / 15) * 15;
      if (newRoundedMinutes >= 60) {
        candidateSlotStart.setUTCHours(candidateSlotStart.getUTCHours() + 1, 0, 0, 0);
      } else {
        candidateSlotStart.setUTCMinutes(newRoundedMinutes, 0, 0);
      }
      candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
      candidateSlot.start = candidateSlotStart;
      candidateSlot.end = candidateSlotEnd;

      // Check if still within working hours
      if (!isWithinWorkingHours(candidateSlot, workingHours, timezone)) {
        candidateSlotStart = getStartOfNextWorkingDay(candidateSlotStart, workingHours, timezone);
        candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
        candidateSlot.start = candidateSlotStart;
        candidateSlot.end = candidateSlotEnd;
      }
    }

    return candidateSlot;
  };

  // Check for conflicts with the task slot
  const initialConflicts: Task[] = [];
  for (const scheduledTask of scheduledTasks) {
    if (
      scheduledTask.status === "completed" ||
      scheduledTask.status === "cancelled" ||
      scheduledTask.status === "rescheduled" ||
      !scheduledTask.scheduled_start ||
      !scheduledTask.scheduled_end
    ) {
      continue;
    }

    const theirStart = new Date(scheduledTask.scheduled_start).getTime();
    const theirEnd = new Date(scheduledTask.scheduled_end).getTime();
    const ourStart = taskSlot.start.getTime();
    const ourEnd = taskSlot.end.getTime();

    if (ourStart < theirEnd && ourEnd > theirStart) {
      initialConflicts.push(scheduledTask);
    }
  }

  // Shuffle all conflicting tasks
  if (initialConflicts.length > 0) {
    // Sort conflicts chronologically
    initialConflicts.sort((a, b) => {
      const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return aStart - bStart;
    });

    // Shuffle each conflict
    let latestConflictEnd = taskSlot.end;
    for (const conflictTask of initialConflicts) {
      const shuffledSlot = shuffleTask(conflictTask, latestConflictEnd, recursionDepth);
      if (shuffledSlot) {
        shuffledTasks.push({ taskId: conflictTask.id, newSlot: shuffledSlot });
        shuffledTaskIds.add(conflictTask.id);
        shuffledTaskSlots.set(conflictTask.id, shuffledSlot); // Track new slot
        latestConflictEnd = shuffledSlot.end;
      }
    }
  }

  return {
    taskSlot,
    shuffledTasks,
  };
}

/**
 * Scheduling mode types
 * @deprecated Import from @/lib/types instead. This export is kept for backward compatibility.
 */
export type { SchedulingMode } from "@/lib/types";

/**
 * Scheduling result with feedback messages
 */
export interface SchedulingResult {
  slot: TimeSlot | null;
  feedback: string[];
  error?: string;
  shuffledTasks?: Array<{ taskId: string; newSlot: TimeSlot }>;
}

/**
 * Unified scheduling options
 */
export interface UnifiedSchedulingOptions {
  mode: SchedulingMode;
  task: Task;
  allTasks: Task[];
  taskGroup?: TaskGroup | null; // Task's group if it has one
  awakeHours: GroupScheduleHours | null; // User's awake hours
  timezone: string;
  onProgress?: (message: string) => void; // Optional progress callback
  maxTimeout?: number; // Max timeout in milliseconds (default: 30000)
  startFrom?: Date; // Optional custom start time (overrides mode's default start time)
  dependencyMap?: DependencyMap; // Optional dependency map for dependency checking
}

/**
 * Get the start of next week in user's timezone
 * Returns a UTC Date that represents midnight on next Monday in the user's timezone
 */
function getStartOfNextWeek(currentDate: Date, timezone: string): Date {
  const tzTime = getTimeInTimezone(currentDate, timezone);

  // Calculate what day of week it is in the user's timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const weekday = formatter.format(currentDate).toLowerCase();

  // Map weekday to day number (0 = Sunday, 1 = Monday, etc.)
  const weekdayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const dayOfWeek = weekdayMap[weekday] ?? 1;

  // Calculate days until next Monday
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;

  // Create a date string in ISO format for next Monday in the user's timezone
  // We'll create it as if it's in UTC, then createDateInTimezone will handle the conversion
  const nextMondayLocal = new Date(
    Date.UTC(tzTime.year, tzTime.month, tzTime.day + daysUntilMonday, 12, 0, 0, 0)
  );

  // Use createDateInTimezone to get the UTC Date that represents midnight on next Monday in the user's timezone
  // createDateInTimezone will extract the date components in the target timezone from the Date object
  return createDateInTimezone(nextMondayLocal, 0, 0, timezone);
}

/**
 * Get the start of next month in user's timezone
 * Returns a UTC Date that represents midnight on the first day of next month in the user's timezone
 */
function getStartOfNextMonth(currentDate: Date, timezone: string): Date {
  const tzTime = getTimeInTimezone(currentDate, timezone);

  // Calculate first day of next month in the user's timezone
  const nextMonth = tzTime.month === 11 ? 0 : tzTime.month + 1;
  const nextYear = tzTime.month === 11 ? tzTime.year + 1 : tzTime.year;

  // Create a Date object at noon UTC for the first of next month
  // createDateInTimezone will extract what date this represents in the target timezone
  const firstOfNextMonthDate = new Date(Date.UTC(nextYear, nextMonth, 1, 12, 0, 0, 0));

  // Use createDateInTimezone to get the UTC Date that represents midnight on the first of next month in the user's timezone
  return createDateInTimezone(firstOfNextMonthDate, 0, 0, timezone);
}

/**
 * Get the end of today in user's timezone
 * Returns a UTC Date that represents 23:59:59 on today in the user's timezone
 */
function getEndOfToday(currentDate: Date, timezone: string): Date {
  const tzTime = getTimeInTimezone(currentDate, timezone);

  // Create a Date object at noon UTC for today
  // createDateInTimezone will extract what date this represents in the target timezone
  const todayDate = new Date(Date.UTC(tzTime.year, tzTime.month, tzTime.day, 12, 0, 0, 0));

  // Use createDateInTimezone to get the UTC Date that represents 23:59:59 today in the user's timezone
  return createDateInTimezone(todayDate, 23, 59, timezone);
}

/**
 * Get the start of tomorrow in user's timezone
 * Returns a UTC Date that represents midnight on tomorrow in the user's timezone
 */
function getStartOfTomorrow(currentDate: Date, timezone: string): Date {
  const tzTime = getTimeInTimezone(currentDate, timezone);

  // Create a Date object at noon UTC for tomorrow
  const tomorrowDate = new Date(Date.UTC(tzTime.year, tzTime.month, tzTime.day + 1, 12, 0, 0, 0));

  // Use createDateInTimezone to get the UTC Date that represents midnight tomorrow in the user's timezone
  return createDateInTimezone(tomorrowDate, 0, 0, timezone);
}

/**
 * Get the end of tomorrow in user's timezone
 * Returns a UTC Date that represents 23:59:59 on tomorrow in the user's timezone
 */
function getEndOfTomorrow(currentDate: Date, timezone: string): Date {
  const tzTime = getTimeInTimezone(currentDate, timezone);

  // Create a Date object at noon UTC for tomorrow
  const tomorrowDate = new Date(Date.UTC(tzTime.year, tzTime.month, tzTime.day + 1, 12, 0, 0, 0));

  // Use createDateInTimezone to get the UTC Date that represents 23:59:59 tomorrow in the user's timezone
  return createDateInTimezone(tomorrowDate, 23, 59, timezone);
}

/**
 * Find an available time slot before a deadline (due date), searching backwards
 * Starts from the due date day and works backwards until finding a slot
 * All date math is done in UTC. Working hours are checked by converting UTC times to user's timezone.
 *
 * @param task The task to schedule (must have duration)
 * @param existingTasks All existing scheduled tasks (scheduled_start/end are in UTC)
 * @param deadline The deadline (due date) to schedule before (in UTC)
 * @param workingHours Per-day working hours configuration (defaults to 9-17 for all days if not provided)
 * @param maxDaysBack Maximum days to search backwards (default 30)
 * @param timezone User's timezone (used only to check if UTC times fall within working hours)
 * @param dependencyMap Optional map of task_id -> [depends_on_task_id, ...] for dependency checking
 * @param allTasks Optional all tasks array (required if dependencyMap is provided)
 * @returns Time slot in UTC or null if no slot found
 */
export function findAvailableSlotBeforeDeadline(
  task: Task,
  existingTasks: Task[],
  deadline: Date,
  workingHours: GroupScheduleHours | null = null,
  maxDaysBack: number = 30,
  timezone: string = "UTC",
  dependencyMap?: DependencyMap,
  allTasks?: Task[]
): TimeSlot | null {
  if (!task.duration || task.duration <= 0) {
    return null;
  }

  const durationMs = task.duration * 60 * 1000; // Convert minutes to milliseconds
  const nowUTC = new Date();

  // Check dependency constraints if dependencyMap is provided
  let dependencyConstraint: Date | null = null;
  if (dependencyMap && allTasks) {
    dependencyConstraint = getDependencyConstraint(task, allTasks, dependencyMap);
  }

  // Get all scheduled time slots from existing tasks (all UTC)
  const scheduledSlots: TimeSlot[] = existingTasks
    .filter(
      (t) =>
        t.id !== task.id &&
        t.scheduled_start &&
        t.scheduled_end &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "rescheduled"
    )
    .map((t) => {
      if (!t.scheduled_start || !t.scheduled_end) {
        throw new Error("Scheduled start and end must be defined");
      }
      return {
        start: new Date(t.scheduled_start),
        end: new Date(t.scheduled_end),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Helper: Get what day/time a UTC timestamp represents in the user's timezone
  const getTimeInTimezone = (
    utcDate: Date
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
  } => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcDate);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "monday";
    return {
      year: parseInt(parts.find((p) => p.type === "year")?.value || "0", 10),
      month: parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1,
      day: parseInt(parts.find((p) => p.type === "day")?.value || "0", 10),
      hour: parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10),
      minute: parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10),
      dayOfWeek: weekday as
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday",
    };
  };

  // Helper: Get working hours for a specific day
  const getWorkingHoursForDay = (day: string): { start: number; end: number } | null => {
    const daySchedule = workingHours?.[day as keyof GroupScheduleHours];
    if (daySchedule && daySchedule !== null) {
      return daySchedule;
    }
    if (!workingHours || Object.keys(workingHours).length === 0) {
      return { start: 9, end: 17 };
    }
    return null;
  };

  // Start from deadline and work backwards day by day
  for (let dayOffset = 0; dayOffset <= maxDaysBack; dayOffset++) {
    // Calculate the day we're checking (0 = due date day, 1 = day before, etc.)
    const checkDay = new Date(deadline);
    checkDay.setUTCDate(checkDay.getUTCDate() - dayOffset);

    const checkDayTz = getTimeInTimezone(checkDay);
    const dayHours = getWorkingHoursForDay(checkDayTz.dayOfWeek);

    // Skip days with no working hours
    if (!dayHours) {
      continue;
    }

    // Determine the latest possible end time for this day
    let latestEndTime: Date;
    if (dayOffset === 0) {
      // On due date day: latest end time is the deadline
      latestEndTime = new Date(deadline);
    } else {
      // On previous days: latest end time is end of working hours
      latestEndTime = createDateInTimezone(checkDay, dayHours.end, 0, timezone);
    }

    // Calculate latest possible start time (latest end time - task duration)
    let latestStartTime = new Date(latestEndTime.getTime() - durationMs);

    // Round down to previous 15-minute interval
    const latestMinutes = latestStartTime.getUTCMinutes();
    const roundedMinutes = Math.floor(latestMinutes / 15) * 15;
    latestStartTime.setUTCMinutes(roundedMinutes, 0, 0);

    // Get start of working hours for this day
    const dayStartTime = createDateInTimezone(checkDay, dayHours.start, 0, timezone);

    // Ensure we don't start before the start of working hours
    if (latestStartTime < dayStartTime) {
      // Task is too long to fit in available time on this day, try previous day
      continue;
    }

    // Also check dependency constraint
    if (dependencyConstraint && latestStartTime < dependencyConstraint) {
      // Can't schedule before dependency completion, but we'll continue checking earlier days
      // since dependency might be in the past
      if (dayOffset === 0) {
        // On due date day, we need to check if there's any valid slot after dependency
        const earliestStartTime = new Date(
          Math.max(dayStartTime.getTime(), dependencyConstraint.getTime())
        );
        if (earliestStartTime >= latestStartTime) {
          // No valid slot on due date day, continue to previous day
          continue;
        }
        latestStartTime = earliestStartTime;
        // Round down to previous 15-minute interval
        const depMinutes = latestStartTime.getUTCMinutes();
        const depRoundedMinutes = Math.floor(depMinutes / 15) * 15;
        latestStartTime.setUTCMinutes(depRoundedMinutes, 0, 0);
      } else {
        // On previous days, skip if dependency is after the end of working hours
        const dayEndTime = createDateInTimezone(checkDay, dayHours.end, 0, timezone);
        if (dependencyConstraint > dayEndTime) {
          continue;
        }
      }
    }

    // Search backwards from latest start time to start of working hours
    let currentTimeUTC = new Date(latestStartTime);

    while (currentTimeUTC >= dayStartTime) {
      const slotStartUTC = new Date(currentTimeUTC);
      const slotEndUTC = new Date(slotStartUTC.getTime() + durationMs);

      // Verify slot end doesn't exceed our deadline/working hours
      if (slotEndUTC > latestEndTime) {
        // Move back 15 minutes
        currentTimeUTC = new Date(currentTimeUTC.getTime() - 15 * 60 * 1000);
        continue;
      }

      // Get what day/time this slot represents in user's timezone
      const slotTzTime = getTimeInTimezone(slotStartUTC);
      const slotTimeInMinutes = slotTzTime.hour * 60 + slotTzTime.minute;
      const startInMinutes = dayHours.start * 60;
      const endInMinutes = dayHours.end * 60;

      // Check if within working hours
      if (slotTimeInMinutes < startInMinutes || slotTimeInMinutes >= endInMinutes) {
        // Move back 15 minutes
        currentTimeUTC = new Date(currentTimeUTC.getTime() - 15 * 60 * 1000);
        continue;
      }

      // Check if slot end is within working hours
      const slotEndTzTime = getTimeInTimezone(slotEndUTC);
      const slotEndTimeInMinutes = slotEndTzTime.hour * 60 + slotEndTzTime.minute;
      if (slotEndTimeInMinutes < startInMinutes || slotEndTimeInMinutes > endInMinutes) {
        // Move back 15 minutes
        currentTimeUTC = new Date(currentTimeUTC.getTime() - 15 * 60 * 1000);
        continue;
      }

      // Check for conflicts with existing scheduled tasks
      let hasConflict = false;
      let earliestConflictStart: Date | null = null;

      for (const scheduledSlot of scheduledSlots) {
        const ourStart = slotStartUTC.getTime();
        const ourEnd = slotEndUTC.getTime();
        const theirStart = scheduledSlot.start.getTime();
        const theirEnd = scheduledSlot.end.getTime();

        const hasOverlap = ourStart < theirEnd && ourEnd > theirStart;

        if (hasOverlap) {
          hasConflict = true;
          // Track the earliest conflict start time (to search backwards from it)
          if (!earliestConflictStart || theirStart < earliestConflictStart.getTime()) {
            earliestConflictStart = new Date(scheduledSlot.start);
          }
        }
      }

      if (hasConflict && earliestConflictStart) {
        // Move to 15 minutes before the earliest conflict start
        currentTimeUTC = new Date(earliestConflictStart.getTime() - durationMs);
        // Round down to previous 15-minute interval
        const conflictMinutes = currentTimeUTC.getUTCMinutes();
        const conflictRoundedMinutes = Math.floor(conflictMinutes / 15) * 15;
        currentTimeUTC.setUTCMinutes(conflictRoundedMinutes, 0, 0);
        continue;
      }

      // Check dependency constraint again (for the specific slot)
      if (dependencyConstraint && slotStartUTC < dependencyConstraint) {
        // Move back to after dependency
        currentTimeUTC = new Date(Math.max(dayStartTime.getTime(), dependencyConstraint.getTime()));
        // Round down to previous 15-minute interval
        const depCheckMinutes = currentTimeUTC.getUTCMinutes();
        const depCheckRoundedMinutes = Math.floor(depCheckMinutes / 15) * 15;
        currentTimeUTC.setUTCMinutes(depCheckRoundedMinutes, 0, 0);
        if (currentTimeUTC < dayStartTime) {
          // No valid slot on this day, try previous day
          break;
        }
        continue;
      }

      // Verify the slot is not in the past (unless dependency requires it)
      if (!dependencyConstraint && slotStartUTC < nowUTC) {
        // Slot is in the past, but no dependency constraint, so skip it
        // Try previous day
        break;
      }

      // Found a valid slot!
      return {
        start: slotStartUTC,
        end: slotEndUTC,
      };
    }
  }

  // No slot found
  return null;
}

/**
 * Unified scheduling function that handles all scheduling modes
 * This is the main entry point for all scheduling operations
 */
export function scheduleTaskUnified(options: UnifiedSchedulingOptions): SchedulingResult {
  const {
    mode,
    task,
    allTasks,
    taskGroup,
    awakeHours,
    timezone,
    onProgress,
    maxTimeout = 30000,
    startFrom: customStartFrom,
    dependencyMap,
  } = options;

  const feedback: string[] = [];
  const reportProgress = (message: string) => {
    feedback.push(message);
    onProgress?.(message);
  };

  if (!task.duration || task.duration <= 0) {
    return {
      slot: null,
      feedback,
      error: "Task must have a duration to be scheduled",
    };
  }

  reportProgress("Initializing scheduler...");

  // Check dependency constraints if dependencyMap is provided
  let dependencyConstraint: Date | null = null;
  if (dependencyMap) {
    dependencyConstraint = getDependencyConstraint(task, allTasks, dependencyMap);
    if (dependencyConstraint) {
      const constraintTimeStr = new Date(dependencyConstraint).toLocaleString("en-US", {
        timeZone: timezone,
      });
      reportProgress(
        `Task has dependencies. Will schedule after dependency completion (${constraintTimeStr})`
      );
    }
  }

  const nowUTC = new Date();
  const startTime = Date.now();
  const durationMs = task.duration * 60 * 1000;

  // Determine which hours to use (group rules or awake hours)
  const useGroupRules = taskGroup?.auto_schedule_enabled && taskGroup?.auto_schedule_hours;
  const scheduleHours = useGroupRules ? taskGroup.auto_schedule_hours : awakeHours;

  if (useGroupRules) {
    reportProgress(`Using group schedule rules for "${taskGroup.name}"`);
  } else {
    reportProgress("Using user awake hours");
  }

  // Determine start time and constraints based on mode
  let startFrom: Date;
  let maxSearchTime: Date;
  let mustBeToday = false;
  let mustBeTomorrow = false;
  let preferGroupRules = false;

  switch (mode) {
    case "now":
      reportProgress("Mode: Schedule Now - Finding next available slot following group rules");
      startFrom = customStartFrom || nowUTC;
      maxSearchTime = new Date(startFrom);
      maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + 30); // Search up to 30 days
      break;

    case "today":
      reportProgress(
        "Mode: Schedule Today - Preferring group rules but allowing outside if needed"
      );
      startFrom = nowUTC;
      maxSearchTime = getEndOfToday(nowUTC, timezone);
      mustBeToday = true;
      preferGroupRules = true;
      break;

    case "tomorrow": {
      reportProgress("Mode: Schedule Tomorrow - Task will be scheduled tomorrow");
      // Get tomorrow's date in user's timezone
      const tomorrowMidnight = getStartOfTomorrow(nowUTC, timezone);
      const tomorrowTzTime = getTimeInTimezone(tomorrowMidnight, timezone);

      // Get the working hours for tomorrow's day of week
      // Use group hours if available, otherwise awake hours, otherwise default 9-17
      const tomorrowDayOfWeek = tomorrowTzTime.dayOfWeek;
      const groupHoursForTomorrow =
        taskGroup?.auto_schedule_enabled && taskGroup?.auto_schedule_hours
          ? taskGroup.auto_schedule_hours[tomorrowDayOfWeek as keyof GroupScheduleHours]
          : null;
      const awakeHoursForTomorrow = awakeHours?.[tomorrowDayOfWeek as keyof GroupScheduleHours];
      const tomorrowHours = groupHoursForTomorrow || awakeHoursForTomorrow || { start: 9, end: 17 };

      // Start at the beginning of working hours tomorrow, not midnight
      startFrom = createDateInTimezone(tomorrowMidnight, tomorrowHours.start, 0, timezone);
      maxSearchTime = getEndOfTomorrow(nowUTC, timezone);
      mustBeTomorrow = true;
      preferGroupRules = true;

      reportProgress(
        `Tomorrow is ${tomorrowDayOfWeek}, working hours: ${tomorrowHours.start}:00 - ${tomorrowHours.end}:00`
      );
      break;
    }

    case "next-week":
      reportProgress("Mode: Schedule Next Week - Task must be scheduled next week onwards");
      startFrom = getStartOfNextWeek(nowUTC, timezone);
      maxSearchTime = new Date(startFrom);
      maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + 30);
      break;

    case "next-month":
      reportProgress("Mode: Schedule Next Month - Task must be scheduled next month onwards");
      startFrom = getStartOfNextMonth(nowUTC, timezone);
      maxSearchTime = new Date(startFrom);
      maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + 60);
      break;

    case "asap":
      reportProgress("Mode: Schedule ASAP - Will shuffle tasks if needed");
      startFrom = nowUTC;
      maxSearchTime = new Date(nowUTC);
      maxSearchTime.setUTCDate(maxSearchTime.getUTCDate() + 30);
      // For ASAP, we'll use the shuffling function
      return scheduleTaskASAPWithShuffling(
        task,
        allTasks,
        taskGroup,
        scheduleHours ?? null,
        awakeHours,
        timezone,
        reportProgress,
        maxTimeout
      );

    case "due-date": {
      reportProgress("Mode: Schedule to Due Date - Searching backwards from due date");
      if (!task.due_date) {
        return {
          slot: null,
          feedback,
          error: "Task must have a due date to use 'Schedule to Due Date' mode",
        };
      }
      const dueDate = new Date(task.due_date);

      // Check dependency constraints
      const adjustedDeadline = dueDate;
      if (dependencyConstraint) {
        // If dependency completion is after due date, we can't schedule
        if (dependencyConstraint > dueDate) {
          reportProgress(
            `Dependency completion (${new Date(dependencyConstraint).toLocaleString("en-US", { timeZone: timezone })}) is after due date (${dueDate.toLocaleString("en-US", { timeZone: timezone })}). Cannot schedule before due date.`
          );
          return {
            slot: null,
            feedback,
            error:
              "Dependency completion time is after the due date. Cannot schedule task before due date.",
          };
        }
      }

      // Use backward search function
      const slot = findAvailableSlotBeforeDeadline(
        task,
        allTasks,
        adjustedDeadline,
        scheduleHours ?? null,
        30, // maxDaysBack
        timezone,
        dependencyMap,
        allTasks
      );

      if (slot) {
        // Check if slot is before now (unless dependency requires it)
        if (!dependencyConstraint && slot.start < nowUTC) {
          reportProgress("Found slot but it's in the past. No valid slots before due date.");
          return {
            slot: null,
            feedback,
            error:
              "Unable to find an available time slot before the due date. All potential slots are in the past.",
          };
        }
        reportProgress(`Found available slot before due date: ${slot.start.toISOString()}`);
        return {
          slot,
          feedback,
        };
      } else {
        reportProgress("No available slot found before due date within 30 days");
        return {
          slot: null,
          feedback,
          error:
            "Unable to find an available time slot before the due date within the search window.",
        };
      }
    }

    default:
      return {
        slot: null,
        feedback,
        error: `Unknown scheduling mode: ${mode}`,
      };
  }

  // Get scheduled slots for conflict detection
  reportProgress("Checking for conflicts with existing tasks...");
  const scheduledSlots: TimeSlot[] = allTasks
    .filter(
      (t) =>
        t.id !== task.id &&
        t.scheduled_start &&
        t.scheduled_end &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "rescheduled"
    )
    .map((t) => {
      if (!t.scheduled_start || !t.scheduled_end) {
        throw new Error("Scheduled start and end must be defined");
      }
      return {
        start: new Date(t.scheduled_start),
        end: new Date(t.scheduled_end),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  reportProgress(`Found ${scheduledSlots.length} scheduled tasks to check against`);

  // Helper to get hours for a day
  const getHoursForDay = (day: string): { start: number; end: number } | null => {
    const daySchedule = scheduleHours?.[day as keyof GroupScheduleHours];
    if (daySchedule && daySchedule !== null) {
      return daySchedule;
    }
    // Default to 9 AM - 5 PM if not configured
    if (!scheduleHours || Object.keys(scheduleHours).length === 0) {
      return { start: 9, end: 17 };
    }
    return null;
  };

  // Start searching - adjust for dependency constraints
  let adjustedStartFrom = startFrom;
  if (dependencyConstraint) {
    adjustedStartFrom = new Date(Math.max(startFrom.getTime(), dependencyConstraint.getTime()));
  }
  let currentTimeUTC = new Date(Math.max(adjustedStartFrom.getTime(), nowUTC.getTime()));

  // Round to next 15-minute interval
  const currentMinutes = currentTimeUTC.getUTCMinutes();
  const roundedMinutes = Math.ceil(currentMinutes / 15) * 15;
  if (roundedMinutes >= 60) {
    currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
  } else {
    currentTimeUTC.setUTCMinutes(roundedMinutes, 0, 0);
  }

  let iterations = 0;
  const maxIterations = 10000; // Safety limit

  while (currentTimeUTC < maxSearchTime && iterations < maxIterations) {
    iterations++;

    // Check timeout
    if (Date.now() - startTime > maxTimeout) {
      reportProgress("Scheduling timeout reached (30s)");
      return {
        slot: null,
        feedback,
        error: "Scheduling timed out. Please try again or adjust your constraints.",
      };
    }

    const slotStartUTC = new Date(currentTimeUTC);
    const slotEndUTC = new Date(slotStartUTC.getTime() + durationMs);

    // Check if we're past today for "today" mode
    if (mustBeToday) {
      const slotTzTime = getTimeInTimezone(slotStartUTC, timezone);
      const nowTzTime = getTimeInTimezone(nowUTC, timezone);
      const isToday =
        slotTzTime.year === nowTzTime.year &&
        slotTzTime.month === nowTzTime.month &&
        slotTzTime.day === nowTzTime.day;

      if (!isToday) {
        reportProgress("No available slot found today");
        return {
          slot: null,
          feedback,
          error: "Unable to schedule task today. Please try Schedule Now or another mode.",
        };
      }
    }

    if (mustBeTomorrow) {
      const slotTzTime = getTimeInTimezone(slotStartUTC, timezone);
      const nowTzTime = getTimeInTimezone(nowUTC, timezone);
      // Tomorrow is nowTzTime.day + 1
      const tomorrowDate = new Date(Date.UTC(nowTzTime.year, nowTzTime.month, nowTzTime.day + 1));
      const isTomorrow =
        slotTzTime.year === tomorrowDate.getUTCFullYear() &&
        slotTzTime.month === tomorrowDate.getUTCMonth() &&
        slotTzTime.day === tomorrowDate.getUTCDate();

      if (!isTomorrow) {
        reportProgress("No available slot found tomorrow");
        return {
          slot: null,
          feedback,
          error: "Unable to schedule task tomorrow. Please try Schedule Now or another mode.",
        };
      }
    }

    // Get timezone info for this slot
    const slotTzTime = getTimeInTimezone(slotStartUTC, timezone);
    const dayHours = getHoursForDay(slotTzTime.dayOfWeek);

    // Skip days with no hours configured (unless today/tomorrow mode with preferGroupRules)
    if (!dayHours) {
      if ((mustBeToday || mustBeTomorrow) && preferGroupRules) {
        // For today/tomorrow mode with preferGroupRules, fall back to awake hours or default hours
        const awakeDayHours = awakeHours?.[slotTzTime.dayOfWeek as keyof GroupScheduleHours];
        // Use awake hours if available, otherwise use default 9-17 for today/tomorrow mode
        const fallbackHours = awakeDayHours ?? { start: 9, end: 17 };

        const timeInMinutes = slotTzTime.hour * 60 + slotTzTime.minute;
        const fallbackStart = fallbackHours.start * 60;
        const fallbackEnd = fallbackHours.end * 60;

        // Check if within fallback hours
        if (timeInMinutes >= fallbackStart && timeInMinutes < fallbackEnd) {
          // Check conflicts
          let hasConflict = false;
          let latestConflictEnd: Date | null = null;

          for (const scheduledSlot of scheduledSlots) {
            const ourStart = slotStartUTC.getTime();
            const ourEnd = slotEndUTC.getTime();
            const theirStart = scheduledSlot.start.getTime();
            const theirEnd = scheduledSlot.end.getTime();

            if (ourStart < theirEnd && ourEnd > theirStart) {
              hasConflict = true;
              if (!latestConflictEnd || theirEnd > latestConflictEnd.getTime()) {
                latestConflictEnd = new Date(scheduledSlot.end);
              }
            }
          }

          if (!hasConflict) {
            reportProgress(
              awakeDayHours
                ? "Found available slot using awake hours"
                : "Found available slot using default hours (9am-5pm)"
            );
            return {
              slot: {
                start: slotStartUTC,
                end: slotEndUTC,
              },
              feedback,
            };
          }

          // Jump past conflict
          if (latestConflictEnd) {
            currentTimeUTC = new Date(latestConflictEnd);
            currentTimeUTC.setUTCMinutes(Math.ceil(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
            if (currentTimeUTC.getUTCMinutes() >= 60) {
              currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
            }
            continue;
          }
        } else if (timeInMinutes < fallbackStart) {
          // Before fallback hours start, jump to the start
          currentTimeUTC = createDateInTimezone(slotStartUTC, fallbackHours.start, 0, timezone);
          continue;
        }
        // If past fallback hours end, will fall through to "move to next day" which triggers tomorrow check
      }

      // Move to next day - but check if this would skip past our target day
      if (mustBeTomorrow) {
        reportProgress("No available slot found tomorrow within configured hours");
        return {
          slot: null,
          feedback,
          error: "Unable to schedule task tomorrow. No available time within working hours.",
        };
      }

      // Move to next day
      const nextDay = new Date(slotStartUTC);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
        const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTz = getTimeInTimezone(candidate, timezone);
        if (candidateTz.hour === 0 && candidateTz.minute === 0) {
          currentTimeUTC = candidate;
          break;
        }
      }
      if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
        currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
        currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      }
      continue;
    }

    // Check if within hours
    const slotTimeInMinutes = slotTzTime.hour * 60 + slotTzTime.minute;
    const startInMinutes = dayHours.start * 60;
    const endInMinutes = dayHours.end * 60;
    const isInHours = slotTimeInMinutes >= startInMinutes && slotTimeInMinutes < endInMinutes;

    // For today/tomorrow mode with preferGroupRules, allow outside group hours but check awake hours
    if (!isInHours) {
      if ((mustBeToday || mustBeTomorrow) && preferGroupRules && useGroupRules) {
        // Check awake hours as fallback
        const awakeDayHours = awakeHours?.[slotTzTime.dayOfWeek as keyof GroupScheduleHours];
        if (awakeDayHours && awakeDayHours !== null) {
          const awakeStart = awakeDayHours.start * 60;
          const awakeEnd = awakeDayHours.end * 60;
          const isInAwakeHours = slotTimeInMinutes >= awakeStart && slotTimeInMinutes < awakeEnd;

          if (isInAwakeHours) {
            // Check conflicts
            let hasConflict = false;
            let latestConflictEnd: Date | null = null;

            for (const scheduledSlot of scheduledSlots) {
              const ourStart = slotStartUTC.getTime();
              const ourEnd = slotEndUTC.getTime();
              const theirStart = scheduledSlot.start.getTime();
              const theirEnd = scheduledSlot.end.getTime();

              if (ourStart < theirEnd && ourEnd > theirStart) {
                hasConflict = true;
                if (!latestConflictEnd || theirEnd > latestConflictEnd.getTime()) {
                  latestConflictEnd = new Date(scheduledSlot.end);
                }
              }
            }

            if (!hasConflict) {
              reportProgress("Found available slot outside group hours but within awake hours");
              return {
                slot: {
                  start: slotStartUTC,
                  end: slotEndUTC,
                },
                feedback,
              };
            }

            // Jump past conflict
            if (latestConflictEnd) {
              currentTimeUTC = new Date(latestConflictEnd);
              currentTimeUTC.setUTCMinutes(
                Math.ceil(currentTimeUTC.getUTCMinutes() / 15) * 15,
                0,
                0
              );
              if (currentTimeUTC.getUTCMinutes() >= 60) {
                currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
              }
              continue;
            }
          }
        }
      }

      // Not in hours - jump to next valid time
      const nowTzTime = getTimeInTimezone(nowUTC, timezone);
      const isToday =
        slotTzTime.year === nowTzTime.year &&
        slotTzTime.month === nowTzTime.month &&
        slotTzTime.day === nowTzTime.day;

      // If before hours on current day, jump to start of current day's hours
      if (slotTimeInMinutes < startInMinutes) {
        console.log(
          `[Scheduler] Before hours (${slotTzTime.hour}:${slotTzTime.minute} < ${dayHours.start}:00), jumping to start of ${slotTzTime.dayOfWeek} hours`
        );
        // Use createDateInTimezone to properly convert the current day's start time to UTC
        currentTimeUTC = createDateInTimezone(slotStartUTC, dayHours.start, 0, timezone);
        const verifyTz = getTimeInTimezone(currentTimeUTC, timezone);
        console.log(
          `[Scheduler] Found start time: ${currentTimeUTC.toISOString()} (${verifyTz.hour}:${verifyTz.minute} ${verifyTz.dayOfWeek})`
        );
        // If we went backwards (shouldn't happen but just in case), advance
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          // This shouldn't happen, but if it does, just add 24 hours
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
        }
        continue;
      }

      // After hours (or not today) - jump to start of next day with hours
      if (isToday && slotTimeInMinutes >= endInMinutes) {
        // For tomorrow mode, we can't skip to the next day
        if (mustBeTomorrow) {
          reportProgress("No available slot found tomorrow - past working hours");
          return {
            slot: null,
            feedback,
            error: "Unable to schedule task tomorrow. No available time within working hours.",
          };
        }
        // After hours today - jump to start of next day with hours
        console.log(
          `[Scheduler] After hours today (${slotTzTime.hour}:${slotTzTime.minute} >= ${dayHours.end}:00), jumping to next day`
        );
        const nextDay = new Date(slotStartUTC);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        // Find next day with hours configured
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
          const candidateDay = new Date(nextDay);
          candidateDay.setUTCDate(candidateDay.getUTCDate() + dayOffset);
          const candidateTz = getTimeInTimezone(candidateDay, timezone);
          const candidateDayHours = getHoursForDay(candidateTz.dayOfWeek);
          if (candidateDayHours) {
            // Use createDateInTimezone to properly convert to UTC
            currentTimeUTC = createDateInTimezone(
              candidateDay,
              candidateDayHours.start,
              0,
              timezone
            );
            const verifyTz = getTimeInTimezone(currentTimeUTC, timezone);
            // Verify we got the right day
            if (
              verifyTz.year === candidateTz.year &&
              verifyTz.month === candidateTz.month &&
              verifyTz.day === candidateTz.day
            ) {
              break;
            }
          }
        }
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
        }
        continue;
      } else if (!isToday || slotTimeInMinutes >= 23 * 60) {
        // Not today or very late - if after hours on current day, jump to start of current day's hours
        // Otherwise move to next day
        if (slotTimeInMinutes >= endInMinutes) {
          // For tomorrow mode, we can't skip to the next day
          if (mustBeTomorrow) {
            reportProgress("No available slot found tomorrow - past working hours");
            return {
              slot: null,
              feedback,
              error: "Unable to schedule task tomorrow. No available time within working hours.",
            };
          }
          // After hours on this day - move to next day
          const nextDay = new Date(slotStartUTC);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          // Get the next day's hours (not the current day's)
          const nextDayTz = getTimeInTimezone(nextDay, timezone);
          const nextDayHours = getHoursForDay(nextDayTz.dayOfWeek);
          if (nextDayHours) {
            // Use createDateInTimezone to properly convert the next day's start time to UTC
            currentTimeUTC = createDateInTimezone(nextDay, nextDayHours.start, 0, timezone);
          } else {
            // No hours for next day, search for next day with hours
            for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
              const candidateDay = new Date(slotStartUTC);
              candidateDay.setUTCDate(candidateDay.getUTCDate() + dayOffset);
              const candidateDayTz = getTimeInTimezone(candidateDay, timezone);
              const candidateDayHours = getHoursForDay(candidateDayTz.dayOfWeek);
              if (candidateDayHours) {
                currentTimeUTC = createDateInTimezone(
                  candidateDay,
                  candidateDayHours.start,
                  0,
                  timezone
                );
                break;
              }
            }
          }
          // Verify we actually advanced
          if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
            currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
            currentTimeUTC.setUTCMinutes(
              Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15,
              0,
              0
            );
          }
        } else {
          // Before hours on this day - jump to start of current day's hours
          // Use createDateInTimezone to properly convert the current day's start time to UTC
          currentTimeUTC = createDateInTimezone(slotStartUTC, dayHours.start, 0, timezone);
          // If we went backwards (shouldn't happen but just in case), advance
          if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
            // This shouldn't happen, but if it does, just add 24 hours
            currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
            currentTimeUTC.setUTCMinutes(
              Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15,
              0,
              0
            );
          }
        }
        continue;
      }
      // Before hours today - continue checking
    }

    // Check if slot end fits
    const slotEndTzTime = getTimeInTimezone(slotEndUTC, timezone);
    const slotEndTimeInMinutes = slotEndTzTime.hour * 60 + slotEndTzTime.minute;
    const endIsInHours =
      slotEndTimeInMinutes >= startInMinutes && slotEndTimeInMinutes <= endInMinutes;
    const nowTzTime = getTimeInTimezone(nowUTC, timezone);
    const endIsToday =
      slotEndTzTime.year === nowTzTime.year &&
      slotEndTzTime.month === nowTzTime.month &&
      slotEndTzTime.day === nowTzTime.day;

    if (!endIsInHours && (!endIsToday || slotEndTzTime.hour >= 23)) {
      // Can't fit, move to next day
      const nextDay = new Date(slotStartUTC);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      // Get the next day's hours (not the current day's)
      const nextDayTz = getTimeInTimezone(nextDay, timezone);
      const nextDayHours = getHoursForDay(nextDayTz.dayOfWeek);
      if (nextDayHours) {
        for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
          const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
          const candidateTz = getTimeInTimezone(candidate, timezone);
          if (candidateTz.hour === nextDayHours.start && candidateTz.minute === 0) {
            currentTimeUTC = candidate;
            currentTimeUTC.setUTCMinutes(
              Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15,
              0,
              0
            );
            break;
          }
        }
      }
      if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
        // Fallback: just move forward and find next day with hours
        for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
          const candidateDay = new Date(slotStartUTC);
          candidateDay.setUTCDate(candidateDay.getUTCDate() + dayOffset);
          const candidateDayTz = getTimeInTimezone(candidateDay, timezone);
          const candidateDayHours = getHoursForDay(candidateDayTz.dayOfWeek);
          if (candidateDayHours) {
            for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
              const candidate = new Date(candidateDay.getTime() + offsetHours * 60 * 60 * 1000);
              const candidateTz = getTimeInTimezone(candidate, timezone);
              if (
                candidateTz.year === candidateDayTz.year &&
                candidateTz.month === candidateDayTz.month &&
                candidateTz.day === candidateDayTz.day &&
                candidateTz.hour === candidateDayHours.start &&
                candidateTz.minute === 0
              ) {
                currentTimeUTC = candidate;
                break;
              }
            }
            if (currentTimeUTC.getTime() > slotStartUTC.getTime()) {
              break;
            }
          }
        }
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
        }
      }
      continue;
    }

    // Check for conflicts
    let hasConflict = false;
    let latestConflictEnd: Date | null = null;

    for (const scheduledSlot of scheduledSlots) {
      const ourStart = slotStartUTC.getTime();
      const ourEnd = slotEndUTC.getTime();
      const theirStart = scheduledSlot.start.getTime();
      const theirEnd = scheduledSlot.end.getTime();

      if (ourStart < theirEnd && ourEnd > theirStart) {
        hasConflict = true;
        if (!latestConflictEnd || theirEnd > latestConflictEnd.getTime()) {
          latestConflictEnd = new Date(scheduledSlot.end);
        }
      }
    }

    if (hasConflict && latestConflictEnd) {
      // Optimize: jump to end of conflict
      reportProgress(`Conflict detected, jumping to ${new Date(latestConflictEnd).toISOString()}`);
      currentTimeUTC = new Date(latestConflictEnd);
      currentTimeUTC.setUTCMinutes(Math.ceil(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
      if (currentTimeUTC.getUTCMinutes() >= 60) {
        currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
        currentTimeUTC.setUTCMinutes(0, 0, 0);
      }
      continue;
    }

    // Found valid slot!
    reportProgress("Found available slot!");
    return {
      slot: {
        start: slotStartUTC,
        end: slotEndUTC,
      },
      feedback,
    };
  }

  // No slot found
  reportProgress("No available slot found within search window");
  return {
    slot: null,
    feedback,
    error:
      "Unable to find an available time slot. Please try adjusting your constraints or use Schedule ASAP to shuffle tasks.",
  };
}

/**
 * Schedule task ASAP with shuffling, respecting group rules for shuffled tasks
 */
function scheduleTaskASAPWithShuffling(
  task: Task,
  allTasks: Task[],
  _taskGroup: TaskGroup | null | undefined,
  scheduleHours: GroupScheduleHours | null,
  awakeHours: GroupScheduleHours | null,
  timezone: string,
  reportProgress: (message: string) => void,
  maxTimeout: number,
  dependencyMap?: DependencyMap
): SchedulingResult {
  reportProgress("Finding next available slot for task...");

  const startTime = Date.now();
  if (!task.duration || task.duration <= 0) {
    return {
      slot: null,
      feedback: [],
      error: "Task must have a duration to be scheduled",
    };
  }
  const durationMs = task.duration * 60 * 1000;
  const nowUTC = new Date();

  // Check dependency constraints if dependencyMap is provided
  let dependencyConstraint: Date | null = null;
  if (dependencyMap) {
    dependencyConstraint = getDependencyConstraint(task, allTasks, dependencyMap);
    if (dependencyConstraint) {
      const constraintTimeStr = new Date(dependencyConstraint).toLocaleString("en-US", {
        timeZone: timezone,
      });
      reportProgress(
        `Task has dependencies. Will schedule after dependency completion (${constraintTimeStr})`
      );
    }
  }

  // Find next slot for the task - adjust for dependency constraints
  let startFromTime = nowUTC;
  if (dependencyConstraint) {
    startFromTime = new Date(Math.max(nowUTC.getTime(), dependencyConstraint.getTime()));
  }
  const nextSlotStart = findNextWorkingHoursSlot(
    startFromTime,
    scheduleHours || awakeHours,
    timezone
  );
  const nextSlotEnd = new Date(nextSlotStart.getTime() + durationMs);
  const taskSlot: TimeSlot = {
    start: nextSlotStart,
    end: nextSlotEnd,
  };

  reportProgress(`Proposed slot: ${nextSlotStart.toISOString()}`);

  // Get all scheduled tasks
  const scheduledTasks = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      t.scheduled_start &&
      t.scheduled_end &&
      t.status !== "completed" &&
      t.status !== "cancelled" &&
      t.status !== "rescheduled"
  );

  // Create a map of task groups for quick lookup
  // Note: In a real implementation, you'd pass groups as a parameter
  // For now, we'll use the scheduleHours from the task's group

  const shuffledTasks: Array<{ taskId: string; newSlot: TimeSlot }> = [];
  const shuffledTaskIds = new Set<string>();
  const shuffledTaskSlots = new Map<string, TimeSlot>();
  const maxRecursionDepth = 100;

  // Helper to get group for a task (simplified - in real implementation, pass groups map)
  const getTaskGroupHours = (_t: Task): GroupScheduleHours | null => {
    // This is a simplified version - in the real implementation,
    // you'd look up the task's group from a groups map
    // For now, we'll use awake hours as fallback
    return scheduleHours || awakeHours;
  };

  const slotsOverlap = (slot1: TimeSlot, slot2: TimeSlot): boolean => {
    return (
      slot1.start.getTime() < slot2.end.getTime() && slot1.end.getTime() > slot2.start.getTime()
    );
  };

  // Recursive shuffle function that respects group rules
  const shuffleTask = (
    conflictingTask: Task,
    newSlotStart: Date,
    depth: number
  ): TimeSlot | null => {
    if (Date.now() - startTime > maxTimeout) {
      reportProgress("Shuffling timeout reached");
      return null;
    }

    if (depth > maxRecursionDepth) {
      reportProgress(`Maximum recursion depth reached for task ${conflictingTask.id}`);
      return null;
    }

    if (shuffledTaskIds.has(conflictingTask.id)) {
      return null;
    }

    if (conflictingTask.locked) {
      reportProgress(`Task ${conflictingTask.id} is locked, cannot shuffle`);
      return null;
    }

    const taskDuration = (conflictingTask.duration || 30) * 60 * 1000;
    let candidateSlotStart = new Date(newSlotStart);

    // Round to next 15-minute interval
    const minutes = candidateSlotStart.getUTCMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    if (roundedMinutes >= 60) {
      candidateSlotStart.setUTCHours(candidateSlotStart.getUTCHours() + 1, 0, 0, 0);
    } else {
      candidateSlotStart.setUTCMinutes(roundedMinutes, 0, 0);
    }

    const candidateSlotEnd = new Date(candidateSlotStart.getTime() + taskDuration);
    let candidateSlot: TimeSlot = {
      start: candidateSlotStart,
      end: candidateSlotEnd,
    };

    // Get group hours for this task (respect its own group rules)
    const taskGroupHours = getTaskGroupHours(conflictingTask);
    if (!isWithinWorkingHours(candidateSlot, taskGroupHours || awakeHours, timezone)) {
      candidateSlotStart = getStartOfNextWorkingDay(
        candidateSlotStart,
        taskGroupHours || awakeHours,
        timezone
      );
      candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
      candidateSlot = {
        start: candidateSlotStart,
        end: candidateSlotEnd,
      };
    }

    // Check for conflicts
    const conflicts: Task[] = [];

    for (const otherTask of scheduledTasks) {
      if (
        otherTask.id === conflictingTask.id ||
        shuffledTaskIds.has(otherTask.id) ||
        otherTask.status === "completed" ||
        otherTask.status === "cancelled" ||
        otherTask.status === "rescheduled"
      ) {
        continue;
      }

      if (!otherTask.scheduled_start || !otherTask.scheduled_end) {
        continue;
      }

      const otherSlot: TimeSlot = {
        start: new Date(otherTask.scheduled_start),
        end: new Date(otherTask.scheduled_end),
      };

      if (slotsOverlap(candidateSlot, otherSlot)) {
        conflicts.push(otherTask);
      }
    }

    for (const [taskId, shuffledSlot] of shuffledTaskSlots.entries()) {
      if (taskId === conflictingTask.id) {
        continue;
      }

      if (slotsOverlap(candidateSlot, shuffledSlot)) {
        const shuffledTask = scheduledTasks.find((t) => t.id === taskId);
        if (shuffledTask && !conflicts.includes(shuffledTask)) {
          conflicts.push(shuffledTask);
        }
      }
    }

    // Recursively shuffle conflicts
    if (conflicts.length > 0) {
      conflicts.sort((a, b) => {
        const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
        const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
        return aStart - bStart;
      });

      let latestConflictEnd = candidateSlot.end;
      for (const conflictTask of conflicts) {
        const shuffledSlot = shuffleTask(conflictTask, latestConflictEnd, depth + 1);
        if (shuffledSlot) {
          shuffledTasks.push({ taskId: conflictTask.id, newSlot: shuffledSlot });
          shuffledTaskIds.add(conflictTask.id);
          shuffledTaskSlots.set(conflictTask.id, shuffledSlot);
          latestConflictEnd = shuffledSlot.end;
        }
      }

      candidateSlotStart = new Date(latestConflictEnd);
      const newMinutes = candidateSlotStart.getUTCMinutes();
      const newRoundedMinutes = Math.ceil(newMinutes / 15) * 15;
      if (newRoundedMinutes >= 60) {
        candidateSlotStart.setUTCHours(candidateSlotStart.getUTCHours() + 1, 0, 0, 0);
      } else {
        candidateSlotStart.setUTCMinutes(newRoundedMinutes, 0, 0);
      }
      candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
      candidateSlot = {
        start: candidateSlotStart,
        end: candidateSlotEnd,
      };

      if (!isWithinWorkingHours(candidateSlot, taskGroupHours || awakeHours, timezone)) {
        candidateSlotStart = getStartOfNextWorkingDay(
          candidateSlotStart,
          taskGroupHours || awakeHours,
          timezone
        );
        candidateSlotEnd.setTime(candidateSlotStart.getTime() + taskDuration);
        candidateSlot = {
          start: candidateSlotStart,
          end: candidateSlotEnd,
        };
      }
    }

    return candidateSlot;
  };

  // Check for conflicts with task slot
  const initialConflicts: Task[] = [];
  for (const scheduledTask of scheduledTasks) {
    if (
      scheduledTask.status === "completed" ||
      scheduledTask.status === "cancelled" ||
      scheduledTask.status === "rescheduled" ||
      !scheduledTask.scheduled_start ||
      !scheduledTask.scheduled_end
    ) {
      continue;
    }

    const theirStart = new Date(scheduledTask.scheduled_start).getTime();
    const theirEnd = new Date(scheduledTask.scheduled_end).getTime();
    const ourStart = taskSlot.start.getTime();
    const ourEnd = taskSlot.end.getTime();

    if (ourStart < theirEnd && ourEnd > theirStart) {
      initialConflicts.push(scheduledTask);
    }
  }

  if (initialConflicts.length > 0) {
    reportProgress(`Found ${initialConflicts.length} conflicting tasks, shuffling...`);
    initialConflicts.sort((a, b) => {
      const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return aStart - bStart;
    });

    let latestConflictEnd = taskSlot.end;
    for (const conflictTask of initialConflicts) {
      const shuffledSlot = shuffleTask(conflictTask, latestConflictEnd, 0);
      if (shuffledSlot) {
        shuffledTasks.push({ taskId: conflictTask.id, newSlot: shuffledSlot });
        shuffledTaskIds.add(conflictTask.id);
        shuffledTaskSlots.set(conflictTask.id, shuffledSlot);
        latestConflictEnd = shuffledSlot.end;
      }
    }
  }

  reportProgress(`Scheduling complete. ${shuffledTasks.length} tasks shuffled.`);
  return {
    slot: taskSlot,
    feedback: [],
    shuffledTasks,
  };
}

// ============================================================================
// SHUFFLE TASKS FOR DAY
// ============================================================================

export interface ShuffleOptions {
  targetDate: string; // YYYY-MM-DD
  allTasks: Task[];
  allGroups: TaskGroup[];
  awakeHours: GroupScheduleHours | null;
  timezone: string;
  maxCascadeDays?: number; // Default: 7
}

export interface ShuffleResult {
  movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }>;
  feedback: string[];
  cascadedDays: string[];
  error?: string;
}

/**
 * Shuffle all unstarted, unlocked tasks for a day forward from "now" (or start of working hours).
 * Tasks that don't fit within their group's allowed hours get pushed to the next day,
 * which triggers a cascade shuffle on that day too.
 */
export function shuffleTasksForDay(options: ShuffleOptions): ShuffleResult {
  const { targetDate, allTasks, allGroups, awakeHours, timezone, maxCascadeDays = 7 } = options;

  const feedback: string[] = [];
  const movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }> = [];
  const cascadedDays: string[] = [];
  const processedDays = new Set<string>();

  // Build a mutable map of task slots so cascaded days see previous moves
  const taskSlotOverrides = new Map<string, { start: Date; end: Date }>();

  const daysQueue: string[] = [targetDate];

  const startTime = Date.now();
  const maxTimeout = 30000;

  while (daysQueue.length > 0 && processedDays.size < maxCascadeDays) {
    if (Date.now() - startTime > maxTimeout) {
      feedback.push("Shuffle timed out. Some days may not have been processed.");
      break;
    }

    const currentDay = daysQueue.shift();
    if (!currentDay || processedDays.has(currentDay)) continue;
    processedDays.add(currentDay);

    if (currentDay !== targetDate) {
      cascadedDays.push(currentDay);
    }

    const result = shuffleSingleDay(
      currentDay,
      allTasks,
      allGroups,
      awakeHours,
      timezone,
      taskSlotOverrides,
      feedback
    );

    for (const moved of result.movedTasks) {
      // Update the overrides map so future days see the new position
      taskSlotOverrides.set(moved.taskId, {
        start: new Date(moved.newStart),
        end: new Date(moved.newEnd),
      });
      movedTasks.push(moved);
    }

    for (const nextDay of result.pushedToDays) {
      if (!processedDays.has(nextDay)) {
        daysQueue.push(nextDay);
      }
    }
  }

  if (movedTasks.length === 0) {
    feedback.push("No tasks needed shuffling.");
  } else {
    feedback.push(`Shuffled ${movedTasks.length} task(s).`);
  }

  return { movedTasks, feedback, cascadedDays };
}

/**
 * Get the effective scheduled start/end for a task, accounting for overrides from previous shuffles.
 */
function getEffectiveSlot(
  task: Task,
  overrides: Map<string, { start: Date; end: Date }>
): { start: Date; end: Date } | null {
  const override = overrides.get(task.id);
  if (override) return override;
  if (task.scheduled_start && task.scheduled_end) {
    return { start: new Date(task.scheduled_start), end: new Date(task.scheduled_end) };
  }
  return null;
}

/**
 * Parse a YYYY-MM-DD string into year/month/day numbers.
 */
function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month: month - 1, day }; // month is 0-indexed
}

/**
 * Check if a UTC Date falls on a given calendar date in the user's timezone.
 */
function isOnDay(
  utcDate: Date,
  targetYear: number,
  targetMonth: number,
  targetDay: number,
  timezone: string
): boolean {
  const tz = getTimeInTimezone(utcDate, timezone);
  return tz.year === targetYear && tz.month === targetMonth && tz.day === targetDay;
}

/**
 * Get the next calendar day as YYYY-MM-DD string.
 */
function getNextDayString(dateStr: string): string {
  const { year, month, day } = parseDateString(dateStr);
  const d = new Date(year, month, day + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Get the day-of-week name for a YYYY-MM-DD date.
 */
function getDayOfWeekForDate(dateStr: string): keyof GroupScheduleHours {
  const { year, month, day } = parseDateString(dateStr);
  const d = new Date(year, month, day);
  const days: (keyof GroupScheduleHours)[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return days[d.getDay()];
}

/**
 * Find the UTC Date that represents a specific hour:minute on a given calendar day in a timezone.
 */
function getUtcForTimezoneTime(
  dateStr: string,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const { year, month, day } = parseDateString(dateStr);
  return createDateInTimezone(new Date(year, month, day), hour, minute, timezone);
}

/**
 * Round a Date up to the next 15-minute boundary.
 */
function roundUpTo15Min(date: Date): Date {
  const ms = date.getTime();
  const fifteenMin = 15 * 60 * 1000;
  const remainder = ms % fifteenMin;
  if (remainder === 0) return new Date(ms);
  return new Date(ms + fifteenMin - remainder);
}

interface SingleDayShuffleResult {
  movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }>;
  pushedToDays: string[];
}

/**
 * Shuffle a single day: place all moveable tasks sequentially from the cursor,
 * skipping over fixed obstacles.
 */
function shuffleSingleDay(
  dayStr: string,
  allTasks: Task[],
  allGroups: TaskGroup[],
  awakeHours: GroupScheduleHours | null,
  timezone: string,
  taskSlotOverrides: Map<string, { start: Date; end: Date }>,
  feedback: string[]
): SingleDayShuffleResult {
  const movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }> = [];
  const pushedToDays: string[] = [];

  const { year: tYear, month: tMonth, day: tDay } = parseDateString(dayStr);

  // Gather tasks scheduled on this day (using effective slots with overrides)
  const dayTasks = allTasks.filter((t) => {
    const slot = getEffectiveSlot(t, taskSlotOverrides);
    if (!slot) return false;
    return isOnDay(slot.start, tYear, tMonth, tDay, timezone);
  });

  feedback.push(
    `[${dayStr}] Found ${dayTasks.length} task(s) on this day (from ${allTasks.length} total).`
  );

  // Separate into fixed and moveable
  const fixedTasks: Task[] = [];
  const moveableTasks: Task[] = [];

  for (const task of dayTasks) {
    // Completed/rescheduled tasks don't block scheduling - their time slots are free
    if (task.status === "completed" || task.status === "rescheduled") continue;

    const isFixed = task.locked || task.status === "in_progress" || task.status === "cancelled";

    if (isFixed) {
      fixedTasks.push(task);
    } else {
      // Use explicit duration, or compute from scheduled start/end
      let effectiveDuration = task.duration;
      if (
        (!effectiveDuration || effectiveDuration <= 0) &&
        task.scheduled_start &&
        task.scheduled_end
      ) {
        const start = new Date(task.scheduled_start);
        const end = new Date(task.scheduled_end);
        effectiveDuration = Math.round((end.getTime() - start.getTime()) / 60000);
      }

      if (effectiveDuration && effectiveDuration > 0) {
        // Temporarily patch duration so the placement logic can use it
        if (!task.duration || task.duration <= 0) {
          (task as any).duration = effectiveDuration;
        }
        moveableTasks.push(task);
      } else {
        feedback.push(`Skipped "${task.title}" (no duration set).`);
      }
    }
  }

  if (moveableTasks.length === 0) {
    feedback.push(
      `[${dayStr}] ${fixedTasks.length} fixed, 0 moveable. Statuses: ${dayTasks.map((t) => `${t.title.slice(0, 20)}=${t.status}/${t.locked ? "locked" : "unlocked"}`).join(", ")}`
    );
    return { movedTasks, pushedToDays };
  }

  // Sort moveable tasks by their current scheduled_start to preserve order
  moveableTasks.sort((a, b) => {
    const slotA = getEffectiveSlot(a, taskSlotOverrides);
    const slotB = getEffectiveSlot(b, taskSlotOverrides);
    const startA = slotA ? slotA.start.getTime() : 0;
    const startB = slotB ? slotB.start.getTime() : 0;
    if (startA !== startB) return startA - startB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Build obstacle list from fixed tasks
  const obstacles: Array<{ start: Date; end: Date }> = [];
  for (const t of fixedTasks) {
    const slot = getEffectiveSlot(t, taskSlotOverrides);
    if (slot) {
      obstacles.push({ start: slot.start, end: slot.end });
    }
  }
  obstacles.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Determine cursor start
  const nowUTC = new Date();
  const nowTz = getTimeInTimezone(nowUTC, timezone);
  const isToday = nowTz.year === tYear && nowTz.month === tMonth && nowTz.day === tDay;

  let cursor: Date;
  if (isToday) {
    cursor = roundUpTo15Min(nowUTC);
  } else {
    // Start of working hours for this day (use awake hours as default)
    const dayOfWeek = getDayOfWeekForDate(dayStr);
    const dayHours = getWorkingHoursForDay(dayOfWeek, awakeHours);
    if (dayHours) {
      cursor = getUtcForTimezoneTime(dayStr, dayHours.start, 0, timezone);
    } else {
      cursor = getUtcForTimezoneTime(dayStr, 9, 0, timezone);
    }
  }

  // Place each moveable task
  for (const task of moveableTasks) {
    // moveableTasks are filtered to only include tasks with duration > 0
    if (!task.duration || task.duration <= 0) continue;
    const durationMs = task.duration * 60 * 1000;

    // Determine this task's working hours (group hours > awake hours > default)
    const taskGroup = task.group_id ? allGroups.find((g) => g.id === task.group_id) : null;
    const useGroupHours = taskGroup?.auto_schedule_enabled && taskGroup?.auto_schedule_hours;
    const effectiveHours =
      useGroupHours && taskGroup?.auto_schedule_hours ? taskGroup.auto_schedule_hours : awakeHours;

    const dayOfWeek = getDayOfWeekForDate(dayStr);
    const dayHours = getWorkingHoursForDay(dayOfWeek, effectiveHours);

    if (!dayHours) {
      // This task's group doesn't allow work on this day
      const nextDay = findNextValidDayForGroup(dayStr, effectiveHours, 7);
      if (nextDay) {
        pushedToDays.push(nextDay);
        // Move task to start of working hours on that day
        const nextDayOfWeek = getDayOfWeekForDate(nextDay);
        const nextDayHours = getWorkingHoursForDay(nextDayOfWeek, effectiveHours);
        if (nextDayHours) {
          const newStart = getUtcForTimezoneTime(nextDay, nextDayHours.start, 0, timezone);
          const newEnd = new Date(newStart.getTime() + durationMs);
          movedTasks.push({
            taskId: task.id,
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
          });
          taskSlotOverrides.set(task.id, { start: newStart, end: newEnd });
        }
      } else {
        feedback.push(`Could not find a valid day for "${task.title}" within 7 days.`);
      }
      continue;
    }

    // Window boundaries for this day
    const windowStart = getUtcForTimezoneTime(dayStr, dayHours.start, 0, timezone);
    const windowEnd = getUtcForTimezoneTime(dayStr, dayHours.end, 0, timezone);

    // Effective cursor: max of global cursor and window start
    const effectiveCursor = new Date(Math.max(cursor.getTime(), windowStart.getTime()));

    // Find a slot in today's window
    const slot = findSlotInWindow(effectiveCursor, windowEnd, durationMs, obstacles);

    if (slot) {
      const currentSlot = getEffectiveSlot(task, taskSlotOverrides);
      const changed =
        !currentSlot || Math.abs(currentSlot.start.getTime() - slot.start.getTime()) > 60000;

      if (changed) {
        movedTasks.push({
          taskId: task.id,
          newStart: slot.start.toISOString(),
          newEnd: slot.end.toISOString(),
        });
        taskSlotOverrides.set(task.id, slot);
      }

      // Add this task as an obstacle for subsequent tasks
      obstacles.push(slot);
      obstacles.sort((a, b) => a.start.getTime() - b.start.getTime());

      // Advance cursor past this task
      cursor = new Date(Math.max(cursor.getTime(), slot.end.getTime()));
    } else {
      // No room today, push to next day
      const nextDay = findNextValidDayForGroup(dayStr, effectiveHours, 7);
      if (nextDay) {
        if (!pushedToDays.includes(nextDay)) {
          pushedToDays.push(nextDay);
        }
        const nextDayOfWeek = getDayOfWeekForDate(nextDay);
        const nextDayHours = getWorkingHoursForDay(nextDayOfWeek, effectiveHours);
        if (nextDayHours) {
          const newStart = getUtcForTimezoneTime(nextDay, nextDayHours.start, 0, timezone);
          const newEnd = new Date(newStart.getTime() + durationMs);
          movedTasks.push({
            taskId: task.id,
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
          });
          taskSlotOverrides.set(task.id, { start: newStart, end: newEnd });
        }
      } else {
        feedback.push(`Could not place "${task.title}" within the next 7 days.`);
      }
    }
  }

  return { movedTasks, pushedToDays };
}

/**
 * Find the next calendar day (after dayStr) that has working hours configured.
 */
function findNextValidDayForGroup(
  dayStr: string,
  hours: GroupScheduleHours | null,
  maxDays: number
): string | null {
  let current = dayStr;
  for (let i = 0; i < maxDays; i++) {
    current = getNextDayString(current);
    const dow = getDayOfWeekForDate(current);
    const dayHours = getWorkingHoursForDay(dow, hours);
    if (dayHours) return current;
  }
  return null;
}

/**
 * Find the first available slot within a time window, avoiding obstacles.
 */
function findSlotInWindow(
  windowStart: Date,
  windowEnd: Date,
  durationMs: number,
  obstacles: Array<{ start: Date; end: Date }>
): { start: Date; end: Date } | null {
  let candidateStart = roundUpTo15Min(windowStart);

  while (candidateStart.getTime() + durationMs <= windowEnd.getTime()) {
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);

    // Check against all obstacles
    let conflict: { start: Date; end: Date } | null = null;
    for (const obs of obstacles) {
      if (
        candidateStart.getTime() < obs.end.getTime() &&
        candidateEnd.getTime() > obs.start.getTime()
      ) {
        // Overlap found - pick the obstacle that ends latest
        if (!conflict || obs.end.getTime() > conflict.end.getTime()) {
          conflict = obs;
        }
      }
    }

    if (!conflict) {
      return { start: candidateStart, end: candidateEnd };
    }

    // Jump past the conflict
    candidateStart = roundUpTo15Min(conflict.end);
  }

  return null; // No space in this window
}

// ============================================================================
// PULL FORWARD TASKS FOR A GROUP
// ============================================================================

export interface PullForwardOptions {
  targetDate: string; // YYYY-MM-DD - the day to pull tasks INTO
  groupId: string;
  allTasks: Task[];
  allGroups: TaskGroup[];
  awakeHours: GroupScheduleHours | null;
  timezone: string;
  maxLookAheadDays?: number; // Default: 14
}

export interface PullForwardResult {
  movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }>;
  feedback: string[];
  error?: string;
}

/**
 * Pull forward tasks from future days into available slots on the target day
 * for a specific group. Used when you're ahead on a group and want to
 * bring future work into today's schedule.
 */
export function pullForwardTasksForGroup(options: PullForwardOptions): PullForwardResult {
  const {
    targetDate,
    groupId,
    allTasks,
    allGroups,
    awakeHours,
    timezone,
    maxLookAheadDays = 14,
  } = options;

  const feedback: string[] = [];
  const movedTasks: Array<{ taskId: string; newStart: string; newEnd: string }> = [];

  const { year: tYear, month: tMonth, day: tDay } = parseDateString(targetDate);
  const emptyOverrides = new Map<string, { start: Date; end: Date }>();

  // Find the group
  const group = allGroups.find((g) => g.id === groupId);
  if (!group) {
    feedback.push("Group not found.");
    return { movedTasks, feedback, error: "Group not found" };
  }

  // Determine working hours for the target day
  const useGroupHours = group.auto_schedule_enabled && group.auto_schedule_hours;
  const effectiveHours =
    useGroupHours && group.auto_schedule_hours ? group.auto_schedule_hours : awakeHours;
  const dayOfWeek = getDayOfWeekForDate(targetDate);
  const dayHours = getWorkingHoursForDay(dayOfWeek, effectiveHours);

  if (!dayHours) {
    feedback.push(`No working hours configured for ${dayOfWeek}.`);
    return { movedTasks, feedback };
  }

  const windowStart = getUtcForTimezoneTime(targetDate, dayHours.start, 0, timezone);
  const windowEnd = getUtcForTimezoneTime(targetDate, dayHours.end, 0, timezone);

  // For today, don't place tasks before now
  const nowUTC = new Date();
  const nowTz = getTimeInTimezone(nowUTC, timezone);
  const isToday = nowTz.year === tYear && nowTz.month === tMonth && nowTz.day === tDay;
  const effectiveWindowStart = isToday
    ? new Date(Math.max(roundUpTo15Min(nowUTC).getTime(), windowStart.getTime()))
    : windowStart;

  // Gather all tasks scheduled on the target day (regardless of group) as obstacles
  // Completed/rescheduled tasks don't block scheduling - their time slots are free
  const obstacles: Array<{ start: Date; end: Date }> = [];
  for (const t of allTasks) {
    if (t.status === "completed" || t.status === "rescheduled") continue;
    const slot = getEffectiveSlot(t, emptyOverrides);
    if (!slot) continue;
    if (!isOnDay(slot.start, tYear, tMonth, tDay, timezone)) continue;
    obstacles.push({ start: slot.start, end: slot.end });
  }
  obstacles.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find future tasks for this group that can be pulled forward
  // Sort by scheduled_start ASC (pull nearest future tasks first)
  const futureTasks = allTasks
    .filter((t) => {
      if (t.group_id !== groupId) return false;
      if (t.locked) return false;
      if (
        t.status === "completed" ||
        t.status === "in_progress" ||
        t.status === "cancelled" ||
        t.status === "rescheduled"
      )
        return false;
      if (!t.duration || t.duration <= 0) return false;
      if (!t.scheduled_start || !t.scheduled_end) return false;
      // Must be scheduled AFTER the target day
      const slot = getEffectiveSlot(t, emptyOverrides);
      if (!slot) return false;
      return (
        !isOnDay(slot.start, tYear, tMonth, tDay, timezone) &&
        slot.start.getTime() > windowStart.getTime()
      );
    })
    .sort((a, b) => {
      // futureTasks are filtered to only include tasks with scheduled_start
      if (!a.scheduled_start || !b.scheduled_start) return 0;
      const startA = new Date(a.scheduled_start).getTime();
      const startB = new Date(b.scheduled_start).getTime();
      return startA - startB;
    });

  // Cap the look-ahead: only pull from the next N days
  const maxDate = new Date(windowEnd);
  maxDate.setUTCDate(maxDate.getUTCDate() + maxLookAheadDays);
  const eligibleTasks = futureTasks.filter((t) => {
    // futureTasks are filtered to only include tasks with scheduled_start
    if (!t.scheduled_start) return false;
    const start = new Date(t.scheduled_start);
    return start.getTime() <= maxDate.getTime();
  });

  if (eligibleTasks.length === 0) {
    feedback.push(`No future tasks found for "${group.name}" to pull forward.`);
    return { movedTasks, feedback };
  }

  feedback.push(`Found ${eligibleTasks.length} future task(s) for "${group.name}".`);

  // Try to place each future task into today's available slots
  for (const task of eligibleTasks) {
    // eligibleTasks are filtered from futureTasks which only include tasks with duration > 0
    if (!task.duration || task.duration <= 0) continue;
    const durationMs = task.duration * 60 * 1000;

    const slot = findSlotInWindow(effectiveWindowStart, windowEnd, durationMs, obstacles);

    if (slot) {
      movedTasks.push({
        taskId: task.id,
        newStart: slot.start.toISOString(),
        newEnd: slot.end.toISOString(),
      });
      // Add this as an obstacle so subsequent tasks don't overlap
      obstacles.push(slot);
      obstacles.sort((a, b) => a.start.getTime() - b.start.getTime());
    } else {
      // No more room today
      feedback.push(`No more room today. Pulled ${movedTasks.length} task(s).`);
      break;
    }
  }

  if (movedTasks.length === 0) {
    feedback.push("No available slots on this day to fit future tasks.");
  } else {
    feedback.push(`Pulled ${movedTasks.length} task(s) forward to ${targetDate}.`);
  }

  return { movedTasks, feedback };
}
