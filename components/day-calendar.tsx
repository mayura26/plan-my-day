"use client";

import { addDays, isSameDay, parseISO, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, Menu, StickyNote } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarSlot } from "@/components/calendar-slot";
import { ResizableTask, TaskSegmentBlock } from "@/components/calendar-task";
import { RefreshButton } from "@/components/refresh-button";
import { ShuffleButton } from "@/components/shuffle-button";
import { Button } from "@/components/ui/button";
import {
  calculateHostSegments,
  detectNestedTasks,
  doTasksOverlap,
  type TaskSegment,
} from "@/lib/overlap-utils";
import { sortTasksByScheduledTime } from "@/lib/task-utils";
import {
  formatDateInTimezone,
  getDateInTimezone,
  getHoursAndMinutesInTimezone,
} from "@/lib/timezone-utils";
import type { Task, TaskGroup } from "@/lib/types";

interface DayCalendarProps {
  tasks: Task[];
  timezone: string;
  onTaskClick?: (taskId: string) => void;
  activeDragId?: string | null;
  resizingTaskId?: string | null;
  selectedGroupId?: string | null;
  groups?: TaskGroup[];
  onSidebarToggle?: () => void;
  currentDate?: Date;
  onDateChange?: (date: Date) => void;
  mobileViewToggleButtons?: React.ReactNode;
  desktopViewToggleButtons?: React.ReactNode;
  onNoteClick?: (date: Date) => void;
  onSlotDoubleClick?: (day: Date, hour: number, minute: number) => void;
  onRefresh?: () => void | Promise<void>;
  onShuffle?: () => void | Promise<void>;
  onOverlapClick?: (taskId: string) => void;
  parentTasksMap?: Map<string, string>;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0-23 hours

// Create 15-minute interval slots (4 slots per hour: 0, 15, 30, 45 minutes)
const TIME_SLOTS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hour = Math.floor(i / 4);
  const minute = (i % 4) * 15;
  return { hour, minute, slotIndex: i };
});

