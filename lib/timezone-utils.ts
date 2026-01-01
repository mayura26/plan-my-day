/**
 * Timezone utility functions for formatting dates in user's preferred timezone
 */

/**
 * Get a list of common timezones with their display names
 */
export const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
  { value: "America/Toronto", label: "Eastern Time - Toronto" },
  { value: "America/Vancouver", label: "Pacific Time - Vancouver" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Rome", label: "Rome (CET/CEST)" },
  { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "Mumbai (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEDT/AEST)" },
  { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
] as const;

/**
 * Get user's timezone preference or default to UTC
 */
export function getUserTimezone(userTimezone?: string | null): string {
  return userTimezone || "UTC";
}

/**
 * Format a date in the user's preferred timezone
 * @param date - Date object or ISO string
 * @param timezone - User's timezone preference
 * @param options - Intl.DateTimeFormatOptions
 */
export function formatDateInTimezone(
  date: Date | string,
  timezone: string = "UTC",
  options: Intl.DateTimeFormatOptions = {}
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options,
  }).format(dateObj);
}

/**
 * Format a date as a short date string (e.g., "12/25/2024")
 */
export function formatDateShort(date: Date | string, timezone: string = "UTC"): string {
  return formatDateInTimezone(date, timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Format a time as a short time string (e.g., "2:30 PM")
 */
export function formatTimeShort(date: Date | string, timezone: string = "UTC"): string {
  return formatDateInTimezone(date, timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Get hours and minutes from a date in a specific timezone
 * Returns an object with hour (0-23) and minute (0-59)
 */
export function getHoursAndMinutesInTimezone(
  date: Date | string,
  timezone: string = "UTC"
): { hour: number; minute: number } {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  return { hour, minute };
}

/**
 * Get the date (year, month, day) from a date in a specific timezone
 * Returns a Date object representing the date at midnight in that timezone
 */
export function getDateInTimezone(date: Date | string, timezone: string = "UTC"): Date {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(dateObj);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);

  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Format a date and time together (e.g., "12/25/2024, 2:30 PM")
 */
export function formatDateTime(date: Date | string, timezone: string = "UTC"): string {
  return formatDateInTimezone(date, timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format a date with full date and time (e.g., "December 25, 2024 at 2:30 PM")
 */
export function formatDateTimeFull(date: Date | string, timezone: string = "UTC"): string {
  return formatDateInTimezone(date, timezone, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format a date range (e.g., "2:30 PM - 4:00 PM")
 */
export function formatTimeRange(
  startDate: Date | string,
  endDate: Date | string,
  timezone: string = "UTC"
): string {
  const start = formatTimeShort(startDate, timezone);
  const end = formatTimeShort(endDate, timezone);
  return `${start} - ${end}`;
}

/**
 * Get the current time in the specified timezone
 */
export function getCurrentTimeInTimezone(timezone: string = "UTC"): Date {
  const now = new Date();
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

  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  return new Date(year, month, day, hour, minute, second);
}

/**
 * Convert a date from one timezone to another (returns ISO string in target timezone)
 * Note: This is a helper for display purposes. Dates are stored in UTC in the database.
 */
export function convertToTimezone(date: Date | string, targetTimezone: string): Date {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Get the date string in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: targetTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  return new Date(year, month, day, hour, minute, second);
}

/**
 * Create a UTC Date object from a date and time in a specific timezone
 * This is used when scheduling tasks - the user selects a time in their timezone,
 * and we need to convert it to UTC for storage in the database.
 *
 * @param day - The date component (Date object representing a day, will extract year/month/day as they appear in the timezone)
 * @param hours - Hours in the target timezone (0-23)
 * @param minutes - Minutes (0-59)
 * @param timezone - The timezone of the input day/hours/minutes
 * @returns A Date object in UTC representing the requested time in the target timezone
 */
export function createDateInTimezone(
  day: Date,
  hours: number,
  minutes: number,
  timezone: string
): Date {
  // First, get what date the 'day' Date object represents in the target timezone
  // The day Date object might be in browser's local timezone, so we need to see what date it represents in the user's timezone
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const dayParts = dateFormatter.formatToParts(day);
  const year = parseInt(dayParts.find((p) => p.type === "year")?.value || "0", 10);
  const month = parseInt(dayParts.find((p) => p.type === "month")?.value || "0", 10) - 1;
  const date = parseInt(dayParts.find((p) => p.type === "day")?.value || "0", 10);

  // Debug logging for future dates
  const today = new Date();
  const isFutureDate = day > today;
  if (isFutureDate && hours >= 17) {
    console.log("createDateInTimezone - extracting date:", {
      inputDay: day.toISOString(),
      inputDayLocal: day.toString(),
      timezone,
      extractedYear: year,
      extractedMonth: month + 1,
      extractedDate: date,
      targetHours: hours,
      targetMinutes: minutes,
      dayParts: dayParts.map((p) => `${p.type}: ${p.value}`),
    });
  }

  // Now find the UTC timestamp that represents midnight (00:00) on this date in the target timezone
  // Then add hours and minutes to get the final time

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Search for midnight in the target timezone for this date
  // We need to find the UTC timestamp that represents 00:00 on this date in the target timezone
  // Search in a wider range to handle all timezones (UTC-12 to UTC+14)
  const baseUTC = new Date(Date.UTC(year, month, date, 12, 0, 0, 0)); // Start at noon UTC on the target date

  // First, try a quick search around the expected time
  for (let offsetHours = -14; offsetHours <= 14; offsetHours++) {
    const testTime = new Date(baseUTC.getTime() + offsetHours * 60 * 60 * 1000);
    const parts = timeFormatter.formatToParts(testTime);
    const tzYear = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
    const tzMonth = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
    const tzDate = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
    const tzHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const tzMinute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

    // Check if this is midnight (00:00) on our target date in the timezone
    if (tzYear === year && tzMonth === month && tzDate === date && tzHour === 0 && tzMinute === 0) {
      // Found midnight! Now add the hours and minutes
      const result = new Date(testTime.getTime() + hours * 60 * 60000 + minutes * 60000);

      // Verify the result is correct
      const verifyParts = timeFormatter.formatToParts(result);
      const vTzYear = parseInt(verifyParts.find((p) => p.type === "year")?.value || "0", 10);
      const vTzMonth = parseInt(verifyParts.find((p) => p.type === "month")?.value || "0", 10) - 1;
      const vTzDate = parseInt(verifyParts.find((p) => p.type === "day")?.value || "0", 10);
      const vTzHour = parseInt(verifyParts.find((p) => p.type === "hour")?.value || "0", 10);
      const vTzMinute = parseInt(verifyParts.find((p) => p.type === "minute")?.value || "0", 10);

      if (
        vTzYear === year &&
        vTzMonth === month &&
        vTzDate === date &&
        vTzHour === hours &&
        vTzMinute === minutes
      ) {
        if (isFutureDate) {
          console.log("createDateInTimezone - found match (quick search):", {
            resultUTC: result.toISOString(),
            resultLocal: result.toString(),
            verifiedTzTime: `${vTzHour}:${vTzMinute.toString().padStart(2, "0")}`,
            expectedTzTime: `${hours}:${minutes.toString().padStart(2, "0")}`,
          });
        }
        return result;
      }
    }
  }

  // If we didn't find midnight with the quick search, do a more thorough hour-by-hour search
  // Search from 24 hours before to 24 hours after the base time
  let searchStart = new Date(baseUTC.getTime() - 24 * 60 * 60 * 1000);
  for (let i = 0; i < 48; i++) {
    const parts = timeFormatter.formatToParts(searchStart);
    const tzYear = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
    const tzMonth = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10) - 1;
    const tzDate = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);
    const tzHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const tzMinute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

    if (tzYear === year && tzMonth === month && tzDate === date && tzHour === 0 && tzMinute === 0) {
      // Found midnight! Now add the hours and minutes
      const result = new Date(searchStart.getTime() + hours * 60 * 60000 + minutes * 60000);

      // Verify the result
      const verifyParts = timeFormatter.formatToParts(result);
      const vTzYear = parseInt(verifyParts.find((p) => p.type === "year")?.value || "0", 10);
      const vTzMonth = parseInt(verifyParts.find((p) => p.type === "month")?.value || "0", 10) - 1;
      const vTzDate = parseInt(verifyParts.find((p) => p.type === "day")?.value || "0", 10);
      const vTzHour = parseInt(verifyParts.find((p) => p.type === "hour")?.value || "0", 10);
      const vTzMinute = parseInt(verifyParts.find((p) => p.type === "minute")?.value || "0", 10);

      if (
        vTzYear === year &&
        vTzMonth === month &&
        vTzDate === date &&
        vTzHour === hours &&
        vTzMinute === minutes
      ) {
        return result;
      }
    }

    searchStart = new Date(searchStart.getTime() + 60 * 60000); // Try next hour
  }

  // Last resort fallback: use a simple UTC calculation
  // This won't be timezone-aware but should at least not be wildly wrong
  console.warn(
    `Could not find exact timezone match for ${year}-${month + 1}-${date} ${hours}:${minutes} in ${timezone}, using fallback`
  );
  return new Date(Date.UTC(year, month, date, hours, minutes, 0, 0));
}

/**
 * Convert a UTC ISO datetime string to datetime-local format in a specific timezone
 * This is used for displaying dates in HTML datetime-local inputs
 *
 * @param isoString - UTC ISO datetime string (e.g., "2025-12-22T13:15:00Z")
 * @param timezone - The timezone to display the date in
 * @returns datetime-local format string (e.g., "2025-12-22T08:15")
 */
export function formatDateTimeLocalForTimezone(
  isoString: string | null | undefined,
  timezone: string = "UTC"
): string {
  if (!isoString) return "";

  try {
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value || "0";
    const month = parts.find((p) => p.type === "month")?.value || "0";
    const day = parts.find((p) => p.type === "day")?.value || "0";
    const hour = parts.find((p) => p.type === "hour")?.value || "0";
    const minute = parts.find((p) => p.type === "minute")?.value || "0";

    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return "";
  }
}

/**
 * Convert a datetime-local string (in a specific timezone) to UTC ISO string
 * This is used when submitting forms - the user enters a time in their timezone,
 * and we need to convert it to UTC for database storage.
 *
 * @param datetimeLocal - datetime-local format string (e.g., "2025-12-22T08:15")
 * @param timezone - The timezone that the datetime-local string represents
 * @returns UTC ISO datetime string (e.g., "2025-12-22T13:15:00.000Z")
 */
export function parseDateTimeLocalToUTC(
  datetimeLocal: string | null | undefined,
  timezone: string = "UTC"
): string | undefined {
  if (!datetimeLocal) return undefined;

  try {
    // Parse the datetime-local string (format: "YYYY-MM-DDTHH:mm")
    const match = datetimeLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
      console.error("Invalid datetime-local format:", datetimeLocal);
      return undefined;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);

    // Create a Date object representing the date at midnight in the timezone
    // We'll use this to find the correct UTC timestamp
    const dayDate = new Date(year, month, day);

    // Use createDateInTimezone to convert the time in the user's timezone to UTC
    const utcDate = createDateInTimezone(dayDate, hours, minutes, timezone);

    return utcDate.toISOString();
  } catch (error) {
    console.error("Error parsing datetime-local to UTC:", error);
    return undefined;
  }
}
