'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Edit, Trash2, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { TaskGroup, CreateTaskGroupRequest } from '@/lib/types'
import { cn } from '@/lib/utils'

interface TaskGroupManagerProps {
  onGroupSelect?: (groupId: string | null) => void
  selectedGroupId?: string | null
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

export function TaskGroupManager({ onGroupSelect, selectedGroupId }: TaskGroupManagerProps) {
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState('#3B82F6')

  useEffect(() => {
    fetchGroups()
  }, [])

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Task Groups
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                New Group
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
        </CardTitle>
        <CardDescription>
          Organize your tasks into groups for better management
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* All Tasks Option */}
        <div
          className={cn(
            "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
            selectedGroupId === null 
              ? "bg-accent text-accent-foreground" 
              : "hover:bg-accent/50"
          )}
          onClick={() => onGroupSelect?.(null)}
        >
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-gray-500" />
            <span className="font-medium">All Tasks</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {groups.reduce((acc, group) => acc + (group.collapsed ? 0 : 1), 0)} groups
          </Badge>
        </div>

        {/* Task Groups */}
        {groups.map((group) => (
          <div key={group.id} className="space-y-1">
            <div
              className={cn(
                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                selectedGroupId === group.id 
                  ? "bg-accent text-accent-foreground" 
                  : "hover:bg-accent/50"
              )}
              onClick={() => onGroupSelect?.(group.id)}
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-4 h-4 rounded-full border" 
                  style={{ backgroundColor: group.color }}
                />
                <span className="font-medium">{group.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditGroup(group)
                  }}
                >
                  <Edit className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteGroup(group.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        {groups.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No task groups yet</p>
            <p className="text-xs">Create your first group to organize tasks</p>
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
