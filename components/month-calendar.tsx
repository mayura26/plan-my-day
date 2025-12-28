'use client'

import { useState, useEffect } from 'react'
import { Task, TaskGroup } from '@/lib/types'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameDay, isSameMonth, parseISO, isToday } from 'date-fns'
import { useUserTimezone } from '@/hooks/use-user-timezone'
import { formatTimeShort, getDateInTimezone, formatDateInTimezone } from '@/lib/timezone-utils'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface MonthCalendarProps {
  tasks: Task[]
  onTaskClick?: (taskId: string) => void
  selectedGroupId?: string | null
  groups?: TaskGroup[]
  onSidebarToggle?: () => void
  currentDate?: Date
  onDateChange?: (date: Date) => void
  onDateClick?: (date: Date) => void
  mobileViewToggleButtons?: React.ReactNode
  desktopViewToggleButtons?: React.ReactNode
}

const WEEK_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export function MonthCalendar({ 
  tasks, 
  onTaskClick, 
  selectedGroupId, 
  groups = [], 
  onSidebarToggle,
  currentDate: externalCurrentDate,
  onDateChange,
  onDateClick,
  mobileViewToggleButtons,
  desktopViewToggleButtons
}: MonthCalendarProps) {
  const { timezone } = useUserTimezone()
  const [currentDate, setCurrentDate] = useState(externalCurrentDate || new Date())

  // Sync with external currentDate if provided
  useEffect(() => {
    if (externalCurrentDate && !isSameMonth(currentDate, externalCurrentDate)) {
      setCurrentDate(externalCurrentDate)
    }
  }, [externalCurrentDate, currentDate])

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }) // Start on Sunday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })

  const getTasksForDate = (date: Date): Task[] => {
    const dateInTimezone = getDateInTimezone(date, timezone)
    return tasks.filter(task => {
      if (!task.scheduled_start) return false
      const taskStartUTC = parseISO(task.scheduled_start)
      const taskStartDate = getDateInTimezone(taskStartUTC, timezone)
      return isSameDay(taskStartDate, dateInTimezone)
    })
  }

  const goToPreviousMonth = () => {
    const newDate = subMonths(currentDate, 1)
    setCurrentDate(newDate)
    onDateChange?.(newDate)
  }

  const goToNextMonth = () => {
    const newDate = addMonths(currentDate, 1)
    setCurrentDate(newDate)
    onDateChange?.(newDate)
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    onDateChange?.(today)
  }

  const handleDateClick = (date: Date) => {
    if (onDateClick) {
      onDateClick(date)
    }
  }

  // Generate calendar days
  const calendarDays: Date[] = []
  let day = calendarStart
  while (day <= calendarEnd) {
    calendarDays.push(day)
    day = addDays(day, 1)
  }

  // Organize days into weeks
  const weeks: Date[][] = []
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7))
  }

  const today = new Date()

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
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <Button variant="outline" size="sm" onClick={goToToday} className="hidden sm:inline-flex flex-shrink-0">
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
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto p-4">
        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {WEEK_DAYS.map((day) => (
            <div key={day} className="text-center text-xs md:text-sm font-medium text-muted-foreground p-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            const dayTasks = getTasksForDate(day)
            const dateInTimezone = getDateInTimezone(day, timezone)
            const currentDateInTimezone = getDateInTimezone(currentDate, timezone)
            const isCurrentMonth = isSameMonth(dateInTimezone, currentDateInTimezone)
            const todayDate = getDateInTimezone(new Date(), timezone)
            const isCurrentDay = isSameDay(dateInTimezone, todayDate)

            return (
              <div
                key={index}
                className={cn(
                  "min-h-[100px] md:min-h-[120px] border rounded-md p-2 cursor-pointer transition-colors",
                  !isCurrentMonth && "opacity-40 bg-muted/30",
                  isCurrentMonth && "bg-background",
                  isCurrentDay && "ring-2 ring-primary"
                )}
                onClick={() => handleDateClick(dateInTimezone)}
              >
                {/* Date Number */}
                <div className={cn(
                  "text-sm md:text-base font-bold mb-1 flex items-center justify-center w-8 h-8 rounded-full",
                  isCurrentDay && "bg-primary text-primary-foreground",
                  !isCurrentDay && isCurrentMonth && "text-foreground",
                  !isCurrentMonth && "text-muted-foreground"
                )}>
                  {formatDateInTimezone(day, timezone, { day: 'numeric' })}
                </div>

                {/* Tasks List */}
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map((task) => {
                    const group = task.group_id ? groups.find(g => g.id === task.group_id) : null
                    const groupColor = group?.color || null
                    const isEvent = task.task_type === 'event'
                    
                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "text-xs p-1 rounded truncate cursor-pointer hover:opacity-80 transition-opacity",
                          "flex items-center gap-1",
                          groupColor && "text-white"
                        )}
                        style={groupColor ? { backgroundColor: groupColor } : { backgroundColor: 'rgb(107 114 128 / 0.4)' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onTaskClick?.(task.id)
                        }}
                      >
                        <span className={cn(
                          "flex-shrink-0",
                          isEvent ? "w-2 h-2 border border-white rounded-full" : "w-2 h-2 bg-white rounded-full"
                        )} />
                        <span className="font-medium">
                          {formatTimeShort(task.scheduled_start!, timezone)}
                        </span>
                        <span className="truncate">{task.title}</span>
                      </div>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-xs text-muted-foreground px-1">
                      +{dayTasks.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

