import { createDateInTimezone } from "@/lib/timezone-utils";
import type { Task } from "@/lib/types";

interface TimeSlot {
  start: Date;
  end: Date;
}

/**
 * Find the nearest available time slot for a task
 * @param task The task to schedule
 * @param existingTasks All existing scheduled tasks
 * @param startFrom The earliest time to start searching from (in UTC)
 * @param workingHoursStart Default 9 AM (in user's timezone)
 * @param workingHoursEnd Default 5 PM (in user's timezone)
 * @param maxDaysAhead Maximum days to search ahead (default 7)
 * @param timezone User's timezone (default UTC)
 * @returns Time slot or null if no slot found
 */
export function findNearestAvailableSlot(
  task: Task,
  existingTasks: Task[],
  startFrom: Date = new Date(),
  workingHoursStart: number = 9,
  workingHoursEnd: number = 17,
  maxDaysAhead: number = 7,
  timezone: string = "UTC"
): TimeSlot | null {
  if (!task.duration || task.duration <= 0) {
    return null;
  }

  const durationMs = task.duration * 60 * 1000; // Convert minutes to milliseconds
  const maxSearchTime = new Date(startFrom);
  maxSearchTime.setDate(maxSearchTime.getDate() + maxDaysAhead);

  // Get all scheduled time slots from existing tasks (excluding the current task)
  const scheduledSlots: TimeSlot[] = existingTasks
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

  // Helper to get what a date represents in the user's timezone
  const getDateInTimezone = (
    date: Date
  ): { year: number; month: number; day: number; hour: number; minute: number } => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    return {
      year: parseInt(parts.find((p) => p.type === "year")?.value || "0", 10),
      month: parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1,
      day: parseInt(parts.find((p) => p.type === "day")?.value || "0", 10),
      hour: parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10),
      minute: parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10),
    };
  };

  // Helper to create a date at a specific hour in user's timezone using the existing utility
  const _createDateAtHour = (day: Date, hour: number, minute: number): Date => {
    return createDateInTimezone(day, hour, minute, timezone);
  };

  // Get current time in user's timezone (once, outside the loop)
  const now = new Date();
  const nowInTz = getDateInTimezone(now);
  // Create "now" as it appears in user's timezone
  // Use today's date and the current hour/minute in the timezone
  const today = new Date();
  const nowDate = createDateInTimezone(today, nowInTz.hour, nowInTz.minute, timezone);

  // Start searching from the provided start time, but ensure we don't start in the past
  let currentTime = new Date(startFrom);

  // Always start from "now" (in user's timezone) if startFrom is in the past
  // This ensures we check today first before moving to tomorrow
  if (currentTime < nowDate) {
    currentTime = new Date(nowDate);
  }

  // Get initial date components in user's timezone
  let _currentInTz = getDateInTimezone(currentTime);

  // Helper to check if a date is "today" in user's timezone
  const isTodayInTimezone = (date: Date): boolean => {
    const dateInTz = getDateInTimezone(date);
    return (
      dateInTz.year === nowInTz.year &&
      dateInTz.month === nowInTz.month &&
      dateInTz.day === nowInTz.day
    );
  };

  // Search day by day
  while (currentTime < maxSearchTime) {
    // Create day start and end using the current date in user's timezone
    // createDateInTimezone takes a Date object and interprets what date it represents in the timezone
    const dayStart = createDateInTimezone(currentTime, workingHoursStart, 0, timezone);
    const dayEnd = createDateInTimezone(currentTime, workingHoursEnd, 0, timezone);

    // Start from the later of: current time or day start
    let slotStart = currentTime > dayStart ? new Date(currentTime) : new Date(dayStart);

    // Check if we're on the same day as "now"
    const isToday = isTodayInTimezone(slotStart);

    // If we're past working hours, allow scheduling today up to 11 PM if it's today
    // Otherwise, move to next day
    if (slotStart >= dayEnd) {
      if (isToday) {
        // Allow scheduling today after working hours, up to 11 PM
        // Use "now" to get today's date in the timezone, not currentTime
        const todayEnd = createDateInTimezone(now, 23, 0, timezone); // 11 PM today
        if (slotStart < todayEnd && slotStart.getTime() + durationMs <= todayEnd.getTime()) {
          // Can schedule today after hours, continue with current slotStart
          // Don't skip to rounding yet - we'll handle it below
        } else {
          // Can't fit today, move to next day
          const tomorrow = new Date(currentTime);
          tomorrow.setDate(tomorrow.getDate() + 1);
          currentTime = createDateInTimezone(tomorrow, workingHoursStart, 0, timezone);
          _currentInTz = getDateInTimezone(currentTime);
          continue;
        }
      } else {
        // Not today, move to next day at working hours start
        const tomorrow = new Date(currentTime);
        tomorrow.setDate(tomorrow.getDate() + 1);
        currentTime = createDateInTimezone(tomorrow, workingHoursStart, 0, timezone);
        _currentInTz = getDateInTimezone(currentTime);
        continue;
      }
    }

    // Round up to the next 15-minute interval if we're not at a clean boundary
    // This makes scheduling more natural (e.g., 2:37 PM -> 2:45 PM)
    // But we need to round in the user's timezone, not UTC
    const slotStartInTz = getDateInTimezone(slotStart);
    const currentMinutes = slotStartInTz.minute;
    const currentSeconds = slotStart.getSeconds(); // Seconds are the same regardless of timezone

    if (currentMinutes % 15 !== 0 || currentSeconds > 0) {
      const roundedMinutes = Math.ceil(currentMinutes / 15) * 15;
      // Recreate the slot start with rounded minutes in user's timezone
      slotStart = createDateInTimezone(slotStart, slotStartInTz.hour, roundedMinutes, timezone);
      // Check if rounding pushed us past the hour
      const roundedInTz = getDateInTimezone(slotStart);
      if (roundedInTz.minute >= 60) {
        // Move to next hour
        slotStart = createDateInTimezone(slotStart, roundedInTz.hour + 1, 0, timezone);
      }
    }

    // Re-check if still today after rounding (in case rounding moved us to next day)
    const isStillToday = isTodayInTimezone(slotStart);

    // Check if we can fit the task in the remaining day
    // Use 11 PM as the end of day if we're scheduling after hours today, otherwise use dayEnd
    const effectiveDayEnd =
      isStillToday && slotStart >= dayEnd
        ? createDateInTimezone(now, 23, 0, timezone) // 11 PM today (use "now" to get today's date)
        : dayEnd;

    if (slotStart.getTime() + durationMs > effectiveDayEnd.getTime()) {
      // Move to next day
      const tomorrow = new Date(currentTime);
      tomorrow.setDate(tomorrow.getDate() + 1);
      currentTime = createDateInTimezone(tomorrow, workingHoursStart, 0, timezone);
      _currentInTz = getDateInTimezone(currentTime);
      continue;
    }

    // Check for conflicts with existing scheduled tasks
    let hasConflict = false;
    const slotEnd = new Date(slotStart.getTime() + durationMs);

    for (const scheduledSlot of scheduledSlots) {
      // Check if there's any overlap
      if (
        (slotStart >= scheduledSlot.start && slotStart < scheduledSlot.end) ||
        (slotEnd > scheduledSlot.start && slotEnd <= scheduledSlot.end) ||
        (slotStart <= scheduledSlot.start && slotEnd >= scheduledSlot.end)
      ) {
        hasConflict = true;
        // Move to the end of this conflicting slot
        slotStart = new Date(scheduledSlot.end);
        break;
      }
    }

    if (!hasConflict) {
      // Found an available slot!
      return {
        start: slotStart,
        end: slotEnd,
      };
    }

    // Update currentTime to continue searching from the new slotStart
    currentTime = slotStart;
  }

  // No slot found within the search window
  return null;
}
