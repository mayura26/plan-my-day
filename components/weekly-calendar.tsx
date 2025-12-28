'use client'

import { useState, useEffect, useRef } from 'react'
import { Task, TaskGroup } from '@/lib/types'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, getHours, getMinutes, isToday } from 'date-fns'
import { useUserTimezone } from '@/hooks/use-user-timezone'
import { getHoursAndMinutesInTimezone, getDateInTimezone } from '@/lib/timezone-utils'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ResizableTask } from '@/components/calendar-task'
import { CalendarSlot, timeToDecimal } from '@/components/calendar-slot'

interface WeeklyCalendarProps {
  tasks: Task[]
  onTaskClick?: (taskId: string) => void
  onTaskSchedule?: (taskId: string, day: Date, time: number) => void
  onTaskReschedule?: (taskId: string, day: Date, time: number) => void
  onTaskResize?: (taskId: string, newEndTime: Date) => void
  activeDragId?: string | null
  resizingTaskId?: string | null
  selectedGroupId?: string | null
  groups?: TaskGroup[]
  onSidebarToggle?: () => void
  viewToggleButtons?: React.ReactNode
}

const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0-23 hours
const WEEK_DAYS = 7

// Create 15-minute interval slots (4 slots per hour: 0, 15, 30, 45 minutes)
const TIME_SLOTS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hour = Math.floor(i / 4)
  const minute = (i % 4) * 15
  return { hour, minute, slotIndex: i }
})

