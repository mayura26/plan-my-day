'use client'

import { useState, useEffect, useRef } from 'react'
import { Task } from '@/lib/types'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, getHours, getMinutes, isToday } from 'date-fns'
import { useUserTimezone } from '@/hooks/use-user-timezone'
import { formatTimeShort, getHoursAndMinutesInTimezone, getDateInTimezone } from '@/lib/timezone-utils'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

interface WeeklyCalendarProps {
  tasks: Task[]
  onTaskClick?: (taskId: string) => void
  onTaskSchedule?: (taskId: string, day: Date, time: number) => void
  onTaskReschedule?: (taskId: string, day: Date, time: number) => void
  onTaskResize?: (taskId: string, newEndTime: Date) => void
  activeDragId?: string | null
  resizingTaskId?: string | null
  selectedGroupId?: string | null
}

const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0-23 hours
const WEEK_DAYS = 7

// Create 15-minute interval slots (4 slots per hour: 0, 15, 30, 45 minutes)
const TIME_SLOTS = Array.from({ length: 24 * 4 }, (_, i) => {
  const hour = Math.floor(i / 4)
  const minute = (i % 4) * 15
  return { hour, minute, slotIndex: i }
})

// Helper function to convert hour and minute to decimal hours
const timeToDecimal = (hour: number, minute: number): number => {
  return hour + minute / 60
}

// Helper function to get task color
const getTaskColor = (task: Task) => {
  // Color based on priority
  switch (task.priority) {
    case 1: return 'bg-red-500/80 border-red-600'
    case 2: return 'bg-orange-500/80 border-orange-600'
    case 3: return 'bg-yellow-500/80 border-yellow-600'
    case 4: return 'bg-green-500/80 border-green-600'
    case 5: return 'bg-blue-500/80 border-blue-600'
    default: return 'bg-gray-500/80 border-gray-600'
  }
}

