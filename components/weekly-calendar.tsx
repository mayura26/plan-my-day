'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Task, TaskGroup } from '@/lib/types'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, getHours, getMinutes, isToday } from 'date-fns'
import { getHoursAndMinutesInTimezone, getDateInTimezone, formatDateInTimezone } from '@/lib/timezone-utils'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ResizableTask } from '@/components/calendar-task'
import { CalendarSlot, timeToDecimal } from '@/components/calendar-slot'

interface WeeklyCalendarProps {
  tasks: Task[]
  timezone: string
  onTaskClick?: (taskId: string) => void
  onTaskSchedule?: (taskId: string, day: Date, time: number) => void
  onTaskReschedule?: (taskId: string, day: Date, time: number) => void
  onTaskResize?: (taskId: string, newEndTime: Date) => void
  activeDragId?: string | null
  resizingTaskId?: string | null
  selectedGroupId?: string | null
  groups?: TaskGroup[]
  onSidebarToggle?: () => void
  mobileViewToggleButtons?: React.ReactNode
  desktopViewToggleButtons?: React.ReactNode
}

const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0-23 hours
const WEEK_DAYS = 7

// Create 15-minute interval slots (4 slots per hour: 0, 15, 30, 45 minutes)
const TIME_SLOTS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hour = Math.floor(i / 4)
  const minute = (i % 4) * 15
  return { hour, minute, slotIndex: i }
})

export function WeeklyCalendar({ tasks, timezone, onTaskClick, onTaskSchedule, onTaskReschedule, onTaskResize, activeDragId, resizingTaskId, selectedGroupId, groups = [], onSidebarToggle, mobileViewToggleButtons, desktopViewToggleButtons }: WeeklyCalendarProps) {
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [currentTime, setCurrentTime] = useState(new Date())
  const calendarScrollRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const horizontalScrollContainerRef = useRef<HTMLDivElement>(null)
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 }) // Start on Monday

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(timer)
  }, [])

  // Sync horizontal scroll between header and grid
  useEffect(() => {
    const calendarEl = calendarScrollRef.current
    const headerEl = headerScrollRef.current
    if (!calendarEl || !headerEl) return

    const handleCalendarScroll = () => {
      if (headerEl.scrollLeft !== calendarEl.scrollLeft) {
        headerEl.scrollLeft = calendarEl.scrollLeft
      }
    }

    const handleHeaderScroll = () => {
      if (calendarEl.scrollLeft !== headerEl.scrollLeft) {
        calendarEl.scrollLeft = headerEl.scrollLeft
      }
    }

    calendarEl.addEventListener('scroll', handleCalendarScroll)
    headerEl.addEventListener('scroll', handleHeaderScroll)

    return () => {
      calendarEl.removeEventListener('scroll', handleCalendarScroll)
      headerEl.removeEventListener('scroll', handleHeaderScroll)
    }
  }, [])

  // Auto-scroll to current time and current day on mount
  useLayoutEffect(() => {
    if (!calendarScrollRef.current || !horizontalScrollContainerRef.current) return

    const now = new Date()
    const { hour, minute } = getHoursAndMinutesInTimezone(now, timezone)
    const totalMinutes = hour * 60 + minute
    
    // Scroll vertically to current time
    // Each hour is 64px (h-16 = 4rem = 64px)
    const pixelsPerMinute = 64 / 60
    const scrollPosition = totalMinutes * pixelsPerMinute
    
    // Offset to center the current time in view (subtract half viewport height)
    const offset = calendarScrollRef.current.clientHeight / 2
    
    calendarScrollRef.current.scrollTop = scrollPosition - offset

    // Scroll horizontally to current day
    const weekDays = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i))
    const today = getDateInTimezone(now, timezone)
    const todayIndex = weekDays.findIndex(day => {
      const dayDate = getDateInTimezone(day, timezone)
      return isSameDay(dayDate, today)
    })

    if (todayIndex >= 0) {
      // Calculate the width of one day column
      // On mobile, the grid has min-w-[600px], so we need to account for that
      const gridContainer = calendarScrollRef.current.querySelector('.grid') as HTMLElement
      if (gridContainer && headerScrollRef.current) {
        const gridWidth = gridContainer.scrollWidth
        const viewportWidth = calendarScrollRef.current.clientWidth
        const timeColumnWidth = 60 // 60px on mobile, 80px on desktop (use smaller for mobile calculation)
        const dayColumnWidth = (gridWidth - timeColumnWidth) / 7
        // Center the current day in the viewport
        const scrollToPosition = timeColumnWidth + (dayColumnWidth * todayIndex) - (viewportWidth / 2) + (dayColumnWidth / 2)
        
        // Scroll both header and grid to current day
        calendarScrollRef.current.scrollLeft = Math.max(0, scrollToPosition)
        headerScrollRef.current.scrollLeft = calendarScrollRef.current.scrollLeft
      }
    }
  }, [timezone, weekStart])

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
              {formatDateInTimezone(weekStart, timezone, { month: 'short', year: 'numeric' })}
            </span>
            {/* Desktop: long month */}
            <span className="hidden md:inline">
              {formatDateInTimezone(weekStart, timezone, { month: 'long', year: 'numeric' })}
            </span>
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
          <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)] min-w-[600px] md:min-w-0">
            <div className="p-2"></div>
            {weekDays.map((day, index) => {
              const dayDate = getDateInTimezone(day, timezone)
              const todayDate = getDateInTimezone(new Date(), timezone)
              const isToday = isSameDay(dayDate, todayDate)
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
                    {formatDateInTimezone(day, timezone, { weekday: 'short' })}
                  </div>
                  <div className={cn(
                    "text-lg md:text-2xl font-bold mt-1",
                    isToday && "bg-primary text-primary-foreground rounded-full w-8 h-8 md:w-10 md:h-10 flex items-center justify-center mx-auto"
                  )}>
                    {formatDateInTimezone(day, timezone, { day: 'numeric' })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Calendar Grid - horizontally and vertically scrollable */}
        <div ref={calendarScrollRef} className="flex-1 overflow-auto">
          <div className="relative min-w-[600px] md:min-w-0">
            {/* Time column and day columns */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)]">
            {/* Time labels */}
            <div className="border-r sticky left-0 z-10 bg-background">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-16 border-b-2 border-border px-1 md:px-2 text-xs text-muted-foreground flex items-center"
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
                {TIME_SLOTS.slice(1).map(({ hour, minute, slotIndex }) => (
                  <CalendarSlot key={slotIndex} day={day} hour={hour} minute={minute} />
                ))}

                {/* Current time indicator (red line) */}
                {isSameDay(getDateInTimezone(day, timezone), getDateInTimezone(new Date(), timezone)) && (
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
    </div>
  )
}
