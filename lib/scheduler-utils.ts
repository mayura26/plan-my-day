import { createDateInTimezone } from "@/lib/timezone-utils";
import type { GroupScheduleHours, Task, TaskGroup } from "@/lib/types";

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
        t.status !== "cancelled" // Don't check conflicts with cancelled tasks
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

  // Get all scheduled tasks (excluding the one being rescheduled, completed, and cancelled)
  const scheduledTasks = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      t.scheduled_start &&
      t.scheduled_end &&
      t.status !== "completed" &&
      t.status !== "cancelled"
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
        otherTask.status === "cancelled"
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
 */
export type SchedulingMode = "now" | "today" | "next-week" | "next-month" | "asap";

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
        t.status !== "cancelled"
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

    // Get timezone info for this slot
    const slotTzTime = getTimeInTimezone(slotStartUTC, timezone);
    const dayHours = getHoursForDay(slotTzTime.dayOfWeek);

    // Skip days with no hours configured (unless today mode with preferGroupRules)
    if (!dayHours) {
      if (mustBeToday && preferGroupRules) {
        // For today mode with preferGroupRules, fall back to awake hours
        const awakeDayHours = awakeHours?.[slotTzTime.dayOfWeek as keyof GroupScheduleHours];
        if (awakeDayHours && awakeDayHours !== null) {
          // Use awake hours instead
          const timeInMinutes = slotTzTime.hour * 60 + slotTzTime.minute;
          const awakeStart = awakeDayHours.start * 60;
          const awakeEnd = awakeDayHours.end * 60;

          // Check if within awake hours
          if (timeInMinutes >= awakeStart && timeInMinutes < awakeEnd) {
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
              reportProgress("Found available slot using awake hours");
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

    // For today mode with preferGroupRules, allow outside group hours but check awake hours
    if (!isInHours) {
      if (mustBeToday && preferGroupRules && useGroupRules) {
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

      if (isToday && slotTimeInMinutes >= endInMinutes) {
        // After hours today - jump to start of next day with hours
        const nextDay = new Date(slotStartUTC);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
          const candidateDay = new Date(nextDay);
          candidateDay.setUTCDate(candidateDay.getUTCDate() + dayOffset);
          const candidateTz = getTimeInTimezone(candidateDay, timezone);
          const candidateDayHours = getHoursForDay(candidateTz.dayOfWeek);
          if (candidateDayHours) {
            for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
              const candidate = new Date(candidateDay.getTime() + offsetHours * 60 * 60 * 1000);
              const candidateTzTime = getTimeInTimezone(candidate, timezone);
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
            const checkTzTime = getTimeInTimezone(currentTimeUTC, timezone);
            if (
              checkTzTime.year === candidateTz.year &&
              checkTzTime.month === candidateTz.month &&
              checkTzTime.day === candidateTz.day &&
              checkTzTime.hour === candidateDayHours.start
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
        // Move to start of next day
        const nextDay = new Date(slotStartUTC);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
          const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
          const candidateTz = getTimeInTimezone(candidate, timezone);
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
        if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
          currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
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
      for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
        const candidate = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
        const candidateTz = getTimeInTimezone(candidate, timezone);
        if (candidateTz.hour === dayHours.start && candidateTz.minute === 0) {
          currentTimeUTC = candidate;
          currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
          break;
        }
      }
      if (currentTimeUTC.getTime() <= slotStartUTC.getTime()) {
        currentTimeUTC = new Date(slotStartUTC.getTime() + 24 * 60 * 60 * 1000);
        currentTimeUTC.setUTCMinutes(Math.floor(currentTimeUTC.getUTCMinutes() / 15) * 15, 0, 0);
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
      t.status !== "cancelled"
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
        otherTask.status === "cancelled"
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
