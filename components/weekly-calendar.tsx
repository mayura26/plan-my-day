"use client";

import { addDays, addWeeks, format, isSameDay, parseISO, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Menu, StickyNote } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarSlot } from "@/components/calendar-slot";
import { ResizableTask } from "@/components/calendar-task";
import { Button } from "@/components/ui/button";
import {
  formatDateInTimezone,
  getDateInTimezone,
  getHoursAndMinutesInTimezone,
} from "@/lib/timezone-utils";
import type { DayNote, Task, TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WeeklyCalendarProps {
  tasks: Task[];
  timezone: string;
  onTaskClick?: (taskId: string) => void;
  onTaskSchedule?: (taskId: string, day: Date, time: number) => void;
  onTaskReschedule?: (taskId: string, day: Date, time: number) => void;
  onTaskResize?: (taskId: string, newEndTime: Date) => void;
  activeDragId?: string | null;
  resizingTaskId?: string | null;
  selectedGroupId?: string | null;
  groups?: TaskGroup[];
  onSidebarToggle?: () => void;
  mobileViewToggleButtons?: React.ReactNode;
  desktopViewToggleButtons?: React.ReactNode;
  dayNotes?: Map<string, DayNote>;
  onNoteClick?: (date: Date) => void;
  onSlotDoubleClick?: (day: Date, hour: number, minute: number) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0-23 hours
const WEEK_DAYS = 7;

// Create 15-minute interval slots (4 slots per hour: 0, 15, 30, 45 minutes)
const TIME_SLOTS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hour = Math.floor(i / 4);
  const minute = (i % 4) * 15;
  return { hour, minute, slotIndex: i };
});

