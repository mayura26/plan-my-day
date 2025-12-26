'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Edit, Trash2, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Folder, CheckSquare, Eye, EyeOff } from 'lucide-react'
import { TaskGroup, CreateTaskGroupRequest, Task } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

interface TaskGroupManagerProps {
  onGroupSelect?: (groupId: string | null) => void
  selectedGroupId?: string | null
  tasks?: Task[]
  onTaskClick?: (taskId: string) => void
  showAllTasks?: boolean
  onShowAllTasksChange?: (show: boolean) => void
  onHiddenGroupsChange?: (hiddenGroups: Set<string>) => void
}

const defaultColors = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Yellow', value: '#F59E0B' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Gray', value: '#6B7280' },
]

// Draggable task item component for sidebar
export function DraggableTaskItem({ task, onTaskClick }: { task: Task, onTaskClick?: (taskId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.locked,
    data: {
      type: 'sidebar-task',
      task,
    },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none' as const, // Prevent touch scrolling from interfering with drag
  }

  // Track if we're dragging to prevent onClick from firing
  const handleClick = (e: React.MouseEvent) => {
    // Only trigger onClick if we're not dragging
    if (!isDragging) {
      onTaskClick?.(task.id)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "p-1.5 rounded border bg-card hover:bg-accent/50 transition-colors cursor-grab active:cursor-grabbing text-xs overflow-hidden",
        task.locked && "cursor-not-allowed opacity-75"
      )}
      onClick={handleClick}
    >
      <div className="font-medium truncate text-xs leading-tight">{task.title}</div>
      <div className="flex items-center gap-1 mt-1">
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
          P{task.priority}
        </Badge>
        {task.locked && (
          <span className="text-[10px] text-muted-foreground">🔒</span>
        )}
      </div>
    </div>
  )
}

