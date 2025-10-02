'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateTaskRequest, TaskType } from '@/lib/types'
import { PRIORITY_LABELS, ENERGY_LABELS, TASK_TYPE_LABELS } from '@/lib/task-utils'

interface TaskFormProps {
  onSubmit: (task: CreateTaskRequest) => Promise<void>
  onCancel?: () => void
  initialData?: Partial<CreateTaskRequest>
  isLoading?: boolean
}

export function TaskForm({ onSubmit, onCancel, initialData, isLoading = false }: TaskFormProps) {
  const [formData, setFormData] = useState<CreateTaskRequest>({
    title: initialData?.title || '',
    description: initialData?.description || '',
    priority: initialData?.priority || 3,
    duration: initialData?.duration || undefined,
    task_type: initialData?.task_type || 'task',
    energy_level_required: initialData?.energy_level_required || 3,
    estimated_completion_time: initialData?.estimated_completion_time || undefined,
    ...initialData
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

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
        ...initialData
      })
    }
  }, [initialData?.title, initialData?.task_type]) // Only re-run when key fields change

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
      await onSubmit(formData)
    } catch (error) {
      console.error('Error submitting task:', error)
    }
  }

  const handleInputChange = (field: keyof CreateTaskRequest, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
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
