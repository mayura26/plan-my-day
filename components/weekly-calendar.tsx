'use client'

import { useState, useEffect, useRef } from 'react'
import { Task } from '@/lib/types'
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, getHours, getMinutes, isToday } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WeeklyCalendarProps {
  tasks: Task[]
  onTaskClick?: (taskId: string) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0-23 hours
const WEEK_DAYS = 7

export function WeeklyCalendar({ tasks, onTaskClick }: WeeklyCalendarProps) {
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
      const hours = getHours(now)
      const minutes = getMinutes(now)
      const totalMinutes = hours * 60 + minutes
      
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
  }, [])

  const getWeekDays = () => {
    return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i))
  }

  const getTasksForDayAndHour = (day: Date, hour: number) => {
    return tasks.filter(task => {
      if (!task.scheduled_start || !task.scheduled_end) return false
      
      const taskStart = parseISO(task.scheduled_start)
      const taskEnd = parseISO(task.scheduled_end)
      const taskStartHour = getHours(taskStart)
      const taskEndHour = getHours(taskEnd)
      
      return isSameDay(taskStart, day) && (
        (taskStartHour <= hour && taskEndHour > hour) ||
        (taskStartHour === hour)
      )
    })
  }

  const getTaskPosition = (task: Task) => {
    if (!task.scheduled_start || !task.scheduled_end) return null
    
    const taskStart = parseISO(task.scheduled_start)
    const taskEnd = parseISO(task.scheduled_end)
    
    const startHour = getHours(taskStart)
    const startMinute = getMinutes(taskStart)
    const endHour = getHours(taskEnd)
    const endMinute = getMinutes(taskEnd)
    
    const startPosition = (startHour * 60 + startMinute) / 60 // in hours
    const duration = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60 // in hours
    
    return {
      top: `${(startPosition / 24) * 100}%`,
      height: `${(duration / 24) * 100}%`,
      startHour,
      endHour
    }
  }

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
    const hours = getHours(currentTime)
    const minutes = getMinutes(currentTime)
    const totalMinutes = hours * 60 + minutes
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
                {/* Hour slots */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="h-16 border-b hover:bg-accent/50 transition-colors"
                  />
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
                      return isSameDay(parseISO(task.scheduled_start), day)
                    })
                    .map((task) => {
                      const position = getTaskPosition(task)
                      if (!position) return null

                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "absolute left-1 right-1 rounded-md border-l-4 p-2 cursor-pointer pointer-events-auto",
                            "hover:shadow-lg transition-shadow overflow-hidden",
                            getTaskColor(task)
                          )}
                          style={{
                            top: position.top,
                            height: position.height,
                            minHeight: '40px'
                          }}
                          onClick={() => onTaskClick?.(task.id)}
                        >
                          <div className="text-xs font-medium text-white truncate">
                            {task.title}
                          </div>
                          <div className="text-xs text-white/90 mt-1">
                            {format(parseISO(task.scheduled_start!), 'h:mm a')}
                          </div>
                          {task.locked && (
                            <div className="text-xs text-white/90 mt-1 flex items-center gap-1">
                              🔒 Locked
                            </div>
                          )}
                        </div>
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
