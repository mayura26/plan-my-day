'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateTaskRequest, TaskType, TaskGroup } from '@/lib/types'
import { PRIORITY_LABELS, ENERGY_LABELS, TASK_TYPE_LABELS } from '@/lib/task-utils'

interface TaskFormProps {
  onSubmit: (task: CreateTaskRequest) => Promise<void>
  onCancel?: () => void
  initialData?: Partial<CreateTaskRequest>
  isLoading?: boolean
}

export function TaskForm({ onSubmit, onCancel, initialData, isLoading = false }: TaskFormProps) {
  // Convert ISO datetime to datetime-local format
  const formatDateTimeLocal = (isoString?: string) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day}T${hours}:${minutes}`
    } catch {
      return ''
    }
  }

  const [formData, setFormData] = useState<CreateTaskRequest>({
    title: initialData?.title || '',
    description: initialData?.description || '',
    priority: initialData?.priority || 3,
    duration: initialData?.duration || undefined,
    task_type: initialData?.task_type || 'task',
    energy_level_required: initialData?.energy_level_required || 3,
    estimated_completion_time: initialData?.estimated_completion_time || undefined,
    group_id: initialData?.group_id || undefined,
    template_id: initialData?.template_id || undefined,
    depends_on_task_id: initialData?.depends_on_task_id || undefined,
    scheduled_start: formatDateTimeLocal(initialData?.scheduled_start),
    scheduled_end: formatDateTimeLocal(initialData?.scheduled_end),
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([])

  // Fetch task groups
  useEffect(() => {
    const fetchTaskGroups = async () => {
      try {
        const response = await fetch('/api/task-groups')
        if (response.ok) {
          const data = await response.json()
          setTaskGroups(data.groups || [])
        }
      } catch (error) {
        console.error('Error fetching task groups:', error)
      }
    }
    fetchTaskGroups()
  }, [])

  // Update form data when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData && initialData.title) {
      setFormData({
        title: initialData.title || '',
        description: initialData.description || '',
        priority: initialData.priority || 3,
        duration: initialData.duration || undefined,
        task_type: initialData.task_type || 'task',
        energy_level_required: initialData.energy_level_required || 3,
        estimated_completion_time: initialData.estimated_completion_time || undefined,
        group_id: initialData.group_id || undefined,
        template_id: initialData.template_id || undefined,
        depends_on_task_id: initialData.depends_on_task_id || undefined,
        scheduled_start: formatDateTimeLocal(initialData.scheduled_start),
        scheduled_end: formatDateTimeLocal(initialData.scheduled_end),
      })
    }
  }, [initialData?.title, initialData?.scheduled_start, initialData?.scheduled_end]) // Re-run when initialData changes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    // Basic validation
    const newErrors: Record<string, string> = {}
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    }
    if (formData.priority && (formData.priority < 1 || formData.priority > 5)) {
      newErrors.priority = 'Priority must be between 1 and 5'
    }
    if (formData.energy_level_required && (formData.energy_level_required < 1 || formData.energy_level_required > 5)) {
      newErrors.energy_level_required = 'Energy level must be between 1 and 5'
    }
    if (formData.duration && formData.duration < 0) {
      newErrors.duration = 'Duration must be positive'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    try {
      // Convert datetime-local to ISO format
      const submissionData = { ...formData }
      if (submissionData.scheduled_start) {
        submissionData.scheduled_start = new Date(submissionData.scheduled_start).toISOString()
      }
      if (submissionData.scheduled_end) {
        submissionData.scheduled_end = new Date(submissionData.scheduled_end).toISOString()
      }
      
      await onSubmit(submissionData)
    } catch (error) {
      console.error('Error submitting task:', error)
    }
  }

  const handleInputChange = (field: keyof CreateTaskRequest, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value }
      
      // Auto-calculate end time if start time and duration are set
      if (field === 'scheduled_start' || field === 'duration') {
        const startTime = field === 'scheduled_start' ? value : prev.scheduled_start
        const duration = field === 'duration' ? value : prev.duration
        
        if (startTime && duration && !prev.scheduled_end) {
          try {
            const startDate = new Date(startTime)
            const endDate = new Date(startDate.getTime() + duration * 60000) // duration is in minutes
            const year = endDate.getFullYear()
            const month = String(endDate.getMonth() + 1).padStart(2, '0')
            const day = String(endDate.getDate()).padStart(2, '0')
            const hours = String(endDate.getHours()).padStart(2, '0')
            const minutes = String(endDate.getMinutes()).padStart(2, '0')
            updated.scheduled_end = `${year}-${month}-${day}T${hours}:${minutes}`
          } catch (error) {
            console.error('Error calculating end time:', error)
          }
        }
      }
      
      // Also update end time if start time changes and end time already exists
      if (field === 'scheduled_start' && prev.scheduled_end && prev.duration) {
        try {
          const startDate = new Date(value)
          const endDate = new Date(startDate.getTime() + prev.duration * 60000)
          const year = endDate.getFullYear()
          const month = String(endDate.getMonth() + 1).padStart(2, '0')
          const day = String(endDate.getDate()).padStart(2, '0')
          const hours = String(endDate.getHours()).padStart(2, '0')
          const minutes = String(endDate.getMinutes()).padStart(2, '0')
          updated.scheduled_end = `${year}-${month}-${day}T${hours}:${minutes}`
        } catch (error) {
          console.error('Error updating end time:', error)
        }
      }
      
      return updated
    })
    
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{initialData ? 'Edit Task' : 'Create New Task'}</CardTitle>
        <CardDescription>
          {initialData ? 'Update your task details' : 'Add a new task to your planning system'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Title *
            </label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder="Enter task title"
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Enter task description"
              rows={3}
            />
          </div>

          {/* Task Type and Priority */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="task_type" className="text-sm font-medium">
                Task Type
              </label>
              <Select
                value={formData.task_type}
                onValueChange={(value) => handleInputChange('task_type', value as TaskType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">{TASK_TYPE_LABELS.task}</SelectItem>
                  <SelectItem value="event">{TASK_TYPE_LABELS.event}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="priority" className="text-sm font-medium">
                Priority
              </label>
              <Select
                value={formData.priority?.toString()}
                onValueChange={(value) => handleInputChange('priority', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {value}. {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.priority && (
                <p className="text-sm text-red-500">{errors.priority}</p>
              )}
            </div>
          </div>

          {/* Group Selection */}
          <div className="space-y-2">
            <label htmlFor="group_id" className="text-sm font-medium">
              Task Group
            </label>
            <Select
              value={formData.group_id || 'no-group'}
              onValueChange={(value) => handleInputChange('group_id', value === 'no-group' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a group (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-group">No Group</SelectItem>
                {taskGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full border" 
                        style={{ backgroundColor: group.color }}
                      />
                      {group.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration and Energy Level */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="duration" className="text-sm font-medium">
                Duration (minutes)
              </label>
              <Input
                id="duration"
                type="number"
                value={formData.duration || ''}
                onChange={(e) => handleInputChange('duration', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="e.g., 60"
                min="0"
              />
              {errors.duration && (
                <p className="text-sm text-red-500">{errors.duration}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="energy_level" className="text-sm font-medium">
                Energy Level Required
              </label>
              <Select
                value={formData.energy_level_required?.toString()}
                onValueChange={(value) => handleInputChange('energy_level_required', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ENERGY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {value}. {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.energy_level_required && (
                <p className="text-sm text-red-500">{errors.energy_level_required}</p>
              )}
            </div>
          </div>

          {/* Estimated Completion Time */}
          <div className="space-y-2">
            <label htmlFor="estimated_completion_time" className="text-sm font-medium">
              Estimated Completion Time (minutes)
            </label>
            <Input
              id="estimated_completion_time"
              type="number"
              value={formData.estimated_completion_time || ''}
              onChange={(e) => handleInputChange('estimated_completion_time', e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="e.g., 90"
              min="0"
            />
          </div>

          {/* Scheduling Section */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium mb-3">Schedule Task (Optional)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="scheduled_start" className="text-sm font-medium">
                  Start Date & Time
                </label>
                <Input
                  id="scheduled_start"
                  type="datetime-local"
                  value={formData.scheduled_start || ''}
                  onChange={(e) => handleInputChange('scheduled_start', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="scheduled_end" className="text-sm font-medium">
                  End Date & Time
                </label>
                <Input
                  id="scheduled_end"
                  type="datetime-local"
                  value={formData.scheduled_end || ''}
                  onChange={(e) => handleInputChange('scheduled_end', e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Schedule your task to appear in the calendar view
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-4">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isLoading}>
              {isLoading 
                ? (initialData ? 'Updating...' : 'Creating...') 
                : (initialData ? 'Update Task' : 'Create Task')
              }
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