export function WeeklyCalendar({
  tasks,
  timezone,
  onTaskClick,
  onTaskSchedule,
  onTaskReschedule,
  onTaskResize,
  activeDragId,
  resizingTaskId,
  selectedGroupId,
  groups = [],
  onSidebarToggle,
  mobileViewToggleButtons,
  desktopViewToggleButtons,
  dayNotes = new Map(),
  onNoteClick,
  onSlotDoubleClick,
}: WeeklyCalendarProps) {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const horizontalScrollContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 }); // Start on Monday

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  // Sync horizontal scroll between header and grid
  useEffect(() => {
    const calendarEl = calendarScrollRef.current;
    const headerEl = headerScrollRef.current;
    if (!calendarEl || !headerEl) return;

    const handleCalendarScroll = () => {
      if (headerEl.scrollLeft !== calendarEl.scrollLeft) {
        headerEl.scrollLeft = calendarEl.scrollLeft;
      }
    };

    const handleHeaderScroll = () => {
      if (calendarEl.scrollLeft !== headerEl.scrollLeft) {
        calendarEl.scrollLeft = headerEl.scrollLeft;
      }
    };

    calendarEl.addEventListener("scroll", handleCalendarScroll);
    headerEl.addEventListener("scroll", handleHeaderScroll);

    return () => {
      calendarEl.removeEventListener("scroll", handleCalendarScroll);
      headerEl.removeEventListener("scroll", handleHeaderScroll);
    };
  }, []);

  // Auto-scroll to current time and current day on initial mount only
  useLayoutEffect(() => {
    if (
      !calendarScrollRef.current ||
      !horizontalScrollContainerRef.current ||
      hasAutoScrolledRef.current
    )
      return;

    const now = new Date();
    const { hour, minute } = getHoursAndMinutesInTimezone(now, timezone);
    const totalMinutes = hour * 60 + minute;

    // Scroll vertically to current time
    // Each hour is 64px (h-16 = 4rem = 64px)
    const pixelsPerMinute = 64 / 60;
    const scrollPosition = totalMinutes * pixelsPerMinute;

    // Offset to center the current time in view (subtract half viewport height)
    const offset = calendarScrollRef.current.clientHeight / 2;

    calendarScrollRef.current.scrollTop = scrollPosition - offset;

    // Scroll horizontally to current day
    const weekDays = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i));
    const today = getDateInTimezone(now, timezone);
    const todayIndex = weekDays.findIndex((day) => {
      const dayDate = getDateInTimezone(day, timezone);
      return isSameDay(dayDate, today);
    });

    if (todayIndex >= 0) {
      // Calculate the width of one day column
      // On mobile, each column is calc((100vw-60px)/3), so we calculate dynamically
      const gridContainer = calendarScrollRef.current.querySelector(".grid") as HTMLElement;
      if (gridContainer && headerScrollRef.current) {
        const gridWidth = gridContainer.scrollWidth;
        const viewportWidth = calendarScrollRef.current.clientWidth;
        const timeColumnWidth = 60; // 60px on mobile, 80px on desktop (use smaller for mobile calculation)
        const dayColumnWidth = (gridWidth - timeColumnWidth) / 7;
        // Center the current day in the viewport
        const scrollToPosition =
          timeColumnWidth + dayColumnWidth * todayIndex - viewportWidth / 2 + dayColumnWidth / 2;

        // Scroll both header and grid to current day
        calendarScrollRef.current.scrollLeft = Math.max(0, scrollToPosition);
        headerScrollRef.current.scrollLeft = calendarScrollRef.current.scrollLeft;
      }
    }

    hasAutoScrolledRef.current = true;
  }, [timezone, weekStart]);

  const getWeekDays = () => {
    // Create days - these represent dates as the user sees them
    // The createDateInTimezone function will extract the correct date components
    // from these Date objects as they appear in the user's timezone
    return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i));
  };

  const _getTasksForDayAndHour = (day: Date, hour: number) => {
    return tasks.filter((task) => {
      if (!task.scheduled_start || !task.scheduled_end) return false;

      const taskStartUTC = parseISO(task.scheduled_start);
      const taskStartDate = getDateInTimezone(taskStartUTC, timezone);
      const dayDate = getDateInTimezone(day, timezone);

      // Check if task starts on the same day (comparing dates in user's timezone)
      if (!isSameDay(taskStartDate, dayDate)) return false;

      const { hour: taskStartHour } = getHoursAndMinutesInTimezone(taskStartUTC, timezone);
      const { hour: taskEndHour } = getHoursAndMinutesInTimezone(
        parseISO(task.scheduled_end),
        timezone
      );

      return (taskStartHour <= hour && taskEndHour > hour) || taskStartHour === hour;
    });
  };

  const getTaskPosition = (task: Task) => {
    if (!task.scheduled_start || !task.scheduled_end) return null;

    // Ensure we have a valid timezone
    const userTimezone = timezone || "UTC";

    const taskStartUTC = parseISO(task.scheduled_start);
    const taskEndUTC = parseISO(task.scheduled_end);

    // Verify the Date objects are valid
    if (Number.isNaN(taskStartUTC.getTime()) || Number.isNaN(taskEndUTC.getTime())) {
      console.error("Invalid date for task:", task.id, task.scheduled_start, task.scheduled_end);
      return null;
    }

    // Get the time in the user's timezone
    const { hour: startHour, minute: startMinute } = getHoursAndMinutesInTimezone(
      taskStartUTC,
      userTimezone
    );
    const { hour: endHour, minute: endMinute } = getHoursAndMinutesInTimezone(
      taskEndUTC,
      userTimezone
    );

    // Calculate total minutes from midnight
    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + endMinute;
    const durationMinutes = endTotalMinutes - startTotalMinutes;

    // Calculate percentage position
    // The hour labels span 24 hours (1536px = 24 * 64px)
    // The slots span from 0:15 to 23:45 (95 slots = 1520px = 95 * 16px)
    // Tasks are positioned relative to the hour labels container (24 hours)
    // So we calculate percentage based on full 24-hour day
    const topPercentage = (startTotalMinutes / (24 * 60)) * 100;
    const heightPercentage = (durationMinutes / (24 * 60)) * 100;

    // Debug logging for future dates
    const today = new Date();
    const _isFutureDate = taskStartUTC > today;

    return {
      top: `${topPercentage}%`,
      height: `${heightPercentage}%`,
      startHour,
      endHour,
    };
  };

  const formatTime = (hour: number) => {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  const goToPreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const goToToday = () => {
    setCurrentWeek(new Date());
  };

  const getCurrentTimePosition = () => {
    const { hour, minute } = getHoursAndMinutesInTimezone(currentTime, timezone);
    const totalMinutes = hour * 60 + minute;
    const percentage = (totalMinutes / (24 * 60)) * 100;
    return `${percentage}%`;
  };

  const weekDays = getWeekDays();

  return (
    <div className="flex flex-col h-full">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          {/* Mobile sidebar toggle button */}
          {onSidebarToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onSidebarToggle}
              className="md:hidden h-10 w-10 flex-shrink-0"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h2 className="text-xl md:text-2xl font-bold truncate">
            {/* Mobile: short month */}
            <span className="md:hidden">
              {formatDateInTimezone(weekStart, timezone, { month: "short", year: "numeric" })}
            </span>
            {/* Desktop: long month */}
            <span className="hidden md:inline">
              {formatDateInTimezone(weekStart, timezone, { month: "long", year: "numeric" })}
            </span>
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
            className="hidden sm:inline-flex flex-shrink-0"
          >
            Today
          </Button>
          {/* View toggle buttons - mobile (abbreviated) */}
          {mobileViewToggleButtons && (
            <div className="flex items-center gap-1 ml-auto sm:ml-2 flex-shrink-0 md:hidden">
              {mobileViewToggleButtons}
            </div>
          )}
          {/* View toggle buttons - desktop (full text) */}
          {desktopViewToggleButtons && (
            <div className="hidden md:flex items-center gap-1 ml-auto sm:ml-2 flex-shrink-0">
              {desktopViewToggleButtons}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={goToPreviousWeek} className="h-10 w-10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextWeek} className="h-10 w-10">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable container for header and grid */}
      <div ref={horizontalScrollContainerRef} className="flex-1 flex flex-col overflow-hidden">
        {/* Days Header - horizontally scrollable */}
        <div
          ref={headerScrollRef}
          className="overflow-x-auto overflow-y-hidden border-b bg-muted/30 scrollbar-hide"
        >
          <div className="grid grid-cols-[60px_repeat(7,calc((100vw-60px)/3))] md:grid-cols-[80px_repeat(7,1fr)] md:min-w-0">
            <div className="p-2"></div>
            {weekDays.map((day, index) => {
              const dayDate = getDateInTimezone(day, timezone);
              const todayDate = getDateInTimezone(new Date(), timezone);
              const isToday = isSameDay(dayDate, todayDate);
              const dateKey = format(dayDate, "yyyy-MM-dd");
              const _hasNote = dayNotes.has(dateKey);
              return (
                <div
                  key={index}
                  className={cn("p-2 text-center border-l relative", isToday && "bg-primary/10")}
                >
                  {onNoteClick && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "absolute top-1 right-1 h-5 w-5 md:h-6 md:w-6 p-1",
                        "bg-muted/50 hover:bg-muted",
                        "border border-white/20 dark:border-gray-700/50"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNoteClick(dayDate);
                      }}
                    >
                      <StickyNote className="h-3 w-3 md:h-3.5 md:w-3.5" />
                    </Button>
                  )}
                  <div className={cn("text-xs md:text-sm font-medium", isToday && "text-primary")}>
                    {formatDateInTimezone(day, timezone, { weekday: "short" })}
                  </div>
                  <div className="flex items-center justify-center mt-1">
                    <div
                      className={cn(
                        "text-lg md:text-2xl font-bold",
                        isToday &&
                          "bg-primary text-primary-foreground rounded-full w-8 h-8 md:w-10 md:h-10 flex items-center justify-center"
                      )}
                    >
                      {formatDateInTimezone(day, timezone, { day: "numeric" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Calendar Grid - horizontally and vertically scrollable */}
        <div ref={calendarScrollRef} className="flex-1 overflow-auto">
          <div className="relative md:min-w-0">
            {/* Time column and day columns */}
            <div className="grid grid-cols-[60px_repeat(7,calc((100vw-60px)/3))] md:grid-cols-[80px_repeat(7,1fr)]">
              {/* Time labels */}
              <div className="border-r sticky left-0 z-10 bg-background">
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="h-16 border-b-2 border-border px-1 md:px-2 text-xs text-muted-foreground flex items-center"
                  >
                    <span className="hidden sm:inline">{formatTime(hour)}</span>
                    <span className="sm:hidden">
                      {hour === 0 ? "12" : hour > 12 ? hour - 12 : hour}
                      {hour >= 12 ? "p" : "a"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((day, dayIndex) => (
                <div
                  key={dayIndex}
                  className="relative border-l"
                  style={{ height: "1536px" }}
                  data-day-column={dayIndex}
                >
                  {/* 15-minute interval slots with drop zones */}
                  {TIME_SLOTS.slice(1).map(({ hour, minute, slotIndex }) => (
                    <CalendarSlot
                      key={slotIndex}
                      day={day}
                      hour={hour}
                      minute={minute}
                      onDoubleClick={onSlotDoubleClick}
                    />
                  ))}

                  {/* Current time indicator (red line) */}
                  {isSameDay(
                    getDateInTimezone(day, timezone),
                    getDateInTimezone(new Date(), timezone)
                  ) && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none z-20"
                      style={{ top: getCurrentTimePosition() }}
                    >
                      <div className="relative">
                        {/* Red dot */}
                        <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
                        {/* Red line */}
                        <div className="h-0.5 bg-red-500 shadow-sm" />
                      </div>
                    </div>
                  )}

                  {/* Tasks overlay */}
                  {/* Position explicitly at top of day column with explicit height to match hour labels */}
                  <div
                    className="absolute top-0 left-0 right-0 pointer-events-none"
                    style={{ height: "1536px" }}
                  >
                    {tasks
                      .filter((task) => {
                        if (!task.scheduled_start) return false;
                        const taskStartUTC = parseISO(task.scheduled_start);
                        const taskStartDate = getDateInTimezone(taskStartUTC, timezone);
                        const dayDate = getDateInTimezone(day, timezone);
                        const matches = isSameDay(taskStartDate, dayDate);

                        return matches;
                      })
                      .map((task) => {
                        const position = getTaskPosition(task);
                        if (!position) return null;

                        return (
                          <ResizableTask
                            key={task.id}
                            task={task}
                            position={position}
                            onTaskClick={onTaskClick}
                            onResize={onTaskResize}
                            activeDragId={activeDragId}
                            resizingTaskId={resizingTaskId}
                            selectedGroupId={selectedGroupId}
                            groups={groups}
                            timezone={timezone}
                          />
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
