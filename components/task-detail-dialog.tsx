'use client'

import { useState } from 'react'
import { Task } from '@/lib/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Calendar, 
  Clock, 
  Flag, 
  Tag, 
  Zap, 
  CheckCircle2, 
  Circle,
  Lock,
  Edit,
  Trash2,
  X
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { PRIORITY_LABELS, ENERGY_LABELS, TASK_TYPE_LABELS } from '@/lib/task-utils'

interface TaskDetailDialogProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: (taskId: string) => void
  onDelete?: (taskId: string) => void
  onStatusChange?: (taskId: string, status: Task['status']) => void
}

export function TaskDetailDialog({ 
  task, 
  open, 
  onOpenChange, 
  onEdit, 
  onDelete,
  onStatusChange 
}: TaskDetailDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  if (!task) return null

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task?')) return
    
    setIsDeleting(true)
    try {
      await onDelete?.(task.id)
      onOpenChange(false)
    } catch (error) {
      console.error('Error deleting task:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleEdit = () => {
    onEdit?.(task.id)
    onOpenChange(false)
  }

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500'
      case 'in_progress': return 'bg-blue-500'
      case 'cancelled': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusLabel = (status: Task['status']) => {
    switch (status) {
      case 'completed': return 'Completed'
      case 'in_progress': return 'In Progress'
      case 'cancelled': return 'Cancelled'
      default: return 'Pending'
    }
  }

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return 'bg-red-500 text-white'
      case 2: return 'bg-orange-500 text-white'
      case 3: return 'bg-yellow-500 text-white'
      case 4: return 'bg-green-500 text-white'
      case 5: return 'bg-blue-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status and Type Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge className={getStatusColor(task.status)}>
              {task.status === 'completed' ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <Circle className="h-3 w-3 mr-1" />
              )}
              {getStatusLabel(task.status)}
            </Badge>
            <Badge variant="outline">
              <Tag className="h-3 w-3 mr-1" />
              {TASK_TYPE_LABELS[task.task_type]}
            </Badge>
            <Badge className={getPriorityColor(task.priority)}>
              <Flag className="h-3 w-3 mr-1" />
              Priority {task.priority} - {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
            </Badge>
            {task.locked && (
              <Badge variant="destructive">
                <Lock className="h-3 w-3 mr-1" />
                Locked
              </Badge>
            )}
          </div>

          {/* Description */}
          {task.description && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold mb-2">Description</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Schedule Information */}
          {(task.scheduled_start || task.scheduled_end) && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Schedule
                </h3>
                <div className="space-y-2">
                  {task.scheduled_start && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16">Start:</span>
                      <span className="font-medium">
                        {format(parseISO(task.scheduled_start), 'PPP p')}
                      </span>
                    </div>
                  )}
                  {task.scheduled_end && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16">End:</span>
                      <span className="font-medium">
                        {format(parseISO(task.scheduled_end), 'PPP p')}
                      </span>
                    </div>
                  )}
                  {task.scheduled_start && task.scheduled_end && (
                    <div className="flex items-center gap-2 text-sm pt-2 border-t">
                      <span className="text-muted-foreground w-16">Duration:</span>
                      <span className="font-medium">
                        {Math.round(
                          (parseISO(task.scheduled_end).getTime() - parseISO(task.scheduled_start).getTime()) / 60000
                        )} minutes
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Task Properties */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-semibold mb-3">Task Properties</h3>
              <div className="grid grid-cols-2 gap-4">
                {task.duration && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">{task.duration} min</span>
                  </div>
                )}
                {task.energy_level_required && (
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Energy:</span>
                    <span className="font-medium">
                      {ENERGY_LABELS[task.energy_level_required as keyof typeof ENERGY_LABELS]}
                    </span>
                  </div>
                )}
                {task.estimated_completion_time && (
                  <div className="flex items-center gap-2 text-sm col-span-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Estimated Time:</span>
                    <span className="font-medium">{task.estimated_completion_time} min</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Status Change */}
          {task.status !== 'completed' && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
                <div className="flex flex-wrap gap-2">
                  {task.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onStatusChange?.(task.id, 'in_progress')}
                    >
                      Start Task
                    </Button>
                  )}
                  {task.status === 'in_progress' && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onStatusChange?.(task.id, 'completed')}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark Complete
                    </Button>
                  )}
                  {task.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onStatusChange?.(task.id, 'completed')}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark Complete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? 'Deleting...' : 'Delete Task'}
            </Button>
            <Button onClick={handleEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Task
            </Button>
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1 pt-4 border-t">
            <div>Created: {format(parseISO(task.created_at), 'PPP p')}</div>
            <div>Updated: {format(parseISO(task.updated_at), 'PPP p')}</div>
            {task.id && <div className="font-mono">ID: {task.id}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
