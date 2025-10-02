'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Task, TaskStatus } from '@/lib/types'
import { 
  PRIORITY_LABELS, 
  STATUS_LABELS, 
  TASK_TYPE_LABELS,
  formatDuration,
  getTaskPriorityColor,
  getTaskStatusColor,
  getEnergyLevelColor,
  isTaskOverdue,
  isTaskDueSoon,
  canRescheduleTask,
  canExtendTask
} from '@/lib/task-utils'
import { Clock, Calendar, Zap, Lock, MoreHorizontal } from 'lucide-react'

interface TaskCardProps {
  task: Task
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onEdit?: (taskId: string) => void
  onSchedule?: (taskId: string) => void
  onExtend?: (taskId: string) => void
  showGroup?: boolean
  compact?: boolean
}

export function TaskCard({ 
  task, 
  onUpdate, 
  onDelete, 
  onEdit,
  onSchedule, 
  onExtend,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showGroup = false,
  compact = false 
}: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false)

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setIsUpdating(true)
    try {
      await onUpdate(task.id, { status: newStatus })
    } catch (error) {
      console.error('Error updating task status:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleToggleComplete = async (completed: boolean) => {
    await handleStatusChange(completed ? 'completed' : 'pending')
  }

  const isOverdue = isTaskOverdue(task)
  const isDueSoon = isTaskDueSoon(task)
  const priorityColor = getTaskPriorityColor(task.priority)
  const statusColor = getTaskStatusColor(task.status)
  const energyColor = getEnergyLevelColor(task.energy_level_required)

  if (compact) {
    return (
      <Card className={`transition-all hover:shadow-md ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
        <CardContent className="p-3">
          <div className="flex items-center space-x-3">
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={handleToggleComplete}
              disabled={isUpdating}
            />
            <div className="flex-1 min-w-0">
              <h4 className={`text-sm font-medium truncate ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                {task.title}
              </h4>
              <div className="flex items-center space-x-2 mt-1">
                <Badge variant="outline" className={`text-xs ${priorityColor}`}>
                  {task.priority}. {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                </Badge>
                {task.duration && (
                  <span className="text-xs text-muted-foreground flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDuration(task.duration)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-1">
              {task.locked && <Lock className="w-3 h-3 text-muted-foreground" />}
              <Badge variant="outline" className={`text-xs ${statusColor}`}>
                {STATUS_LABELS[task.status]}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`transition-all hover:shadow-md ${isOverdue ? 'border-red-200 bg-red-50' : ''} ${isDueSoon ? 'border-yellow-200 bg-yellow-50' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1 min-w-0">
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={handleToggleComplete}
              disabled={isUpdating}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <CardTitle className={`text-lg ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                {task.title}
              </CardTitle>
              {task.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {task.locked && <Lock className="w-4 h-4 text-muted-foreground" />}
            {onEdit && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onEdit(task.id)}
                title="Edit task"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Task Details */}
        <div className="space-y-3">
          {/* Priority and Status */}
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className={priorityColor}>
              {task.priority}. {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
            </Badge>
            <Badge variant="outline" className={statusColor}>
              {STATUS_LABELS[task.status]}
            </Badge>
            <Badge variant="outline">
              {TASK_TYPE_LABELS[task.task_type]}
            </Badge>
          </div>

          {/* Timing Information */}
          <div className="flex items-center space-x-4 text-sm text-muted-foreground">
            {task.duration && (
              <div className="flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                {formatDuration(task.duration)}
              </div>
            )}
            {task.scheduled_start && (
              <div className="flex items-center">
                <Calendar className="w-4 h-4 mr-1" />
                {new Date(task.scheduled_start).toLocaleDateString()}
                {task.scheduled_start && task.scheduled_end && (
                  <span className="ml-1">
                    {new Date(task.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                    {new Date(task.scheduled_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center">
              <Zap className={`w-4 h-4 mr-1 ${energyColor}`} />
              {task.energy_level_required}. {task.energy_level_required <= 2 ? 'Low' : task.energy_level_required >= 4 ? 'High' : 'Medium'} Energy
            </div>
          </div>

          {/* Alerts */}
          {isOverdue && (
            <div className="text-sm text-red-600 font-medium">
              ⚠️ This task is overdue
            </div>
          )}
          {isDueSoon && !isOverdue && (
            <div className="text-sm text-yellow-600 font-medium">
              ⏰ This task is due soon
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 pt-2">
            {onEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(task.id)}
              >
                Edit
              </Button>
            )}
            {task.status === 'pending' && onSchedule && canRescheduleTask(task) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSchedule(task.id)}
              >
                Schedule
              </Button>
            )}
            {task.status === 'in_progress' && onExtend && canExtendTask(task) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onExtend(task.id)}
              >
                Extend
              </Button>
            )}
            {task.status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('in_progress')}
                disabled={isUpdating}
              >
                Start
              </Button>
            )}
            {task.status === 'in_progress' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange('completed')}
                disabled={isUpdating}
              >
                Complete
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDelete(task.id)}
              className="text-red-600 hover:text-red-700"
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
