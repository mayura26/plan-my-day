'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { DndContext, DragEndEvent, DragOverEvent, DragStartEvent, PointerSensor, useSensor, useSensors, closestCenter, DragOverlay } from '@dnd-kit/core'
import { WeeklyCalendar } from '@/components/weekly-calendar'
import { TaskGroupManager, DraggableTaskItem } from '@/components/task-group-manager'
import { TaskForm } from '@/components/task-form'
import { TaskDetailDialog } from '@/components/task-detail-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar as CalendarIcon, Plus, CheckSquare, Clock } from 'lucide-react'
import { Task, TaskGroup, CreateTaskRequest } from '@/lib/types'
import { format, startOfWeek } from 'date-fns'
import { useUserTimezone } from '@/hooks/use-user-timezone'
import { createDateInTimezone } from '@/lib/timezone-utils'

export default function CalendarPage() {
  const { data: session, status } = useSession()
  const { timezone } = useUserTimezone()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showTaskDetail, setShowTaskDetail] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())
  
  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  )

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
      return
    }

    if (status === 'authenticated') {
      fetchTasks()
    }
  }, [status, router])

  const fetchTasks = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/tasks')
      if (response.ok) {
        const data = await response.json()
        setTasks(data.tasks || [])
      } else {
        console.error('Failed to fetch tasks')
      }
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/task-groups')
      if (response.ok) {
        const data = await response.json()
        setGroups(data.groups || [])
      }
    } catch (error) {
      console.error('Error fetching groups:', error)
    }
  }

  useEffect(() => {
    if (session) {
      fetchGroups()
    }
  }, [session])

  const handleTaskClick = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setSelectedTask(task)
      setShowTaskDetail(true)
    }
  }

  const handleEditTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setEditingTask(task)
      setIsEditing(true)
    }
  }

  const handleUpdateTask = async (taskData: CreateTaskRequest) => {
    if (!editingTask) return

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskData),
      })

      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(task => 
          task.id === editingTask.id ? data.task : task
        ))
        setEditingTask(null)
        setIsEditing(false)
      } else {
        const error = await response.json()
        console.error('Failed to update task:', error)
        throw new Error(error.error || 'Failed to update task')
      }
    } catch (error) {
      console.error('Error updating task:', error)
      throw error
    } finally {
      setIsUpdating(false)
    }
  }

  const handleUnscheduleTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduled_start: null,
          scheduled_end: null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(task => 
          task.id === taskId ? data.task : task
        ))
        // Update selected task if it's the one being unscheduled
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task)
        }
      } else {
        const error = await response.json()
        console.error('Failed to unschedule task:', error)
        throw new Error(error.error || 'Failed to unschedule task')
      }
    } catch (error) {
      console.error('Error unscheduling task:', error)
      throw error
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setTasks(prev => prev.filter(task => task.id !== taskId))
      } else {
        const error = await response.json()
        console.error('Failed to delete task:', error)
        throw new Error(error.error || 'Failed to delete task')
      }
    } catch (error) {
      console.error('Error deleting task:', error)
      throw error
    }
  }

  const handleStatusChange = async (taskId: string, status: Task['status']) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      })

      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(task => 
          task.id === taskId ? data.task : task
        ))
        // Update selected task if it's the one being changed
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task)
        }
      } else {
        const error = await response.json()
        console.error('Failed to update task status:', error)
        throw new Error(error.error || 'Failed to update task status')
      }
    } catch (error) {
      console.error('Error updating task status:', error)
      throw error
    }
  }

  const handleCreateTask = async (taskData: CreateTaskRequest) => {
    setIsCreating(true)
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskData),
      })

      if (response.ok) {
        const data = await response.json()
        setTasks(prev => [data.task, ...prev])
        setShowCreateForm(false)
      } else {
        const error = await response.json()
        console.error('Failed to create task:', error)
        throw new Error(error.error || 'Failed to create task')
      }
    } catch (error) {
      console.error('Error creating task:', error)
      throw error
    } finally {
      setIsCreating(false)
    }
  }

  // Show all tasks - selectedGroupId is now only used for visual highlighting in sidebar
  // Filter out tasks from hidden groups
  const filteredTasks = tasks.filter(task => {
    if (!task.group_id) {
      // Ungrouped tasks
      return !hiddenGroups.has('ungrouped')
    }
    // Grouped tasks
    return !hiddenGroups.has(task.group_id)
  })

  const scheduledTasks = showAllTasks 
    ? filteredTasks.filter(task => task.scheduled_start && task.scheduled_end)
    : filteredTasks.filter(task => task.scheduled_start && task.scheduled_end)
  
  const unscheduledTasks = filteredTasks.filter(task => !task.scheduled_start || !task.scheduled_end)
  
  // For display in calendar - only show scheduled tasks
  const calendarTasks = scheduledTasks

  const handleDragStart = (event: DragStartEvent) => {
    const activeData = event.active.data.current
    const activeId = event.active.id as string
    setActiveDragId(activeId)
    
    // Track if we're resizing
    if (activeData?.type === 'resize-handle') {
      setResizingTaskId(activeData.task?.id || null)
    } else if (activeData?.type === 'sidebar-task' || activeData?.type === 'task') {
      // Track the dragged task for the overlay
      setDraggedTask(activeData.task as Task)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    // Handle real-time resize preview if needed
    // For now, we'll handle resize on drop
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null)
    setResizingTaskId(null)
    setDraggedTask(null)
    const { active, over } = event
    
    if (!over) return
    
    const activeData = active.data.current
    const dropData = over.data.current
    
    // Handle resize handle drag
    if (activeData?.type === 'resize-handle') {
      const task = activeData.task as Task
      const resizeDirection = activeData.resizeDirection as 'top' | 'bottom'
      
      if (!task.locked && dropData?.type === 'calendar-slot' && task.scheduled_start && task.scheduled_end) {
        // Calculate new time based on drop position
        const { day, time } = dropData
        // Snap to 15-minute intervals
        const totalMinutes = time * 60
        const snappedMinutes = Math.round(totalMinutes / 15) * 15
        const hours = Math.floor(snappedMinutes / 60)
        const minutes = snappedMinutes % 60
        
        if (resizeDirection === 'bottom') {
          // Resize from bottom - change end time
          const newEndDate = createDateInTimezone(day, hours, minutes, timezone)
          const startDate = new Date(task.scheduled_start)
          
          // Ensure end time is after start time
          if (newEndDate > startDate) {
            await handleTaskResize(task.id, newEndDate)
          }
        } else if (resizeDirection === 'top') {
          // Resize from top - change start time
          const newStartDate = createDateInTimezone(day, hours, minutes, timezone)
          const endDate = new Date(task.scheduled_end)
          
          // Ensure start time is before end time
          if (newStartDate < endDate) {
            await handleTaskResizeStart(task.id, newStartDate)
          }
        }
      }
      return
    }
    
    // Handle task drag (scheduling/rescheduling)
    // Get task from active data (for sidebar tasks) or find it (for calendar tasks)
    const taskId = active.id as string
    let task = activeData?.task as Task | undefined
    if (!task) {
      task = tasks.find(t => t.id === taskId)
    }
    
    if (!task || task.locked) return
    
    // Get drop target data
    if (dropData?.type === 'calendar-slot') {
      const { day, time } = dropData
      
      // If task is already scheduled, reschedule it; otherwise schedule it
      if (task.scheduled_start) {
        await handleRescheduleTaskDrop(taskId, day, time)
      } else {
        await handleScheduleTaskDrop(taskId, day, time)
      }
    }
  }
  
  const handleTaskResize = async (taskId: string, newEndTime: Date) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.locked || !task.scheduled_start) return
    
    const startDate = new Date(task.scheduled_start)
    
    // Ensure end time is after start time
    if (newEndTime <= startDate) return
    
    // newEndTime is already snapped to 15-minute intervals from the drop position
    // Calculate duration based on the new end time
    const totalMinutes = (newEndTime.getTime() - startDate.getTime()) / 60000
    const duration = Math.max(15, Math.round(totalMinutes / 15) * 15) // Minimum 15 minutes
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduled_end: newEndTime.toISOString(),
          duration: duration,
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(t => t.id === taskId ? data.task : t))
      }
    } catch (error) {
      console.error('Error resizing task:', error)
    }
  }

  const handleTaskResizeStart = async (taskId: string, newStartTime: Date) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.locked || !task.scheduled_start || !task.scheduled_end) return
    
    const endDate = new Date(task.scheduled_end)
    
    // Ensure start time is before end time
    if (newStartTime >= endDate) return
    
    // The newStartTime is already snapped to 15-minute intervals from the drop position
    // Calculate new duration based on the new start time and existing end time
    const totalMinutes = (endDate.getTime() - newStartTime.getTime()) / 60000
    const snappedMinutes = Math.max(15, Math.round(totalMinutes / 15) * 15) // Minimum 15 minutes
    const duration = snappedMinutes
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduled_start: newStartTime.toISOString(),
          duration: duration,
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(t => t.id === taskId ? data.task : t))
      }
    } catch (error) {
      console.error('Error resizing task start:', error)
    }
  }

  const handleScheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.locked) return
    
    // Snap to 15-minute intervals
    const totalMinutes = time * 60
    const snappedMinutes = Math.round(totalMinutes / 15) * 15
    const hours = Math.floor(snappedMinutes / 60)
    const minutes = snappedMinutes % 60
    
    const duration = task.duration || task.estimated_completion_time || 60 // Default to 60 minutes
    // Create the start date in the user's timezone, then convert to UTC
    const startDate = createDateInTimezone(day, hours, minutes, timezone)
    const endDate = new Date(startDate.getTime() + duration * 60000)
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(t => t.id === taskId ? data.task : t))
      }
    } catch (error) {
      console.error('Error scheduling task:', error)
    }
  }

  const handleRescheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.locked || !task.scheduled_start || !task.scheduled_end) return
    
    // Snap to 15-minute intervals
    const totalMinutes = time * 60
    const snappedMinutes = Math.round(totalMinutes / 15) * 15
    const hours = Math.floor(snappedMinutes / 60)
    const minutes = snappedMinutes % 60
    
    // Calculate duration from existing schedule
    const oldStart = new Date(task.scheduled_start)
    const oldEnd = new Date(task.scheduled_end)
    const duration = (oldEnd.getTime() - oldStart.getTime()) / 60000 // in minutes
    
    // Create the start date in the user's timezone, then convert to UTC
    const startDate = createDateInTimezone(day, hours, minutes, timezone)
    const endDate = new Date(startDate.getTime() + duration * 60000)
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(t => t.id === taskId ? data.task : t))
      }
    } catch (error) {
      console.error('Error rescheduling task:', error)
    }
  }

  if (status === 'loading' || isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading calendar...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Left Sidebar */}
        <div className="w-80 border-r overflow-y-auto bg-background">
          <div className="p-4 space-y-4">
            {/* Add Task Button */}
            <Button 
              className="w-full" 
              onClick={() => setShowCreateForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>

            {/* Task Groups */}
            <TaskGroupManager
              onGroupSelect={setSelectedGroupId}
              selectedGroupId={selectedGroupId}
              tasks={tasks}
              onTaskClick={handleTaskClick}
              showAllTasks={showAllTasks}
              onShowAllTasksChange={setShowAllTasks}
              onHiddenGroupsChange={setHiddenGroups}
            />

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Scheduled Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Scheduled:</span>
                  <span className="font-medium text-green-600">
                    {scheduledTasks.length}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Unscheduled:</span>
                  <span className="font-medium text-orange-600">
                    {unscheduledTasks.length}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>High Priority:</span>
                  <span className="font-medium text-red-600">
                    {filteredTasks.filter(t => t.priority <= 2).length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Unscheduled Tasks */}
          {unscheduledTasks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" />
                  Unscheduled ({unscheduledTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {unscheduledTasks.slice(0, 5).map((task) => (
                  <DraggableTaskItem
                    key={task.id}
                    task={task}
                    onTaskClick={handleTaskClick}
                  />
                ))}
                {unscheduledTasks.length > 5 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={() => router.push('/tasks')}
                  >
                    View all {unscheduledTasks.length} tasks
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Main Calendar Area */}
      <div className="flex-1 overflow-hidden">
        <WeeklyCalendar 
          tasks={calendarTasks} 
          onTaskClick={handleTaskClick}
          onTaskSchedule={handleScheduleTaskDrop}
          onTaskReschedule={handleRescheduleTaskDrop}
          onTaskResize={handleTaskResize}
          activeDragId={activeDragId}
          resizingTaskId={resizingTaskId}
          selectedGroupId={selectedGroupId}
          groups={groups}
        />
      </div>

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        task={selectedTask}
        open={showTaskDetail}
        onOpenChange={setShowTaskDetail}
        onEdit={handleEditTask}
        onDelete={handleDeleteTask}
        onStatusChange={handleStatusChange}
        onUnschedule={handleUnscheduleTask}
      />

      {/* Create Task Dialog */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>
          <TaskForm
            onSubmit={handleCreateTask}
            onCancel={() => setShowCreateForm(false)}
            isLoading={isCreating}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          {editingTask && (
            <TaskForm
              onSubmit={handleUpdateTask}
              onCancel={() => {
                setEditingTask(null)
                setIsEditing(false)
              }}
              initialData={{
                title: editingTask.title,
                description: editingTask.description || undefined,
                priority: editingTask.priority,
                duration: editingTask.duration || undefined,
                task_type: editingTask.task_type,
                group_id: editingTask.group_id || undefined,
                template_id: editingTask.template_id || undefined,
                energy_level_required: editingTask.energy_level_required,
                estimated_completion_time: editingTask.estimated_completion_time || undefined,
                depends_on_task_id: editingTask.depends_on_task_id || undefined,
                scheduled_start: editingTask.scheduled_start || undefined,
                scheduled_end: editingTask.scheduled_end || undefined
              }}
              isLoading={isUpdating}
            />
          )}
        </DialogContent>
      </Dialog>
      </div>

      {/* Drag Overlay - renders dragged item in a portal to avoid overflow clipping */}
      <DragOverlay>
        {draggedTask && (
          <div className="p-2 rounded border bg-card shadow-lg cursor-grabbing text-sm" style={{ opacity: 0.9 }}>
            <div className="font-medium truncate">{draggedTask.title}</div>
            <Badge variant="outline" className="text-xs mt-1">
              Priority {draggedTask.priority}
            </Badge>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
