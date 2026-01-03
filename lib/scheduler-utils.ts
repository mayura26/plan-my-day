import { createDateInTimezone } from "@/lib/timezone-utils";
import type { GroupScheduleHours, Task } from "@/lib/types";

interface TimeSlot {
  start: Date;
  end: Date;
}

/**
 * Find the nearest available time slot for a task
 * All date math is done in UTC. Working hours are converted to UTC boundaries for each day.
 *
 * @param task The task to schedule
 * @param existingTasks All existing scheduled tasks (scheduled_start/end are in UTC)
 * @param startFrom The earliest time to start searching from (in UTC)
 * @param workingHours Per-day working hours configuration (defaults to 9-17 for all days if not provided)
 * @param maxDaysAhead Maximum days to search ahead (default 7)
 * @param timezone User's timezone (used only to convert working hours to UTC)
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
  maxSearchTime.setDate(maxSearchTime.getDate() + maxDaysAhead);

  // Get all scheduled time slots from existing tasks (all UTC)
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

  // Helper: Get what date a UTC timestamp represents in the user's timezone
  const getDateInTimezone = (utcDate: Date): { year: number; month: number; day: number } => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(utcDate);
    return {
      year: parseInt(parts.find((p) => p.type === "year")?.value || "0", 10),
      month: parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1,
      day: parseInt(parts.find((p) => p.type === "day")?.value || "0", 10),
    };
  };

  // Helper: Get day of week name from a UTC date (in user's timezone)
  const getDayOfWeek = (
    utcDate: Date
  ): "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    });
    const dayName = formatter.format(utcDate).toLowerCase() as
      | "monday"
      | "tuesday"
      | "wednesday"
      | "thursday"
      | "friday"
      | "saturday"
      | "sunday";
    return dayName;
  };

  // Helper: Get working hours for a specific day (defaults to 9-17 if not configured)
  const getWorkingHoursForDay = (day: string): { start: number; end: number } => {
    const daySchedule = workingHours?.[day as keyof GroupScheduleHours];
    if (daySchedule && daySchedule !== null) {
      return daySchedule;
    }
    // Default to 9 AM - 5 PM if not configured
    return { start: 9, end: 17 };
  };

  // Helper: Get working hours boundaries in UTC for a specific UTC date
  // Returns { dayStartUTC, dayEndUTC } where dayStart/End are the working hours in UTC
  // Returns null if the day has no working hours configured
  const getWorkingHoursInUTC = (utcDate: Date): { dayStartUTC: Date; dayEndUTC: Date } | null => {
    // Get what date this UTC timestamp represents in user's timezone
    const _dateInTz = getDateInTimezone(utcDate);
    const dayOfWeek = getDayOfWeek(utcDate);
    const dayHours = getWorkingHoursForDay(dayOfWeek);

    // Create a Date object representing this date at the working hours start/end in the timezone
    const dayStartUTC = createDateInTimezone(utcDate, dayHours.start, 0, timezone);
    const dayEndUTC = createDateInTimezone(utcDate, dayHours.end, 0, timezone);

    return { dayStartUTC, dayEndUTC };
  };

  // Start searching from startFrom (UTC), but not before now
  let currentTimeUTC = new Date(Math.max(startFrom.getTime(), nowUTC.getTime()));

  // Search day by day
  while (currentTimeUTC < maxSearchTime) {
    // Get working hours boundaries for this day in UTC
    const dayWorkingHours = getWorkingHoursInUTC(currentTimeUTC);

    // Skip days with no working hours configured
    if (!dayWorkingHours) {
      // Move to next day at midnight in user's timezone
      const nextDayUTC = new Date(currentTimeUTC);
      nextDayUTC.setTime(nextDayUTC.getTime() + 24 * 60 * 60 * 1000);
      const nextDayStart = createDateInTimezone(nextDayUTC, 0, 0, timezone);
      currentTimeUTC = new Date(nextDayStart);
      continue;
    }

    const { dayStartUTC, dayEndUTC } = dayWorkingHours;

    // Start from the later of: current time or day start
    let slotStartUTC =
      currentTimeUTC > dayStartUTC ? new Date(currentTimeUTC) : new Date(dayStartUTC);

    // Check if we're past working hours
    if (slotStartUTC >= dayEndUTC) {
      // Check if this is "today" in user's timezone - allow after-hours scheduling up to 11 PM
      const nowDateInTz = getDateInTimezone(nowUTC);
      const slotDateInTz = getDateInTimezone(slotStartUTC);
      const isToday =
        nowDateInTz.year === slotDateInTz.year &&
        nowDateInTz.month === slotDateInTz.month &&
        nowDateInTz.day === slotDateInTz.day;

      if (isToday) {
        // Allow scheduling today after working hours, up to 11 PM in user's timezone
        const todayEndUTC = createDateInTimezone(nowUTC, 23, 0, timezone);
        if (slotStartUTC.getTime() + durationMs > todayEndUTC.getTime()) {
          // Can't fit today, move to next day
          const nextDayUTC = new Date(dayEndUTC);
          nextDayUTC.setTime(nextDayUTC.getTime() + 24 * 60 * 60 * 1000); // Add 24 hours
          const nextDayStart = createDateInTimezone(nextDayUTC, 0, 0, timezone);
          currentTimeUTC = new Date(nextDayStart);
          continue;
        }
        // Can schedule today after hours, continue with current slotStartUTC
      } else {
        // Not today, move to next day
        const nextDayUTC = new Date(dayEndUTC);
        nextDayUTC.setTime(nextDayUTC.getTime() + 24 * 60 * 60 * 1000); // Add 24 hours
        const nextDayStart = createDateInTimezone(nextDayUTC, 0, 0, timezone);
        currentTimeUTC = new Date(nextDayStart);
        continue;
      }
    }

    // Round up to the next 15-minute interval if needed
    // We need to round in user's timezone, so convert to timezone, round, convert back
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(slotStartUTC);
    const hourInTz = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minuteInTz = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const secondsUTC = slotStartUTC.getUTCSeconds();

    if (minuteInTz % 15 !== 0 || secondsUTC > 0) {
      const roundedMinutes = Math.ceil(minuteInTz / 15) * 15;
      let roundedHour = hourInTz;
      if (roundedMinutes >= 60) {
        roundedHour = (roundedHour + 1) % 24;
        const roundedMinutesAdj = roundedMinutes % 60;
        slotStartUTC = createDateInTimezone(slotStartUTC, roundedHour, roundedMinutesAdj, timezone);
      } else {
        slotStartUTC = createDateInTimezone(slotStartUTC, roundedHour, roundedMinutes, timezone);
      }
    }

    // Re-check if still within working hours after rounding
    const roundedDayWorkingHours = getWorkingHoursInUTC(slotStartUTC);
    if (!roundedDayWorkingHours) {
      // Move to next day
      const nextDayUTC = new Date(slotStartUTC);
      nextDayUTC.setTime(nextDayUTC.getTime() + 24 * 60 * 60 * 1000);
      const nextDayStart = createDateInTimezone(nextDayUTC, 0, 0, timezone);
      currentTimeUTC = new Date(nextDayStart);
      continue;
    }
    const { dayEndUTC: roundedDayEnd } = roundedDayWorkingHours;
    const nowDateInTz = getDateInTimezone(nowUTC);
    const slotDateInTz = getDateInTimezone(slotStartUTC);
    const isStillToday =
      nowDateInTz.year === slotDateInTz.year &&
      nowDateInTz.month === slotDateInTz.month &&
      nowDateInTz.day === slotDateInTz.day;

    // Use 11 PM as end if after hours today, otherwise use working hours end
    const effectiveDayEndUTC =
      isStillToday && slotStartUTC >= roundedDayEnd
        ? createDateInTimezone(nowUTC, 23, 0, timezone)
        : roundedDayEnd;

    if (slotStartUTC.getTime() + durationMs > effectiveDayEndUTC.getTime()) {
      // Move to next day
      const nextDayUTC = new Date(roundedDayEnd);
      nextDayUTC.setTime(nextDayUTC.getTime() + 24 * 60 * 60 * 1000); // Add 24 hours
      const nextDayStart = createDateInTimezone(nextDayUTC, 0, 0, timezone);
      currentTimeUTC = new Date(nextDayStart);
      continue;
    }

    // Check for conflicts with existing scheduled tasks (all UTC)
    let hasConflict = false;
    const slotEndUTC = new Date(slotStartUTC.getTime() + durationMs);

    for (const scheduledSlot of scheduledSlots) {
      // Check if there's any overlap (all times are UTC)
      if (
        (slotStartUTC >= scheduledSlot.start && slotStartUTC < scheduledSlot.end) ||
        (slotEndUTC > scheduledSlot.start && slotEndUTC <= scheduledSlot.end) ||
        (slotStartUTC <= scheduledSlot.start && slotEndUTC >= scheduledSlot.end)
      ) {
        hasConflict = true;
        // Move to the end of this conflicting slot
        slotStartUTC = new Date(scheduledSlot.end);
        break;
      }
    }

    if (!hasConflict) {
      // Found an available slot! Return in UTC
      return {
        start: slotStartUTC,
        end: slotEndUTC,
      };
    }

    // Update currentTime to continue searching from the new slotStart
    currentTimeUTC = slotStartUTC;
  }

  // No slot found within the search window
  return null;
}
