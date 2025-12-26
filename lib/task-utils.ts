import { Task, TaskStatus, TaskType, CalendarEvent } from './types'

// Priority helpers
export const PRIORITY_LABELS = {
  1: 'Critical',
  2: 'High', 
  3: 'Medium',
  4: 'Low',
  5: 'Very Low'
} as const

export const PRIORITY_COLORS = {
  1: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800',
  2: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800',
  3: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800',
  4: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800',
  5: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
} as const

// Energy level helpers
export const ENERGY_LABELS = {
  1: 'Low Energy',
  2: 'Low-Medium',
  3: 'Medium',
  4: 'Medium-High',
  5: 'High Energy'
} as const

// Task status helpers
export const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
} as const

export const STATUS_COLORS = {
  pending: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700',
  in_progress: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800',
  completed: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800',
  cancelled: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
} as const

// Task type helpers
export const TASK_TYPE_LABELS = {
  task: 'Task',
  event: 'Event'
} as const

// Utility functions
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function generateTemplateId(): string {
  return `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) {
    return `${hours}h`
  }
  return `${hours}h ${remainingMinutes}m`
}

export function parseDuration(duration: string): number {
  // Parse strings like "1h 30m", "90m", "2h"
  const hourMatch = duration.match(/(\d+)h/)
  const minuteMatch = duration.match(/(\d+)m/)
  
  const hours = hourMatch ? parseInt(hourMatch[1]) : 0
  const minutes = minuteMatch ? parseInt(minuteMatch[1]) : 0
  
  return hours * 60 + minutes
}

export function isTaskOverdue(task: Task): boolean {
  if (task.status === 'completed' || !task.scheduled_end) {
    return false
  }
  return new Date(task.scheduled_end) < new Date()
}

export function isTaskDueSoon(task: Task, hoursThreshold: number = 2): boolean {
  if (task.status === 'completed' || !task.scheduled_start) {
    return false
  }
  const now = new Date()
  const taskStart = new Date(task.scheduled_start)
  const timeDiff = taskStart.getTime() - now.getTime()
  const hoursDiff = timeDiff / (1000 * 60 * 60)
  
  return hoursDiff <= hoursThreshold && hoursDiff > 0
}

export function getTaskProgress(task: Task): number {
  if (task.status === 'completed') return 100
  if (task.status === 'cancelled') return 0
  if (task.status === 'pending') return 0
  
  // For in_progress tasks, we could implement more sophisticated progress tracking
  // For now, just return 50% for in_progress tasks
  return task.status === 'in_progress' ? 50 : 0
}

export function canRescheduleTask(task: Task): boolean {
  return !task.locked && task.task_type === 'task'
}

export function canExtendTask(task: Task): boolean {
  return task.status === 'in_progress' && !task.locked
}

export function getTaskPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || PRIORITY_COLORS[3]
}

export function getTaskStatusColor(status: TaskStatus): string {
  return STATUS_COLORS[status] || STATUS_COLORS.pending
}

export function getEnergyLevelColor(energyLevel: number): string {
  const colors = {
    1: 'text-red-500',
    2: 'text-orange-500', 
    3: 'text-yellow-500',
    4: 'text-blue-500',
    5: 'text-green-500'
  }
  return colors[energyLevel as keyof typeof colors] || colors[3]
}

// Calendar conversion
export function taskToCalendarEvent(task: Task): CalendarEvent {
  const start = task.scheduled_start ? new Date(task.scheduled_start) : new Date()
  const end = task.scheduled_end ? new Date(task.scheduled_end) : new Date(start.getTime() + (task.duration || 60) * 60000)
  
  return {
    id: task.id,
    title: task.title,
    start,
    end,
    type: task.task_type,
    priority: task.priority,
    status: task.status,
    locked: task.locked,
    color: task.group_id ? undefined : getTaskPriorityColor(task.priority).split(' ')[0].replace('text-', ''),
    group_name: task.group_id ? undefined : undefined // Will be populated when we have group data
  }
}

// Validation functions
export function validateTaskData(data: Partial<Task>): string[] {
  const errors: string[] = []
  
  if (!data.title || data.title.trim().length === 0) {
    errors.push('Title is required')
  }
  
  if (data.priority && (data.priority < 1 || data.priority > 5)) {
    errors.push('Priority must be between 1 and 5')
  }
  
  if (data.energy_level_required && (data.energy_level_required < 1 || data.energy_level_required > 5)) {
    errors.push('Energy level must be between 1 and 5')
  }
  
  if (data.duration && data.duration < 0) {
    errors.push('Duration must be positive')
  }
  
  if (data.scheduled_start && data.scheduled_end) {
    const start = new Date(data.scheduled_start)
    const end = new Date(data.scheduled_end)
    if (start >= end) {
      errors.push('End time must be after start time')
    }
  }
  
  return errors
}

// Sorting functions
export function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.priority - b.priority)
}

export function sortTasksByScheduledTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aTime = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Infinity
    const bTime = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Infinity
    return aTime - bTime
  })
}

export function sortTasksByCreatedTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

// Filter functions
export function filterTasksByStatus(tasks: Task[], status: TaskStatus[]): Task[] {
  return tasks.filter(task => status.includes(task.status))
}

export function filterTasksByPriority(tasks: Task[], priorities: number[]): Task[] {
  return tasks.filter(task => priorities.includes(task.priority))
}

export function filterTasksByType(tasks: Task[], types: TaskType[]): Task[] {
  return tasks.filter(task => types.includes(task.task_type))
}

export function filterTasksByDateRange(tasks: Task[], startDate: string, endDate: string): Task[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  return tasks.filter(task => {
    if (!task.scheduled_start) return false
    const taskDate = new Date(task.scheduled_start)
    return taskDate >= start && taskDate <= end
  })
}