export function DayCalendar({
  tasks,
  timezone,
  onTaskClick,
  activeDragId,
  resizingTaskId,
  selectedGroupId,
  groups = [],
  onSidebarToggle,
  currentDate: externalCurrentDate,
  onDateChange,
  mobileViewToggleButtons,
  desktopViewToggleButtons,
  onNoteClick,
  onSlotDoubleClick,
  onRefresh,
  onShuffle,
  onOverlapClick,
  parentTasksMap,
}: DayCalendarProps) {
  const [currentDate, setCurrentDate] = useState(externalCurrentDate || new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);

  // Sync with external currentDate if provided
  useEffect(() => {
    if (externalCurrentDate) {
      setCurrentDate(externalCurrentDate);
    }
  }, [externalCurrentDate]);

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  // Auto-scroll to current time on initial mount only - use useLayoutEffect to set scroll before paint
  useLayoutEffect(() => {
    if (!calendarScrollRef.current || hasAutoScrolledRef.current) return;

    const now = new Date();
    const { hour, minute } = getHoursAndMinutesInTimezone(now, timezone);
    const totalMinutes = hour * 60 + minute;

    // Each hour is 64px (h-16 = 4rem = 64px)
    const pixelsPerMinute = 64 / 60;
    const scrollPosition = totalMinutes * pixelsPerMinute;

    // Offset to center the current time in view (subtract half viewport height)
    const offset = calendarScrollRef.current.clientHeight / 2;

    calendarScrollRef.current.scrollTop = scrollPosition - offset;
    hasAutoScrolledRef.current = true;
  }, [timezone]);

  const getTaskPosition = (task: Task) => {
    if (!task.scheduled_start || !task.scheduled_end) return null;

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
      timezone
    );
    const { hour: endHour, minute: endMinute } = getHoursAndMinutesInTimezone(taskEndUTC, timezone);

    // Calculate total minutes from midnight
    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + endMinute;
    const durationMinutes = endTotalMinutes - startTotalMinutes;

    // Ensure duration is positive
    if (durationMinutes <= 0) {
      console.error("Invalid duration for task:", task.id, "duration:", durationMinutes);
      return null;
    }

    // Calculate percentage position (0% = midnight, 100% = next midnight)
    // Since slots start at 0:15 (slice(1)), tasks before 0:15 will be positioned above the grid
    // but that's fine - they'll just be off-screen
    const topPercentage = (startTotalMinutes / (24 * 60)) * 100;
    const heightPercentage = (durationMinutes / (24 * 60)) * 100;

    return {
      top: `${topPercentage}%`,
      height: `${heightPercentage}%`,
      startHour,
      endHour,
    };
  };

  const getSegmentPosition = (segment: TaskSegment) => {
    try {
      const start = parseISO(segment.segmentStart);
      const end = parseISO(segment.segmentEnd);
      const { hour: sh, minute: sm } = getHoursAndMinutesInTimezone(start, timezone);
      const { hour: eh, minute: em } = getHoursAndMinutesInTimezone(end, timezone);
      const startMin = sh * 60 + sm;
      const durMin = eh * 60 + em - startMin;
      if (durMin <= 0) return null;
      return {
        top: `${(startMin / (24 * 60)) * 100}%`,
        height: `${(durMin / (24 * 60)) * 100}%`,
      };
    } catch {
      return null;
    }
  };

  const formatTime = (hour: number) => {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  const goToPreviousDay = () => {
    const newDate = subDays(currentDate, 1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  const goToNextDay = () => {
    const newDate = addDays(currentDate, 1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  const goToToday = () => {
    const today = getDateInTimezone(new Date(), timezone);
    setCurrentDate(today);
    onDateChange?.(today);
  };

  const getCurrentTimePosition = () => {
    const { hour, minute } = getHoursAndMinutesInTimezone(currentTime, timezone);
    const totalMinutes = hour * 60 + minute;
    const percentage = (totalMinutes / (24 * 60)) * 100;
    return `${percentage}%`;
  };

  const dayDate = getDateInTimezone(currentDate, timezone);
  const todayDate = getDateInTimezone(new Date(), timezone);

  return (
    <div className="flex flex-col h-full">
      {/* Calendar Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between p-4 border-b gap-2 md:gap-0">
        {/* First row on mobile: Date, Add button, and navigation arrows */}
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
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold truncate">
              {formatDateInTimezone(currentDate, timezone, { weekday: "short" })}{" "}
              {formatDateInTimezone(currentDate, timezone, { day: "numeric" })}{" "}
              {/* Mobile: short month */}
              <span className="md:hidden">
                {formatDateInTimezone(currentDate, timezone, { month: "short" })}
              </span>
              {/* Desktop: long month */}
              <span className="hidden md:inline">
                {formatDateInTimezone(currentDate, timezone, { month: "long" })}
              </span>
            </h2>
            {onNoteClick && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-muted/50 hover:bg-muted border border-white/20 dark:border-gray-700/50 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onNoteClick(dayDate);
                }}
              >
                <StickyNote className="h-4 w-4 mr-1.5" />
                Add
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 md:hidden">
            <Button variant="ghost" size="icon" onClick={goToPreviousDay} className="h-10 w-10">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={goToNextDay} className="h-10 w-10">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {onShuffle && (
              <ShuffleButton
                onShuffle={onShuffle}
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                aria-label="Shuffle tasks"
              />
            )}
            {onRefresh && (
              <RefreshButton
                onRefresh={onRefresh}
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                aria-label="Refresh calendar"
              />
            )}
          </div>
        </div>
        {/* Second row on mobile: Today button and view toggles */}
        <div className="flex items-center justify-end md:justify-end gap-2 md:flex-1 md:min-w-0">
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
            <div className="flex items-center gap-1 flex-shrink-0 md:hidden">
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
        {/* Desktop navigation arrows */}
        <div className="hidden md:flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={goToPreviousDay} className="h-10 w-10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextDay} className="h-10 w-10">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {onShuffle && (
            <ShuffleButton
              onShuffle={onShuffle}
              size="icon"
              variant="ghost"
              className="h-10 w-10"
              aria-label="Shuffle tasks"
            />
          )}
          {onRefresh && (
            <RefreshButton
              onRefresh={onRefresh}
              size="icon"
              variant="ghost"
              className="h-10 w-10"
              aria-label="Refresh calendar"
            />
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div ref={calendarScrollRef} className="flex-1 overflow-auto">
        <div className="relative md:min-w-0">
          {/* Time column and day column */}
          <div className="grid grid-cols-[60px_1fr] md:grid-cols-[80px_1fr]">
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

            {/* Day column */}
            <div className="relative border-l" style={{ height: "1536px" }}>
              {/* 15-minute interval slots with drop zones */}
              {TIME_SLOTS.slice(1).map(({ hour, minute, slotIndex }) => (
                <CalendarSlot
                  key={slotIndex}
                  day={currentDate}
                  hour={hour}
                  minute={minute}
                  onDoubleClick={onSlotDoubleClick}
                />
              ))}

              {/* Tasks overlay - explicitly positioned relative to parent */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              >
                {(() => {
                  // Filter tasks for the current day
                  const dayTasks = tasks.filter((task) => {
                    if (!task.scheduled_start) return false;
                    const taskStartUTC = parseISO(task.scheduled_start);
                    const taskStartDate = getDateInTimezone(taskStartUTC, timezone);
                    return isSameDay(taskStartDate, dayDate);
                  });

                  // Separate active and completed tasks
                  const activeTasks = dayTasks.filter((t) => t.status !== "completed");
                  const completedTasks = dayTasks.filter((t) => t.status === "completed");

                  // Filter completed tasks: hide if they overlap with any active task
                  const visibleCompletedTasks = completedTasks.filter((completed) => {
                    return !activeTasks.some((active) => doTasksOverlap(active, completed));
                  });

                  // Combine active tasks with visible completed tasks
                  const tasksToRender = [...activeTasks, ...visibleCompletedTasks];

                  // Build overlap map for active tasks
                  const overlapMap = new Map<string, Task[]>();
                  for (const activeTask of activeTasks) {
                    const overlappingCompleted = completedTasks.filter((completed) =>
                      doTasksOverlap(activeTask, completed)
                    );
                    if (overlappingCompleted.length > 0) {
                      overlapMap.set(activeTask.id, overlappingCompleted);
                    }
                  }

                  // Sort tasks by scheduled time to ensure consistent rendering order
                  const sortedTasks = sortTasksByScheduledTime(tasksToRender);

                  // Detect nested task relationships among active tasks
                  const { hostToGuests, guestIds } = detectNestedTasks(activeTasks);

                  // Render each task — hosts split into segments, guests float on top
                  return sortedTasks.flatMap((task) => {
                    const overlappingCompletedTasks = overlapMap.get(task.id) || [];
                    const isHost = hostToGuests.has(task.id);
                    const isGuest = guestIds.has(task.id);

                    if (isHost) {
                      const guests = hostToGuests.get(task.id) ?? [];
                      const segments = calculateHostSegments(task, guests);
                      if (segments.length === 0) return [];
                      return segments.flatMap((segment) => {
                        const segPos = getSegmentPosition(segment);
                        if (!segPos) return [];
                        return [
                          <TaskSegmentBlock
                            key={`${task.id}-seg-${segment.segmentIndex}`}
                            task={task}
                            position={segPos}
                            segment={segment}
                            onTaskClick={onTaskClick}
                            selectedGroupId={selectedGroupId}
                            groups={groups}
                          />,
                        ];
                      });
                    }

                    const position = getTaskPosition(task);
                    if (!position) return [];

                    return [
                      <ResizableTask
                        key={task.id}
                        task={task}
                        position={position}
                        onTaskClick={onTaskClick}
                        activeDragId={activeDragId}
                        resizingTaskId={resizingTaskId}
                        selectedGroupId={selectedGroupId}
                        groups={groups}
                        timezone={timezone}
                        overlappingCompletedTasks={overlappingCompletedTasks}
                        onOverlapClick={onOverlapClick}
                        parentTaskName={
                          task.parent_task_id ? parentTasksMap?.get(task.parent_task_id) : null
                        }
                        isNested={isGuest}
                      />,
                    ];
                  });
                })()}
              </div>

              {/* Current time indicator (red line) - rendered after tasks to ensure it appears on top */}
              {isSameDay(dayDate, todayDate) && (
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
