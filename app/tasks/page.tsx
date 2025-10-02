'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Task, CreateTaskRequest } from '@/lib/types'
import { TaskList } from '@/components/task-list'
import { TaskForm } from '@/components/task-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Calendar, List, BarChart3 } from 'lucide-react'

export default function TasksPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  // Fetch tasks
  const fetchTasks = async () => {
    try {
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

  useEffect(() => {
    if (session) {
      fetchTasks()
    }
  }, [session])

  // Create task
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

  // Edit task
  const handleEditTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      setEditingTask(task)
      setIsEditing(true)
    }
  }

  const handleUpdateTaskForm = async (taskData: CreateTaskRequest) => {
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

  // Update task status/properties
  const handleUpdateTaskStatus = async (taskId: string, updates: Partial<Task>) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (response.ok) {
        const data = await response.json()
        setTasks(prev => prev.map(task => 
          task.id === taskId ? data.task : task
        ))
      } else {
        const error = await response.json()
        console.error('Failed to update task:', error)
        throw new Error(error.error || 'Failed to update task')
      }
    } catch (error) {
      console.error('Error updating task:', error)
      throw error
    }
  }

  // Delete task
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

  // Schedule task (placeholder for future AI scheduling)
  const handleScheduleTask = (taskId: string) => {
    console.log('Schedule task:', taskId)
    // TODO: Implement AI scheduling
  }

  // Extend task (placeholder for future functionality)
  const handleExtendTask = (taskId: string) => {
    console.log('Extend task:', taskId)
    // TODO: Implement task extension
  }

  if (status === 'loading' || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return null // Will redirect
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Task Management</h1>
              <p className="text-muted-foreground">
                Organize and manage your daily tasks
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Calendar className="w-4 h-4 mr-2" />
                Calendar View
              </Button>
              <Button variant="outline" size="sm">
                <BarChart3 className="w-4 h-4 mr-2" />
                Analytics
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <TaskList
          tasks={tasks}
          onUpdateTask={handleUpdateTaskStatus}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTask}
          onScheduleTask={handleScheduleTask}
          onExtendTask={handleExtendTask}
          onCreateTask={() => setShowCreateForm(true)}
        />
      </main>

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
            <DialogDescription>
              Modify the task details below and click "Update Task" to save your changes.
            </DialogDescription>
          </DialogHeader>
          {editingTask && (
            <TaskForm
              onSubmit={handleUpdateTaskForm}
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
                depends_on_task_id: editingTask.depends_on_task_id || undefined
              }}
              isLoading={isUpdating}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