// Droppable calendar slot component (15-minute intervals)
function CalendarSlot({ day, hour, minute, children }: { day: Date, hour: number, minute: number, children?: React.ReactNode }) {
  const time = timeToDecimal(hour, minute) // Convert to decimal hours (e.g., 1.25 for 1:15)
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-slot-${day.getTime()}-${hour}-${minute}`,
    data: {
      type: 'calendar-slot',
      day,
      time,
    },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-4 border-b border-border/50 transition-colors duration-150",
        minute === 0 && "border-b-2 border-border", // Thicker border for hour marks
        isOver && "bg-primary/20 ring-1 ring-primary/30",
        !isOver && "hover:bg-accent/30"
      )}
    >
      {children}
    </div>
  )
}

// Resizable task component (includes dragging and resizing functionality)
function ResizableTask({ task, position, onTaskClick, onResize, activeDragId, resizingTaskId, selectedGroupId }: { 
  task: Task, 
  position: { top: string, height: string }, 
  onTaskClick?: (taskId: string) => void,
  onResize?: (taskId: string, newEndTime: Date) => void,
  activeDragId?: string | null,
  resizingTaskId?: string | null,
  selectedGroupId?: string | null
}) {
  const { timezone } = useUserTimezone()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.locked,
    data: {
      type: 'task',
      task,
    },
  })

  const bottomResizeHandleId = `resize-bottom-${task.id}`
  const topResizeHandleId = `resize-top-${task.id}`
  
  const { attributes: bottomResizeAttributes, listeners: bottomResizeListeners, setNodeRef: setBottomResizeRef, isDragging: isBottomResizing } = useDraggable({
    id: bottomResizeHandleId,
    disabled: task.locked,
    data: {
      type: 'resize-handle',
      task,
      resizeDirection: 'bottom',
    },
  })

  const { attributes: topResizeAttributes, listeners: topResizeListeners, setNodeRef: setTopResizeRef, isDragging: isTopResizing } = useDraggable({
    id: topResizeHandleId,
    disabled: task.locked,
    data: {
      type: 'resize-handle',
      task,
      resizeDirection: 'top',
    },
  })

  const isResizing = isTopResizing || isBottomResizing
  const isActiveDrag = activeDragId === task.id || activeDragId === bottomResizeHandleId || activeDragId === topResizeHandleId
  const isTaskResizing = resizingTaskId === task.id || isResizing

  // Determine if task belongs to selected group
  // Handle 'ungrouped' string for ungrouped tasks
  const taskGroupId = task.group_id || null
  const belongsToSelectedGroup = selectedGroupId === null 
    ? false 
    : selectedGroupId === 'ungrouped' 
      ? taskGroupId === null 
      : taskGroupId === selectedGroupId
  const shouldFade = selectedGroupId !== null && !belongsToSelectedGroup

  const style = {
    top: position.top,
    height: position.height,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging || isTaskResizing ? 0.7 : shouldFade ? 0.3 : 1,
    transition: isDragging || isTaskResizing ? 'none' : 'all 0.2s ease-in-out',
    zIndex: isActiveDrag ? 50 : 10,
  }

  // Handle click on the task content (not the drag area)
  const handleTaskClick = (e: React.MouseEvent) => {
    // Stop propagation to prevent triggering on parent elements
    e.stopPropagation()
    // Only trigger if we're not currently dragging
    if (!isDragging && !isResizing) {
      onTaskClick?.(task.id)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(task.locked ? {} : listeners)}
      {...attributes}
      className={cn(
        "absolute left-1 right-1 rounded-md border-l-4 p-2 cursor-pointer pointer-events-auto",
        "hover:shadow-lg transition-shadow overflow-hidden group",
        task.locked && "cursor-not-allowed opacity-75",
        !task.locked && "cursor-grab active:cursor-grabbing",
        isActiveDrag && "shadow-xl ring-2 ring-primary/50",
        isTaskResizing && "ring-2 ring-primary/50",
        belongsToSelectedGroup && selectedGroupId !== null && "ring-2 ring-primary ring-offset-1",
        getTaskColor(task)
      )}
      onClick={handleTaskClick}
    >
      <div className="text-xs font-medium text-white truncate pointer-events-none">
        {task.title}
      </div>
      <div className="text-xs text-white/90 mt-1">
        {formatTimeShort(task.scheduled_start!, timezone)}
      </div>
      {task.locked && (
        <div className="text-xs text-white/90 mt-1 flex items-center gap-1">
          🔒 Locked
        </div>
      )}
      {!task.locked && (
        <>
          {/* Top resize handle */}
          <div
            ref={setTopResizeRef}
            {...topResizeListeners}
            {...topResizeAttributes}
            className={cn(
              "absolute top-0 left-0 right-0 h-2 cursor-ns-resize bg-white/20 hover:bg-white/30 transition-opacity flex items-center justify-center",
              isTopResizing ? "opacity-100 bg-white/40" : "opacity-0 group-hover:opacity-100"
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3 text-white" />
          </div>
          {/* Bottom resize handle */}
          <div
            ref={setBottomResizeRef}
            {...bottomResizeListeners}
            {...bottomResizeAttributes}
            className={cn(
              "absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-white/20 hover:bg-white/30 transition-opacity flex items-center justify-center",
              isBottomResizing ? "opacity-100 bg-white/40" : "opacity-0 group-hover:opacity-100"
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3 text-white" />
          </div>
        </>
      )}
    </div>
  )
}

export function WeeklyCalendar({ tasks, onTaskClick, onTaskSchedule, onTaskReschedule, onTaskResize, activeDragId, resizingTaskId, selectedGroupId }: WeeklyCalendarProps) {
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
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">
            {format(weekStart, 'MMMM yyyy')}
          </h2>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={goToPreviousWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Days Header */}
      <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b bg-muted/30">
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
                "text-sm font-medium",
                isToday && "text-primary"
              )}>
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                "text-2xl font-bold mt-1",
                isToday && "bg-primary text-primary-foreground rounded-full w-10 h-10 flex items-center justify-center mx-auto"
              )}>
                {format(day, 'd')}
              </div>
            </div>
          )
        })}
      </div>

      {/* Calendar Grid */}
      <div ref={calendarScrollRef} className="flex-1 overflow-auto">
        <div className="relative">
          {/* Time column and day columns */}
          <div className="grid grid-cols-[80px_repeat(7,1fr)]">
            {/* Time labels */}
            <div className="border-r">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-16 border-b px-2 text-xs text-muted-foreground flex items-start pt-1"
                >
                  {formatTime(hour)}
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