export function WeeklyCalendar({ tasks, onTaskClick, onTaskSchedule, onTaskReschedule, onTaskResize, activeDragId, resizingTaskId, selectedGroupId, groups = [], onSidebarToggle, viewToggleButtons }: WeeklyCalendarProps) {
  const { timezone } = useUserTimezone()
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [currentTime, setCurrentTime] = useState(new Date())
  const calendarScrollRef = useRef<HTMLDivElement>(null)
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 }) // Start on Monday

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(timer)
  }, [])

  // Auto-scroll to current time on mount
  useEffect(() => {
    const scrollToCurrentTime = () => {
      if (!calendarScrollRef.current) return

      const now = new Date()
      const { hour, minute } = getHoursAndMinutesInTimezone(now, timezone)
      const totalMinutes = hour * 60 + minute
      
      // Each hour is 64px (h-16 = 4rem = 64px)
      const pixelsPerMinute = 64 / 60
      const scrollPosition = totalMinutes * pixelsPerMinute
      
      // Offset to center the current time in view (subtract half viewport height)
      const offset = calendarScrollRef.current.clientHeight / 2
      
      calendarScrollRef.current.scrollTop = scrollPosition - offset
    }

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(scrollToCurrentTime, 100)

    return () => clearTimeout(timeoutId)
  }, [timezone])

  const getWeekDays = () => {
    // Create days - these represent dates as the user sees them
    // The createDateInTimezone function will extract the correct date components
    // from these Date objects as they appear in the user's timezone
    return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i))
  }

  const getTasksForDayAndHour = (day: Date, hour: number) => {
    return tasks.filter(task => {
      if (!task.scheduled_start || !task.scheduled_end) return false
      
      const taskStartUTC = parseISO(task.scheduled_start)
      const taskStartDate = getDateInTimezone(taskStartUTC, timezone)
      const dayDate = getDateInTimezone(day, timezone)
      
      // Check if task starts on the same day (comparing dates in user's timezone)
      if (!isSameDay(taskStartDate, dayDate)) return false
      
      const { hour: taskStartHour } = getHoursAndMinutesInTimezone(taskStartUTC, timezone)
      const { hour: taskEndHour } = getHoursAndMinutesInTimezone(parseISO(task.scheduled_end), timezone)
      
      return (taskStartHour <= hour && taskEndHour > hour) || (taskStartHour === hour)
    })
  }

  const getTaskPosition = (task: Task) => {
    if (!task.scheduled_start || !task.scheduled_end) return null
    
    const taskStartUTC = parseISO(task.scheduled_start)
    const taskEndUTC = parseISO(task.scheduled_end)
    
    const { hour: startHour, minute: startMinute } = getHoursAndMinutesInTimezone(taskStartUTC, timezone)
    const { hour: endHour, minute: endMinute } = getHoursAndMinutesInTimezone(taskEndUTC, timezone)
    
    const startPosition = (startHour * 60 + startMinute) / 60 // in hours
    const duration = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60 // in hours
    
    return {
      top: `${(startPosition / 24) * 100}%`,
      height: `${(duration / 24) * 100}%`,
      startHour,
      endHour
    }
  }


  const formatTime = (hour: number) => {
    if (hour === 0) return '12 AM'
    if (hour === 12) return '12 PM'
    if (hour < 12) return `${hour} AM`
    return `${hour - 12} PM`
  }

  const goToPreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1))
  }

  const goToNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1))
  }

  const goToToday = () => {
    setCurrentWeek(new Date())
  }

  const getCurrentTimePosition = () => {
    const { hour, minute } = getHoursAndMinutesInTimezone(currentTime, timezone)
    const totalMinutes = hour * 60 + minute
    const percentage = (totalMinutes / (24 * 60)) * 100
    return `${percentage}%`
  }

  const weekDays = getWeekDays()

  return (
    <div className="flex flex-col h-full">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Mobile sidebar toggle button */}
          {onSidebarToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onSidebarToggle}
              className="md:hidden h-10 w-10"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h2 className="text-xl md:text-2xl font-bold">
            {format(weekStart, 'MMMM yyyy')}
          </h2>
          <Button variant="outline" size="sm" onClick={goToToday} className="hidden sm:inline-flex">
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {viewToggleButtons && (
            <div className="hidden md:flex items-center gap-1 mr-2">
              {viewToggleButtons}
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={goToPreviousWeek} className="h-10 w-10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextWeek} className="h-10 w-10">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Days Header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)] border-b bg-muted/30">
        <div className="p-2"></div>
        {weekDays.map((day, index) => {
          const isToday = isSameDay(day, new Date())
          return (
            <div
              key={index}
              className={cn(
                "p-2 text-center border-l",
                isToday && "bg-primary/10"
              )}
            >
              <div className={cn(
                "text-xs md:text-sm font-medium",
                isToday && "text-primary"
              )}>
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                "text-lg md:text-2xl font-bold mt-1",
                isToday && "bg-primary text-primary-foreground rounded-full w-8 h-8 md:w-10 md:h-10 flex items-center justify-center mx-auto"
              )}>
                {format(day, 'd')}
              </div>
            </div>
          )
        })}
      </div>

      {/* Calendar Grid */}
      <div ref={calendarScrollRef} className="flex-1 overflow-auto">
        <div className="relative min-w-[600px] md:min-w-0">
          {/* Time column and day columns */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)]">
            {/* Time labels */}
            <div className="border-r sticky left-0 z-10 bg-background">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-16 border-b px-1 md:px-2 text-xs text-muted-foreground flex items-start pt-1"
                >
                  <span className="hidden sm:inline">{formatTime(hour)}</span>
                  <span className="sm:hidden">{hour === 0 ? '12' : hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}</span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map((day, dayIndex) => (
              <div key={dayIndex} className="relative border-l">
                {/* 15-minute interval slots with drop zones */}
                {TIME_SLOTS.map(({ hour, minute, slotIndex }) => (
                  <CalendarSlot key={slotIndex} day={day} hour={hour} minute={minute} />
                ))}

                {/* Current time indicator (red line) */}
                {isToday(day) && (
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
                <div className="absolute inset-0 pointer-events-none">
                  {tasks
                    .filter(task => {
                      if (!task.scheduled_start) return false
                      const taskStartUTC = parseISO(task.scheduled_start)
                      const taskStartDate = getDateInTimezone(taskStartUTC, timezone)
                      const dayDate = getDateInTimezone(day, timezone)
                      return isSameDay(taskStartDate, dayDate)
                    })
                    .map((task) => {
                      const position = getTaskPosition(task)
                      if (!position) return null

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
                        />
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