export function TaskGroupManager({ 
  onGroupSelect, 
  selectedGroupId, 
  tasks = [], 
  onTaskClick,
  showAllTasks = false,
  onShowAllTasksChange,
  onHiddenGroupsChange
}: TaskGroupManagerProps) {
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#3B82F6')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchGroups()
  }, [])

  // Auto-rotate color when create dialog opens
  useEffect(() => {
    if (isCreateDialogOpen) {
      const getNextColor = () => {
        const usedColors = new Set(groups.map(g => g.color))
        
        // Find first unused color
        for (const color of defaultColors) {
          if (!usedColors.has(color.value)) {
            return color.value
          }
        }
        
        // All colors used, cycle to next color after last created group
        if (groups.length > 0) {
          const lastGroup = groups[groups.length - 1]
          const lastColorIndex = defaultColors.findIndex(c => c.value === lastGroup.color)
          const nextColorIndex = (lastColorIndex + 1) % defaultColors.length
          return defaultColors[nextColorIndex].value
        }
        
        // No groups exist, start with first color
        return defaultColors[0].value
      }
      
      setNewGroupColor(getNextColor())
    }
  }, [isCreateDialogOpen, groups])

  const fetchGroups = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/task-groups')
      if (response.ok) {
        const data = await response.json()
        setGroups(data.groups || [])
      } else {
        console.error('Failed to fetch task groups')
      }
    } catch (error) {
      console.error('Error fetching task groups:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const createGroup = async () => {
    if (!newGroupName.trim()) return

    try {
      const response = await fetch('/api/task-groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
        } as CreateTaskGroupRequest),
      })

      if (response.ok) {
        const data = await response.json()
        setGroups(prev => [...prev, data.group])
        setNewGroupName('')
        setNewGroupColor('#3B82F6')
        setIsCreateDialogOpen(false)
      } else {
        console.error('Failed to create task group')
      }
    } catch (error) {
      console.error('Error creating task group:', error)
    }
  }

  const updateGroup = async (groupId: string, updates: Partial<TaskGroup>) => {
    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (response.ok) {
        const data = await response.json()
        setGroups(prev => prev.map(group => 
          group.id === groupId ? data.group : group
        ))
        setIsEditDialogOpen(false)
        setEditingGroup(null)
      } else {
        console.error('Failed to update task group')
      }
    } catch (error) {
      console.error('Error updating task group:', error)
    }
  }

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
      return
    }

    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setGroups(prev => prev.filter(group => group.id !== groupId))
        if (selectedGroupId === groupId) {
          onGroupSelect?.(null)
        }
      } else {
        console.error('Failed to delete task group')
      }
    } catch (error) {
      console.error('Error deleting task group:', error)
    }
  }

  const toggleGroupCollapse = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (group) {
      updateGroup(groupId, { collapsed: !group.collapsed })
    }
  }

  const handleEditGroup = (group: TaskGroup) => {
    setEditingGroup(group)
    setNewGroupName(group.name)
    setNewGroupColor(group.color)
    setIsEditDialogOpen(true)
  }

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      return newSet
    })
  }

  const toggleGroupVisibility = (groupId: string) => {
    setHiddenGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      onHiddenGroupsChange?.(newSet)
      return newSet
    })
  }

  const expandAllGroups = () => {
    const allGroupIds = new Set(['ungrouped', ...groups.map(g => g.id)])
    setExpandedGroups(allGroupIds)
  }

  const collapseAllGroups = () => {
    setExpandedGroups(new Set())
  }

  const allGroupsExpanded = () => {
    const allGroupIds = new Set(['ungrouped', ...groups.map(g => g.id)])
    return allGroupIds.size === expandedGroups.size && 
           Array.from(allGroupIds).every(id => expandedGroups.has(id))
  }

  const getUnscheduledTasksForGroup = (groupId: string | null) => {
    return tasks.filter(task => {
      const isUnscheduled = !task.scheduled_start || !task.scheduled_end
      if (groupId === null) {
        return isUnscheduled && !task.group_id
      }
      return isUnscheduled && task.group_id === groupId
    })
  }

  const getAllTasksForGroup = (groupId: string | null) => {
    return tasks.filter(task => {
      if (groupId === null) {
        return !task.group_id
      }
      return task.group_id === groupId
    })
  }

  const getTasksForGroup = (groupId: string | null) => {
    return showAllTasks ? getAllTasksForGroup(groupId) : getUnscheduledTasksForGroup(groupId)
  }

  const getTaskCountForGroup = (groupId: string | null) => {
    if (showAllTasks) {
      if (groupId === null) {
        return tasks.filter(t => !t.group_id).length
      }
      return tasks.filter(t => t.group_id === groupId).length
    }
    return getUnscheduledTasksForGroup(groupId).length
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Task Groups
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading groups...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col h-full max-h-full overflow-hidden w-full">
      <CardHeader className="flex-shrink-0 pb-3 px-3 pt-3">
        <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Folder className="h-5 w-5 flex-shrink-0" />
            <CardTitle className="truncate text-base">Task Groups</CardTitle>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => {
                if (allGroupsExpanded()) {
                  collapseAllGroups()
                } else {
                  expandAllGroups()
                }
              }}
              title={allGroupsExpanded() ? "Collapse All" : "Expand All"}
            >
              {allGroupsExpanded() ? (
                <ChevronsUp className="h-4 w-4" />
              ) : (
                <ChevronsDown className="h-4 w-4" />
              )}
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline ml-1.5 text-xs">New</span>
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Group</DialogTitle>
                <DialogDescription>
                  Create a new task group to organize your tasks.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Group Name</label>
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Enter group name"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Color</label>
                  <Select value={newGroupColor} onValueChange={setNewGroupColor}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {defaultColors.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-4 h-4 rounded-full border" 
                              style={{ backgroundColor: color.value }}
                            />
                            {color.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createGroup} disabled={!newGroupName.trim()}>
                    Create Group
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>
        <CardDescription className="text-xs mt-1">
          Organize your tasks into groups for better management
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 overflow-y-auto overflow-x-hidden flex-1 min-h-0 px-3 pb-3">
        {/* Show All Tasks Toggle */}
        <div className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CheckSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium truncate">Show All Tasks</span>
          </div>
          <Button
            variant={showAllTasks ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs flex-shrink-0"
            onClick={() => onShowAllTasksChange?.(!showAllTasks)}
          >
            {showAllTasks ? 'All' : 'Unscheduled'}
          </Button>
        </div>
        {/* All Tasks (Ungrouped) */}
        <Card className={cn(
          "transition-opacity duration-200 overflow-hidden",
          selectedGroupId !== null && "opacity-40"
        )}>
          <CardHeader className="pb-2 px-3 pt-3">
            <div
              className={cn(
                "flex items-center justify-between cursor-pointer gap-2",
                selectedGroupId === null && "text-accent-foreground"
              )}
              onClick={() => {
                // Toggle: if clicking the same group (ungrouped), deselect; otherwise select
                if (selectedGroupId === null) {
                  onGroupSelect?.(null) // Deselect
                } else {
                  onGroupSelect?.(null) // Select ungrouped
                }
              }}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-3 h-3 rounded-full bg-gray-500 flex-shrink-0" />
                <CardTitle className="text-sm font-medium truncate">Ungrouped</CardTitle>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem]">
                  {getTaskCountForGroup(null)}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGroupVisibility('ungrouped')
                  }}
                  title={hiddenGroups.has('ungrouped') ? "Show group" : "Hide group"}
                >
                  {hiddenGroups.has('ungrouped') ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGroupExpansion('ungrouped')
                  }}
                >
                  {expandedGroups.has('ungrouped') ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          
          {/* Ungrouped Tasks */}
          {expandedGroups.has('ungrouped') && (
            <CardContent className="pt-0 pb-2 px-3 space-y-1.5 overflow-y-auto max-h-64" style={{ pointerEvents: 'auto' }}>
              {getTasksForGroup(null).map((task) => (
                <DraggableTaskItem
                  key={task.id}
                  task={task}
                  onTaskClick={onTaskClick}
                />
              ))}
              {getTasksForGroup(null).length === 0 && (
                <p className="text-xs text-muted-foreground p-2 text-center">No {showAllTasks ? 'tasks' : 'unscheduled tasks'}</p>
              )}
            </CardContent>
          )}
        </Card>

        {/* Task Groups */}
        {groups.map((group) => (
          <Card 
            key={group.id}
            className={cn(
              "transition-opacity duration-200 overflow-hidden",
              (selectedGroupId !== group.id) && "opacity-40"
            )}
          >
            <CardHeader className="pb-2 px-3 pt-3">
              <div
                className={cn(
                  "flex items-center justify-between cursor-pointer gap-2",
                  selectedGroupId === group.id && "text-accent-foreground"
                )}
                onClick={() => {
                  // Toggle: if clicking the same group, deselect; otherwise select
                  if (selectedGroupId === group.id) {
                    onGroupSelect?.(null)
                  } else {
                    onGroupSelect?.(group.id)
                  }
                }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div 
                    className="w-3 h-3 rounded-full border flex-shrink-0" 
                    style={{ backgroundColor: group.color }}
                  />
                  <CardTitle className="text-sm font-medium truncate">{group.name}</CardTitle>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem]">
                    {getTaskCountForGroup(group.id)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroupVisibility(group.id)
                    }}
                    title={hiddenGroups.has(group.id) ? "Show group" : "Hide group"}
                  >
                    {hiddenGroups.has(group.id) ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroupExpansion(group.id)
                    }}
                  >
                    {expandedGroups.has(group.id) ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditGroup(group)
                    }}
                    title="Edit group"
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteGroup(group.id)
                    }}
                    title="Delete group"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            {/* Group Tasks */}
            {expandedGroups.has(group.id) && (
              <CardContent className="pt-0 pb-2 px-3 space-y-1.5 overflow-y-auto max-h-64" style={{ pointerEvents: 'auto' }}>
                {getTasksForGroup(group.id).map((task) => (
                  <DraggableTaskItem
                    key={task.id}
                    task={task}
                    onTaskClick={onTaskClick}
                  />
                ))}
                {getTasksForGroup(group.id).length === 0 && (
                  <p className="text-xs text-muted-foreground p-2 text-center">No {showAllTasks ? 'tasks' : 'unscheduled tasks'}</p>
                )}
              </CardContent>
            )}
          </Card>
        ))}

        {groups.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <Folder className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No task groups yet</p>
            <p className="text-[10px]">Create your first group to organize tasks</p>
          </div>
        )}
      </CardContent>

      {/* Edit Group Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>
              Update the group name and color.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Group Name</label>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter group name"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <Select value={newGroupColor} onValueChange={setNewGroupColor}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {defaultColors.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full border" 
                          style={{ backgroundColor: color.value }}
                        />
                        {color.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={() => editingGroup && updateGroup(editingGroup.id, { 
                  name: newGroupName.trim(), 
                  color: newGroupColor 
                })}
                disabled={!newGroupName.trim()}
              >
                Update Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
