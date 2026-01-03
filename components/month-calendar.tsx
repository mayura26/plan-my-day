"use client";

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Menu, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { RefreshButton } from "@/components/refresh-button";
import { Button } from "@/components/ui/button";
import { getEnergyLevelColor, isTaskOverdue } from "@/lib/task-utils";
import { formatDateInTimezone, formatTimeShort, getDateInTimezone } from "@/lib/timezone-utils";
import type { Task, TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MonthCalendarProps {
  tasks: Task[];
  timezone: string;
  onTaskClick?: (taskId: string) => void;
  groups?: TaskGroup[];
  onSidebarToggle?: () => void;
  currentDate?: Date;
  onDateChange?: (date: Date) => void;
  onDateClick?: (date: Date) => void;
  mobileViewToggleButtons?: React.ReactNode;
  desktopViewToggleButtons?: React.ReactNode;
  onRefresh?: () => void | Promise<void>;
}

const WEEK_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function MonthCalendar({
  tasks,
  timezone,
  onTaskClick,
  groups = [],
  onSidebarToggle,
  currentDate: externalCurrentDate,
  onDateChange,
  onDateClick,
  mobileViewToggleButtons,
  desktopViewToggleButtons,
  onRefresh,
}: MonthCalendarProps) {
  const [currentDate, setCurrentDate] = useState(externalCurrentDate || new Date());

  // Sync with external currentDate if provided
  useEffect(() => {
    if (externalCurrentDate && !isSameMonth(currentDate, externalCurrentDate)) {
      setCurrentDate(externalCurrentDate);
    }
  }, [externalCurrentDate, currentDate]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // Start on Sunday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const getTasksForDate = (date: Date): Task[] => {
    const dateInTimezone = getDateInTimezone(date, timezone);
    return tasks.filter((task) => {
      if (!task.scheduled_start) return false;
      const taskStartUTC = parseISO(task.scheduled_start);
      const taskStartDate = getDateInTimezone(taskStartUTC, timezone);
      return isSameDay(taskStartDate, dateInTimezone);
    });
  };

  const goToPreviousMonth = () => {
    const newDate = subMonths(currentDate, 1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  const goToNextMonth = () => {
    const newDate = addMonths(currentDate, 1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    onDateChange?.(today);
  };

  const handleDateClick = (date: Date) => {
    if (onDateClick) {
      onDateClick(date);
    }
  };

  // Generate calendar days
  const calendarDays: Date[] = [];
  let day = calendarStart;
  while (day <= calendarEnd) {
    calendarDays.push(day);
    day = addDays(day, 1);
  }

  // Organize days into weeks
  const weeks: Date[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  const _today = new Date();

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
              {formatDateInTimezone(monthStart, timezone, { month: "short", year: "numeric" })}
            </span>
            {/* Desktop: long month */}
            <span className="hidden md:inline">
              {formatDateInTimezone(monthStart, timezone, { month: "long", year: "numeric" })}
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
          <Button variant="ghost" size="icon" onClick={goToPreviousMonth} className="h-10 w-10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextMonth} className="h-10 w-10">
            <ChevronRight className="h-4 w-4" />
          </Button>
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
      <div className="flex-1 overflow-x-auto overflow-y-auto p-4">
        {/* Weekday Headers - Mobile: 3 columns visible, Desktop: 7 columns */}
        <div
          className="grid grid-cols-[repeat(7,calc((100vw-2rem)/3))] md:grid-cols-7 gap-1 mb-2"
          style={{ minWidth: "max-content" }}
        >
          {WEEK_DAYS.map((day) => (
            <div
              key={day}
              className="text-center text-xs md:text-sm font-medium text-muted-foreground p-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days - Mobile: 3 columns visible with horizontal scroll, Desktop: 7 columns */}
        <div
          className="grid grid-cols-[repeat(7,calc((100vw-2rem)/3))] md:grid-cols-7 gap-1"
          style={{ minWidth: "max-content" }}
        >
          {calendarDays.map((day, index) => {
            const dayTasks = getTasksForDate(day);
            const dateInTimezone = getDateInTimezone(day, timezone);
            const currentDateInTimezone = getDateInTimezone(currentDate, timezone);
            const isCurrentMonth = isSameMonth(dateInTimezone, currentDateInTimezone);
            const todayDate = getDateInTimezone(new Date(), timezone);
            const isCurrentDay = isSameDay(dateInTimezone, todayDate);
            const dayKey = `month-day-${day.getTime()}-${index}`;

            return (
              // biome-ignore lint/a11y/useSemanticElements: Calendar cell requires div for complex layout and interactions
              <div
                key={dayKey}
                role="button"
                tabIndex={0}
                className={cn(
                  "min-h-[100px] md:min-h-[120px] border rounded-md p-1.5 md:p-2 cursor-pointer transition-colors",
                  !isCurrentMonth && "opacity-40 bg-muted/30",
                  isCurrentMonth && "bg-background",
                  isCurrentDay && "ring-2 ring-primary"
                )}
                onClick={() => handleDateClick(dateInTimezone)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleDateClick(dateInTimezone);
                  }
                }}
              >
                {/* Date Number */}
                <div
                  className={cn(
                    "text-xs md:text-base font-bold mb-1 flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-full",
                    isCurrentDay && "bg-primary text-primary-foreground",
                    !isCurrentDay && isCurrentMonth && "text-foreground",
                    !isCurrentMonth && "text-muted-foreground"
                  )}
                >
                  {formatDateInTimezone(day, timezone, { day: "numeric" })}
                </div>

                {/* Tasks List */}
                <div className="space-y-0.5 md:space-y-1">
                  {dayTasks.slice(0, 5).map((task) => {
                    const group = task.group_id ? groups.find((g) => g.id === task.group_id) : null;
                    const groupColor = group?.color || null;
                    const isEvent = task.task_type === "event";
                    const isCompleted = task.status === "completed";
                    const _isOverdue = !isCompleted && isTaskOverdue(task);

                    return (
                      // biome-ignore lint/a11y/useSemanticElements: Task item requires div for complex styling and layout
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "text-[9px] md:text-xs p-0.5 md:p-1 rounded truncate cursor-pointer hover:opacity-80 transition-opacity",
                          "flex items-center gap-0.5 md:gap-1 relative",
                          groupColor && "text-white"
                        )}
                        style={
                          groupColor
                            ? { backgroundColor: groupColor }
                            : { backgroundColor: "rgb(107 114 128 / 0.4)" }
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onTaskClick?.(task.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onTaskClick?.(task.id);
                          }
                        }}
                      >
                        <span
                          className={cn(
                            "flex-shrink-0",
                            isEvent
                              ? "w-1.5 h-1.5 md:w-2 md:h-2 border border-white rounded-full"
                              : "w-1.5 h-1.5 md:w-2 md:h-2 bg-white rounded-full"
                          )}
                        />
                        {task.scheduled_start && (
                          <span className="font-medium text-[8px] md:text-xs">
                            {formatTimeShort(task.scheduled_start, timezone)}
                          </span>
                        )}
                        <span className="truncate flex-1 text-[8px] md:text-xs">{task.title}</span>
                        {/* Energy indicator at right */}
                        {task.energy_level_required && (
                          <span
                            className={cn(
                              "text-[7px] md:text-xs flex items-center gap-0.5 flex-shrink-0 px-1 md:px-1.5 py-0 md:py-0.5 rounded-full",
                              getEnergyLevelColor(task.energy_level_required)
                            )}
                            style={{
                              backgroundColor: "rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            <Zap className="w-2 h-2 md:w-3 md:h-3" />
                            <span className="text-[7px] md:text-[10px]">
                              {task.energy_level_required}
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {dayTasks.length > 5 && (
                    <div className="text-[8px] md:text-xs text-muted-foreground px-1">
                      +{dayTasks.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
