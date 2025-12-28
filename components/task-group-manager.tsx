"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Edit,
  Eye,
  EyeOff,
  Folder,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SlimTaskCard } from "@/components/slim-task-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CreateTaskGroupRequest, Task, TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TaskGroupManagerProps {
  onGroupSelect?: (groupId: string | null) => void;
  selectedGroupId?: string | null;
  tasks?: Task[];
  onTaskClick?: (taskId: string) => void;
  showAllTasks?: boolean;
  onShowAllTasksChange?: (show: boolean) => void;
  onHiddenGroupsChange?: (hiddenGroups: Set<string>) => void;
}

const defaultColors = [
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#10B981" },
  { name: "Yellow", value: "#F59E0B" },
  { name: "Red", value: "#EF4444" },
  { name: "Purple", value: "#8B5CF6" },
  { name: "Pink", value: "#EC4899" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Gray", value: "#6B7280" },
];

// Helper to determine if text should be light or dark based on background
function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

interface GroupCardProps {
  groupId: string;
  groupName: string;
  groupColor: string;
  taskCount: number;
  tasks: Task[];
  isExpanded: boolean;
  isHidden: boolean;
  isSelected: boolean;
  isOtherSelected: boolean;
  showAllTasks: boolean;
  onToggleExpand: () => void;
  onToggleVisibility: () => void;
  onSelect: () => void;
  onTaskClick?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isUngrouped?: boolean;
}

function GroupCard({
  groupId,
  groupName,
  groupColor,
  taskCount,
  tasks,
  isExpanded,
  isHidden,
  isSelected,
  isOtherSelected,
  showAllTasks,
  onToggleExpand,
  onToggleVisibility,
  onSelect,
  onTaskClick,
  onEdit,
  onDelete,
  isUngrouped = false,
}: GroupCardProps) {
  const textColor = getContrastColor(groupColor);

  return (
    <Card
      className={cn(
        "transition-opacity duration-200 overflow-hidden",
        isOtherSelected && "opacity-40"
      )}
    >
      {/* Colored Header */}
      <div
        className="px-3 py-2 cursor-pointer"
        style={{ backgroundColor: groupColor }}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: textColor }}>
              {groupName}
            </span>
          </div>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem] bg-white/20 text-inherit border-0"
            style={{ color: textColor }}
          >
            {taskCount}
          </Badge>
        </div>
      </div>

      {/* Buttons Row - Shown when collapsed */}
      {!isExpanded && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-t bg-muted/30">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={isHidden ? "Show in calendar" : "Hide from calendar"}
          >
            {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          {!isUngrouped && onEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="Edit group"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isUngrouped && onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete group"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Tasks - Shown when expanded */}
      {isExpanded && (
        <CardContent className="pt-0 pb-2 px-2 space-y-1 overflow-y-auto max-h-64">
          {/* Minimal header when expanded */}
          <div className="flex items-center justify-end py-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          {tasks.map((task) => (
            <SlimTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
          ))}
          {tasks.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">
              No {showAllTasks ? "tasks" : "unscheduled tasks"}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function TaskGroupManager({
  onGroupSelect,
  selectedGroupId,
  tasks = [],
  onTaskClick,
  showAllTasks = false,
  onShowAllTasksChange,
  onHiddenGroupsChange,
}: TaskGroupManagerProps) {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3B82F6");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());

  const fetchGroups = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/task-groups");
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      } else {
        console.error("Failed to fetch task groups");
      }
    } catch (error) {
      console.error("Error fetching task groups:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-rotate color when create dialog opens
  useEffect(() => {
    if (isCreateDialogOpen) {
      const getNextColor = () => {
        const usedColors = new Set(groups.map((g) => g.color));

        // Find first unused color
        for (const color of defaultColors) {
          if (!usedColors.has(color.value)) {
            return color.value;
          }
        }

        // All colors used, cycle to next color after last created group
        if (groups.length > 0) {
          const lastGroup = groups[groups.length - 1];
          const lastColorIndex = defaultColors.findIndex((c) => c.value === lastGroup.color);
          const nextColorIndex = (lastColorIndex + 1) % defaultColors.length;
          return defaultColors[nextColorIndex].value;
        }

        // No groups exist, start with first color
        return defaultColors[0].value;
      };

      setNewGroupColor(getNextColor());
    }
  }, [isCreateDialogOpen, groups]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      const response = await fetch("/api/task-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
        } as CreateTaskGroupRequest),
      });

      if (response.ok) {
        const data = await response.json();
        setGroups((prev) => [...prev, data.group]);
        setNewGroupName("");
        setNewGroupColor("#3B82F6");
        setIsCreateDialogOpen(false);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Failed to create task group" }));
        console.error("Failed to create task group:", errorData.error || "Unknown error");
        alert(errorData.error || "Failed to create task group. Please try again.");
      }
    } catch (error) {
      console.error("Error creating task group:", error);
      alert("An error occurred while creating the task group. Please try again.");
    }
  };

  const updateGroup = async (groupId: string, updates: Partial<TaskGroup>) => {
    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        const data = await response.json();
        setGroups((prev) => prev.map((group) => (group.id === groupId ? data.group : group)));
        setIsEditDialogOpen(false);
        setEditingGroup(null);
      } else {
        console.error("Failed to update task group");
      }
    } catch (error) {
      console.error("Error updating task group:", error);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!confirm("Are you sure you want to delete this group? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setGroups((prev) => prev.filter((group) => group.id !== groupId));
        if (selectedGroupId === groupId) {
          onGroupSelect?.(null);
        }
      } else {
        console.error("Failed to delete task group");
      }
    } catch (error) {
      console.error("Error deleting task group:", error);
    }
  };

  const handleEditGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    setNewGroupName(group.name);
    setNewGroupColor(group.color);
    setIsEditDialogOpen(true);
  };

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const toggleGroupVisibility = (groupId: string) => {
    setHiddenGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      onHiddenGroupsChange?.(newSet);
      return newSet;
    });
  };

  const expandAllGroups = () => {
    const allGroupIds = new Set(["ungrouped", ...groups.map((g) => g.id)]);
    setExpandedGroups(allGroupIds);
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const allGroupsExpanded = () => {
    const allGroupIds = new Set(["ungrouped", ...groups.map((g) => g.id)]);
    return (
      allGroupIds.size === expandedGroups.size &&
      Array.from(allGroupIds).every((id) => expandedGroups.has(id))
    );
  };

  const getUnscheduledTasksForGroup = (groupId: string | null) => {
    return tasks.filter((task) => {
      const isUnscheduled = !task.scheduled_start || !task.scheduled_end;
      if (groupId === null) {
        return isUnscheduled && !task.group_id;
      }
      return isUnscheduled && task.group_id === groupId;
    });
  };

  const getAllTasksForGroup = (groupId: string | null) => {
    return tasks.filter((task) => {
      if (groupId === null) {
        return !task.group_id;
      }
      return task.group_id === groupId;
    });
  };

  const getTasksForGroup = (groupId: string | null) => {
    return showAllTasks ? getAllTasksForGroup(groupId) : getUnscheduledTasksForGroup(groupId);
  };

  const getTaskCountForGroup = (groupId: string | null) => {
    if (showAllTasks) {
      if (groupId === null) {
        return tasks.filter((t) => !t.group_id).length;
      }
      return tasks.filter((t) => t.group_id === groupId).length;
    }
    return getUnscheduledTasksForGroup(groupId).length;
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full max-h-full overflow-hidden w-full">
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Loading groups...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden w-full">
      {/* Control buttons row */}
      <div className="flex-shrink-0 pb-2 px-3 pt-3 flex items-center gap-2 flex-wrap">
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 px-3">
              <Plus className="h-4 w-4 mr-1.5" />
              <span className="text-xs">New</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Group</DialogTitle>
              <DialogDescription>Create a new task group to organize your tasks.</DialogDescription>
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
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => {
            if (allGroupsExpanded()) {
              collapseAllGroups();
            } else {
              expandAllGroups();
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
        <Button
          variant={showAllTasks ? "default" : "outline"}
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => onShowAllTasksChange?.(!showAllTasks)}
        >
          {showAllTasks ? "All" : "Unscheduled"}
        </Button>
      </div>

      {/* Content */}
      <div className="space-y-2 overflow-y-auto overflow-x-hidden flex-1 min-h-0 px-3 pb-3">
        {/* Task Groups first */}
        {groups.map((group) => (
          <GroupCard
            key={group.id}
            groupId={group.id}
            groupName={group.name}
            groupColor={group.color}
            taskCount={getTaskCountForGroup(group.id)}
            tasks={getTasksForGroup(group.id)}
            isExpanded={expandedGroups.has(group.id)}
            isHidden={hiddenGroups.has(group.id)}
            isSelected={selectedGroupId === group.id}
            isOtherSelected={selectedGroupId !== null && selectedGroupId !== group.id}
            showAllTasks={showAllTasks}
            onToggleExpand={() => toggleGroupExpansion(group.id)}
            onToggleVisibility={() => toggleGroupVisibility(group.id)}
            onSelect={() => {
              if (selectedGroupId === group.id) {
                onGroupSelect?.(null);
              } else {
                onGroupSelect?.(group.id);
              }
            }}
            onTaskClick={onTaskClick}
            onEdit={() => handleEditGroup(group)}
            onDelete={() => deleteGroup(group.id)}
          />
        ))}

        {groups.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <Folder className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No task groups yet</p>
            <p className="text-[10px]">Create your first group to organize tasks</p>
          </div>
        )}

        {/* Ungrouped at the bottom */}
        <GroupCard
          groupId="ungrouped"
          groupName="Ungrouped"
          groupColor="#6B7280"
          taskCount={getTaskCountForGroup(null)}
          tasks={getTasksForGroup(null)}
          isExpanded={expandedGroups.has("ungrouped")}
          isHidden={hiddenGroups.has("ungrouped")}
          isSelected={selectedGroupId === "ungrouped"}
          isOtherSelected={selectedGroupId !== null && selectedGroupId !== "ungrouped"}
          showAllTasks={showAllTasks}
          onToggleExpand={() => toggleGroupExpansion("ungrouped")}
          onToggleVisibility={() => toggleGroupVisibility("ungrouped")}
          onSelect={() => {
            if (selectedGroupId === "ungrouped") {
              onGroupSelect?.(null);
            } else {
              onGroupSelect?.("ungrouped");
            }
          }}
          onTaskClick={onTaskClick}
          isUngrouped
        />
      </div>

      {/* Edit Group Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>Update the group name and color.</DialogDescription>
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
                onClick={() =>
                  editingGroup &&
                  updateGroup(editingGroup.id, {
                    name: newGroupName.trim(),
                    color: newGroupColor,
                  })
                }
                disabled={!newGroupName.trim()}
              >
                Update Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Re-export DraggableTaskItem for backward compatibility (used in calendar page)
export { SlimTaskCard as DraggableTaskItem } from "@/components/slim-task-card";
