import type { GroupScheduleHours, Task } from "@/lib/types";

interface TimeSlot {
  start: Date;
  end: Date;
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
 * @returns Time slot in UTC or null if no slot found
 */
export function findNearestAvailableSlot(
  task: Task,
  existingTasks: Task[],
  startFrom: Date = new Date(),
  workingHours: GroupScheduleHours | null = null,
  maxDaysAhead: number = 7,
  timezone: string = "UTC"
): TimeSlot | null {
  if (!task.duration || task.duration <= 0) {
    return null;
  }

  const durationMs = task.duration * 60 * 1000; // Convert minutes to milliseconds

  // All times are in UTC from here on
  const nowUTC = new Date();
  const maxSearchTime = new Date(startFrom);
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
  const getTimeInTimezone = (utcDate: Date): {
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

  // Helper: Check if a UTC time falls within working hours in the user's timezone
  const isWithinWorkingHours = (utcDate: Date): boolean => {
    const tzTime = getTimeInTimezone(utcDate);
    const dayHours = getWorkingHoursForDay(tzTime.dayOfWeek);
    if (!dayHours) {
      return false;
    }
    const hour = tzTime.hour;
    const minute = tzTime.minute;
    const timeInMinutes = hour * 60 + minute;
    const startInMinutes = dayHours.start * 60;
    const endInMinutes = dayHours.end * 60;
    return timeInMinutes >= startInMinutes && timeInMinutes < endInMinutes;
  };

  // Start searching from startFrom (UTC), but not before now
  // Round to next 15-minute interval in UTC
  let currentTimeUTC = new Date(Math.max(startFrom.getTime(), nowUTC.getTime()));
  const currentMinutes = currentTimeUTC.getUTCMinutes();
  const currentSeconds = currentTimeUTC.getUTCSeconds();
  const currentMs = currentTimeUTC.getUTCMilliseconds();
  // Round up to next 15-minute mark
  const roundedMinutes = Math.ceil(currentMinutes / 15) * 15;
  if (roundedMinutes >= 60) {
    currentTimeUTC.setUTCHours(currentTimeUTC.getUTCHours() + 1, 0, 0, 0);
  } else {
    currentTimeUTC.setUTCMinutes(roundedMinutes, 0, 0);
  }

  // Search slot by slot (in 15-minute intervals in UTC)
  const intervalMs = 15 * 60 * 1000; // 15 minutes in milliseconds

  while (currentTimeUTC < maxSearchTime) {
    let slotStartUTC = new Date(currentTimeUTC);
    const slotEndUTC = new Date(slotStartUTC.getTime() + durationMs);

    // Get what day/time this slot represents in user's timezone
    const slotTzTime = getTimeInTimezone(slotStartUTC);
    const dayHours = getWorkingHoursForDay(slotTzTime.dayOfWeek);

    // Skip this day if it has no working hours configured
    if (!dayHours) {
      // Move to start of next day - find when the next day starts in user's timezone
      // Add 24 hours and search for the next midnight in timezone
      let nextDay = new Date(slotStartUTC);
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
    const isInWorkingHours = slotTimeInMinutes >= startInMinutes && slotTimeInMinutes < endInMinutes;

    if (!isInWorkingHours) {
      // Not in working hours - only allow if it's today and before 11 PM
      if (!isToday || slotTimeInMinutes >= 23 * 60) {
        // Move to next day
        let nextDay = new Date(slotStartUTC);
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
    }

    // Check if slot end is within working hours (or same day if after hours today)
    const slotEndTzTime = getTimeInTimezone(slotEndUTC);
    const slotEndTimeInMinutes = slotEndTzTime.hour * 60 + slotEndTzTime.minute;
    const endIsInWorkingHours = slotEndTimeInMinutes >= startInMinutes && slotEndTimeInMinutes <= endInMinutes;
    const endIsToday =
      slotEndTzTime.year === nowTzTime.year &&
      slotEndTzTime.month === nowTzTime.month &&
      slotEndTzTime.day === nowTzTime.day;

    if (!endIsInWorkingHours && (!endIsToday || slotEndTzTime.hour >= 23)) {
      // Can't fit, move to next day
      let nextDay = new Date(slotStartUTC);
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
      const hasOverlap = 
        (ourStart < theirEnd && ourEnd > theirStart); // Standard overlap check
      
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
