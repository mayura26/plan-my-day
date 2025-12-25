'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { WeeklyCalendar } from '@/components/weekly-calendar'
import { TaskGroupManager } from '@/components/task-group-manager'
import { TaskForm } from '@/components/task-form'
import { TaskDetailDialog } from '@/components/task-detail-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar as CalendarIcon, Plus, CheckSquare, Clock } from 'lucide-react'
import { Task, TaskGroup, CreateTaskRequest } from '@/lib/types'
import { format } from 'date-fns'

export default function CalendarPage() {
  const { data: session, status } = useSession()
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

  const filteredTasks = selectedGroupId 
    ? tasks.filter(task => task.group_id === selectedGroupId)
    : tasks

  const scheduledTasks = showAllTasks 
    ? filteredTasks.filter(task => task.scheduled_start && task.scheduled_end)
    : filteredTasks.filter(task => task.scheduled_start && task.scheduled_end)
  
  const unscheduledTasks = filteredTasks.filter(task => !task.scheduled_start || !task.scheduled_end)
  
  // For display in calendar - only show scheduled tasks
  const calendarTasks = scheduledTasks

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
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
            showAllTasks={showAllTasks}
            onShowAllTasksChange={setShowAllTasks}
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
                  <div
                    key={task.id}
                    className="p-2 rounded border bg-card hover:bg-accent/50 transition-colors cursor-pointer text-sm"
                    onClick={() => handleTaskClick(task.id)}
                  >
                    <div className="font-medium truncate">{task.title}</div>
                    <Badge variant="outline" className="text-xs mt-1">
                      Priority {task.priority}
                    </Badge>
                  </div>
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
  )
}
