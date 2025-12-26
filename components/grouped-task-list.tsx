'use client'

import { useState, useEffect } from 'react'
import { Task, TaskGroup, TaskStatus } from '@/lib/types'
import { TaskCard } from './task-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  sortTasksByPriority, 
  sortTasksByScheduledTime, 
  sortTasksByCreatedTime
} from '@/lib/task-utils'
import { Plus, Search, Filter, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GroupedTaskListProps {
  tasks: Task[]
  groups: TaskGroup[]
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDeleteTask: (taskId: string) => Promise<void>
  onEditTask?: (taskId: string) => void
  onExtendTask?: (taskId: string) => void
  onUnscheduleTask?: (taskId: string) => Promise<void>
  onCreateTask?: () => void
  showAllTasks?: boolean
  onShowAllTasksChange?: (show: boolean) => void
}

type GroupByOption = 'status' | 'group' | 'none'
type FilterOption = 'all' | 'pending' | 'in_progress' | 'completed' | 'cancelled'

export function GroupedTaskList({
  tasks,
  groups,
  onUpdateTask,
  onDeleteTask,
  onEditTask,
  onExtendTask,
  onUnscheduleTask,
  onCreateTask,
  showAllTasks = false,
  onShowAllTasksChange
}: GroupedTaskListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupByOption>('status')
  const [filter, setFilter] = useState<FilterOption>('all')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'priority' | 'scheduled' | 'created'>('priority')

  // Initialize with all sections expanded
  useEffect(() => {
    if (groupBy === 'status') {
      setExpandedSections(new Set(['pending', 'in_progress', 'completed', 'cancelled']))
    } else if (groupBy === 'group') {
      const allGroupIds = ['ungrouped', ...groups.map(g => g.id)]
      setExpandedSections(new Set(allGroupIds))
    }
  }, [groupBy, groups])

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    // Search filter
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !task.description?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }

    // Status filter
    if (filter !== 'all' && task.status !== filter) {
      return false
    }

    // Show all tasks or only unscheduled
    if (!showAllTasks) {
      const isUnscheduled = !task.scheduled_start || !task.scheduled_end
      if (!isUnscheduled) return false
    }

    return true
  })

  // Sort tasks
  const sortedTasks = (() => {
    switch (sortBy) {
      case 'priority':
        return sortTasksByPriority(filteredTasks)
      case 'scheduled':
        return sortTasksByScheduledTime(filteredTasks)
      case 'created':
        return sortTasksByCreatedTime(filteredTasks)
      default:
        return filteredTasks
    }
  })()

  // Group tasks
  const groupedTasks: Record<string, Task[]> = (() => {
    if (groupBy === 'status') {
      const grouped: Record<string, Task[]> = {
        pending: [],
        in_progress: [],
        completed: [],
        cancelled: []
      }
      sortedTasks.forEach(task => {
        if (grouped[task.status]) {
          grouped[task.status].push(task)
        }
      })
      return grouped
    } else if (groupBy === 'group') {
      const grouped: Record<string, Task[]> = {
        ungrouped: []
      }
      groups.forEach(group => {
        grouped[group.id] = []
      })
      sortedTasks.forEach(task => {
        if (task.group_id) {
          if (grouped[task.group_id]) {
            grouped[task.group_id].push(task)
          }
        } else {
          grouped.ungrouped.push(task)
        }
      })
      return grouped
    } else {
      return { all: sortedTasks }
    }
  })()

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  const expandAll = () => {
    if (groupBy === 'status') {
      setExpandedSections(new Set(['pending', 'in_progress', 'completed', 'cancelled']))
    } else if (groupBy === 'group') {
      const allGroupIds = ['ungrouped', ...groups.map(g => g.id)]
      setExpandedSections(new Set(allGroupIds))
    }
  }

  const collapseAll = () => {
    setExpandedSections(new Set())
  }

  const getStatusLabel = (status: TaskStatus) => {
    switch (status) {
      case 'pending': return 'Pending'
      case 'in_progress': return 'In Progress'
      case 'completed': return 'Completed'
      case 'cancelled': return 'Cancelled'
    }
  }

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case 'pending': return 'bg-blue-500'
      case 'in_progress': return 'bg-yellow-500'
      case 'completed': return 'bg-green-500'
      case 'cancelled': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const taskCounts = {
    all: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    cancelled: tasks.filter(t => t.status === 'cancelled').length,
  }

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tasks</h2>
          <p className="text-muted-foreground">
            {filteredTasks.length} of {tasks.length} tasks
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        </div>
        {onCreateTask && (
          <Button onClick={onCreateTask}>
            <Plus className="w-4 h-4 mr-2" />
            Add Task
          </Button>
        )}
      </div>

      {/* Filter and Control Buttons */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={filter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('all')}
              >
                All ({taskCounts.all})
              </Button>
              <Button
                variant={filter === 'pending' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('pending')}
              >
                Pending ({taskCounts.pending})
              </Button>
              <Button
                variant={filter === 'in_progress' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('in_progress')}
              >
                In Progress ({taskCounts.in_progress})
              </Button>
              <Button
                variant={filter === 'completed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('completed')}
              >
                Completed ({taskCounts.completed})
              </Button>
              <Button
                variant={filter === 'cancelled' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('cancelled')}
              >
                Cancelled ({taskCounts.cancelled})
              </Button>
            </div>

            {/* Group by and other controls */}
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Group by:</span>
                <Button
                  variant={groupBy === 'status' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGroupBy('status')}
                >
                  Status
                </Button>
                <Button
                  variant={groupBy === 'group' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGroupBy('group')}
                >
                  Group
                </Button>
                <Button
                  variant={groupBy === 'none' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGroupBy('none')}
                >
                  None
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'priority' | 'scheduled' | 'created')}
                  className="px-3 py-1.5 text-sm border rounded-md bg-background"
                >
                  <option value="priority">Priority</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="created">Created</option>
                </select>
              </div>

              {onShowAllTasksChange && (
                <Button
                  variant={showAllTasks ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onShowAllTasksChange(!showAllTasks)}
                >
                  {showAllTasks ? 'Show Unscheduled Only' : 'Show All'}
                </Button>
              )}

              {groupBy !== 'none' && (
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={expandAll}>
                    Expand All
                  </Button>
                  <Button variant="outline" size="sm" onClick={collapseAll}>
                    Collapse All
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grouped Task Lists */}
      {groupBy === 'status' && (
        <div className="space-y-3">
          {(['pending', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map(status => {
            const sectionTasks = groupedTasks[status] || []
            if (sectionTasks.length === 0 && filter !== 'all' && filter !== status) return null

            return (
              <Card key={status}>
                <CardHeader 
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleSection(status)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expandedSections.has(status) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <div className={cn("w-3 h-3 rounded-full", getStatusColor(status))} />
                      <CardTitle className="text-lg">{getStatusLabel(status)}</CardTitle>
                      <Badge variant="secondary">{sectionTasks.length}</Badge>
                    </div>
                  </div>
                </CardHeader>
                {expandedSections.has(status) && (
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {sectionTasks.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No {getStatusLabel(status).toLowerCase()} tasks
                        </p>
                      ) : (
                        sectionTasks.map(task => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onUpdate={onUpdateTask}
                            onDelete={onDeleteTask}
                            onEdit={onEditTask}
                            onExtend={onExtendTask}
                            onUnschedule={onUnscheduleTask}
                            groups={groups}
                          />
                        ))
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {groupBy === 'group' && (
        <div className="space-y-3">
          {/* Ungrouped tasks */}
          <Card>
            <CardHeader 
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => toggleSection('ungrouped')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {expandedSections.has('ungrouped') ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <div className="w-3 h-3 rounded-full bg-gray-500" />
                  <CardTitle className="text-lg">Ungrouped</CardTitle>
                  <Badge variant="secondary">{(groupedTasks.ungrouped || []).length}</Badge>
                </div>
              </div>
            </CardHeader>
            {expandedSections.has('ungrouped') && (
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {(groupedTasks.ungrouped || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No ungrouped tasks
                    </p>
                  ) : (
                    (groupedTasks.ungrouped || []).map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onUpdate={onUpdateTask}
                        onDelete={onDeleteTask}
                        onEdit={onEditTask}
                        onExtend={onExtendTask}
                        onUnschedule={onUnscheduleTask}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Group tasks */}
          {groups.map(group => {
            const sectionTasks = groupedTasks[group.id] || []
            if (sectionTasks.length === 0) return null

            return (
              <Card key={group.id}>
                <CardHeader 
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleSection(group.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {expandedSections.has(group.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <div
                        className="w-3 h-3 rounded-full border"
                        style={{ backgroundColor: group.color }}
                      />
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                      <Badge variant="secondary">{sectionTasks.length}</Badge>
                    </div>
                  </div>
                </CardHeader>
                {expandedSections.has(group.id) && (
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {sectionTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onUpdate={onUpdateTask}
                          onDelete={onDeleteTask}
                          onEdit={onEditTask}
                          onExtend={onExtendTask}
                          onUnschedule={onUnscheduleTask}
                        />
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {groupBy === 'none' && (
        <div className="space-y-3">
          {sortedTasks.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No tasks found</p>
              </CardContent>
            </Card>
          ) : (
            sortedTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdate={onUpdateTask}
                onDelete={onDeleteTask}
                onEdit={onEditTask}
                onExtend={onExtendTask}
                onUnschedule={onUnscheduleTask}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

