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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SlimTaskCard } from "@/components/slim-task-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { EditGroupDialog } from "./edit-group-dialog";

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

// Helper function to get all descendant group IDs (including nested descendants)
function getGroupDescendants(groupId: string, groups: TaskGroup[]): string[] {
  const descendants: string[] = [];
  const queue = [groupId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    const children = groups.filter((g) => g.parent_group_id === currentId);

    for (const child of children) {
      if (!descendants.includes(child.id)) {
        descendants.push(child.id);
        queue.push(child.id);
      }
    }
  }

  return descendants;
}

// Hierarchical group structure
interface HierarchicalGroup extends TaskGroup {
  children: HierarchicalGroup[];
  isParent: boolean;
}

// Build hierarchical structure from flat list
function buildGroupHierarchy(groups: TaskGroup[]): HierarchicalGroup[] {
  // Create a map of all groups
  const groupMap = new Map<string, HierarchicalGroup>();

  // Initialize all groups with empty children arrays
  groups.forEach((group) => {
    groupMap.set(group.id, {
      ...group,
      children: [],
      isParent: group.is_parent_group || false, // Mark parent groups as parents immediately
    });
  });

  // Build the tree structure
  const rootGroups: HierarchicalGroup[] = [];

  groups.forEach((group) => {
    const hierarchicalGroup = groupMap.get(group.id);
    if (!hierarchicalGroup) return;

    if (group.parent_group_id) {
      const parent = groupMap.get(group.parent_group_id);
      if (parent) {
        parent.children.push(hierarchicalGroup);
        parent.isParent = true; // Mark parent as having children
      } else {
        // Parent not found, treat as root
        rootGroups.push(hierarchicalGroup);
      }
    } else {
      rootGroups.push(hierarchicalGroup);
    }
  });

  // Sort groups alphabetically at each level
  // Separate regular groups from parent groups, with regular groups first
  const sortGroups = (groupList: HierarchicalGroup[]): HierarchicalGroup[] => {
    // Separate regular groups (not parent groups) from parent groups
    const regularGroups = groupList.filter((g) => !g.is_parent_group);
    const parentGroups = groupList.filter((g) => g.is_parent_group);

    // Sort each category alphabetically
    const sortedRegular = [...regularGroups].sort((a, b) => a.name.localeCompare(b.name));
    const sortedParent = [...parentGroups].sort((a, b) => a.name.localeCompare(b.name));

    // Sort children recursively for both types
    sortedRegular.forEach((group) => {
      if (group.children.length > 0) {
        group.children = sortGroups(group.children);
      }
    });
    sortedParent.forEach((group) => {
      if (group.children.length > 0) {
        group.children = sortGroups(group.children);
      }
    });

    // Return regular groups first, then parent groups
    return [...sortedRegular, ...sortedParent];
  };

  return sortGroups(rootGroups);
}

// Flatten hierarchical structure back to array for processing
function _flattenGroupHierarchy(hierarchicalGroups: HierarchicalGroup[]): HierarchicalGroup[] {
  const result: HierarchicalGroup[] = [];

  const traverse = (groups: HierarchicalGroup[]) => {
    for (const group of groups) {
      result.push(group);
      if (group.children.length > 0) {
        traverse(group.children);
      }
    }
  };

  traverse(hierarchicalGroups);
  return result;
}

interface GroupCardProps {
  groupName: string;
  groupColor: string;
  taskCount: number;
  childGroupCount?: number;
  tasks: Task[];
  isExpanded: boolean;
  isHidden: boolean;
  isOtherSelected: boolean;
  showAllTasks: boolean;
  onToggleExpand: () => void;
  onToggleVisibility: () => void;
  onSelect: () => void;
  onTaskClick?: (taskId: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isUngrouped?: boolean;
  isParent?: boolean;
  indentLevel?: number;
  children?: React.ReactNode;
  isDeleting?: boolean;
  subtasksMap?: Map<string, Task[]>;
}

function GroupCard({
  groupName,
  groupColor,
  taskCount,
  childGroupCount = 0,
  tasks,
  isExpanded,
  isHidden,
  isOtherSelected,
  showAllTasks,
  onToggleExpand,
  onToggleVisibility,
  onSelect,
  onTaskClick,
  onEdit,
  onDelete,
  isUngrouped = false,
  isParent = false,
  indentLevel = 0,
  children,
  isDeleting = false,
  subtasksMap = new Map(),
}: GroupCardProps) {
  const textColor = getContrastColor(groupColor);

  // For parent groups, render as wireframe container
  if (isParent) {
    return (
      <div
        className={cn(
          "transition-opacity duration-200",
          "border-2 border-dashed rounded-lg",
          "p-2 space-y-2",
          isOtherSelected && "opacity-40",
          indentLevel > 0 && `ml-${indentLevel * 4}`
        )}
        style={{
          borderColor: groupColor,
          backgroundColor: `${groupColor}10`,
          ...(indentLevel > 0 ? { marginLeft: `${indentLevel * 16}px` } : {}),
        }}
      >
        {/* Parent Group Header */}
        <button
          type="button"
          className="flex items-center justify-between gap-2 px-2 py-1 cursor-pointer rounded hover:bg-black/5 w-full text-left"
          onClick={onSelect}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Folder className="h-4 w-4 shrink-0" style={{ color: groupColor }} />
            <span className="truncate text-sm font-semibold" style={{ color: groupColor }}>
              {groupName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem]"
              style={{ backgroundColor: `${groupColor}20`, color: groupColor }}
            >
              {childGroupCount}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              type="button"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" style={{ color: groupColor }} />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" style={{ color: groupColor }} />
              )}
            </Button>
          </div>
        </button>
        {/* Child groups rendered here when expanded */}
        {children}
      </div>
    );
  }

  // Regular group card (non-parent)
  return (
    <Card
      className={cn(
        "transition-opacity duration-200 overflow-hidden",
        "pt-0 pb-[5px] gap-0",
        isOtherSelected && "opacity-40",
        indentLevel > 0 && `ml-${indentLevel * 4}`
      )}
      style={indentLevel > 0 ? { marginLeft: `${indentLevel * 16}px` } : undefined}
    >
      {/* Colored Header */}
      <button
        type="button"
        className="px-3 pt-[5px] pb-0.5 cursor-pointer w-full text-left border-0 bg-transparent"
        style={{ backgroundColor: groupColor }}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="truncate text-sm font-medium" style={{ color: textColor }}>
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
      </button>

      {/* Buttons Row - Shown when collapsed */}
      {!isExpanded && (
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/30">
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
              loading={isDeleting}
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

      {/* Tasks - Shown when expanded (only for non-parent groups) */}
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
          {tasks.map((task) => {
            // Only show parent tasks (not subtasks themselves)
            if (task.parent_task_id) {
              return null;
            }
            const allSubtasks = subtasksMap.get(task.id) || [];
            // Filter subtasks based on showAllTasks setting
            const filteredSubtasks = showAllTasks
              ? allSubtasks.filter((st) => st.status !== "completed")
              : allSubtasks.filter(
                  (st) =>
                    st.status !== "completed" &&
                    (!st.scheduled_start || !st.scheduled_end)
                );
            return (
              <SlimTaskCard
                key={task.id}
                task={task}
                onTaskClick={onTaskClick}
                subtasks={filteredSubtasks.length > 0 ? filteredSubtasks : undefined}
              />
            );
          })}
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
  const { confirm } = useConfirmDialog();
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3B82F6");
  const [newParentGroupId, setNewParentGroupId] = useState<string | null>(null);
  const [isCreatingParentGroup, setIsCreatingParentGroup] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [subtasksMap, setSubtasksMap] = useState<Map<string, Task[]>>(new Map());

  const isFetchingRef = useRef<boolean>(false);
  const hasFetchedRef = useRef<boolean>(false);

  const fetchGroups = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

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
      isFetchingRef.current = false;
    }
  }, []);

  const fetchSubtasks = useCallback(async (parentTaskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}/subtasks`);
      if (response.ok) {
        const data = await response.json();
        const subtasks = data.subtasks || [];
        setSubtasksMap((prev) => {
          const newMap = new Map(prev);
          newMap.set(parentTaskId, subtasks);
          return newMap;
        });
      }
    } catch (error) {
      console.error("Error fetching subtasks:", error);
    }
  }, []);

  useEffect(() => {
    // Only fetch once on mount
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchGroups]); // Empty deps - only run once on mount

  // Clear and refetch subtasks when tasks change (e.g., after refresh)
  // This ensures we get updated subtask data including scheduling status
  useEffect(() => {
    // Clear the subtasks map to force refetch with fresh data
    setSubtasksMap(new Map());
    
    // Filter tasks to get parent tasks with subtasks
    const parentTasksWithSubtasks = tasks.filter(
      (task) => !task.parent_task_id && (task.subtask_count || 0) > 0
    );
    // Fetch subtasks for all parent tasks (will use fresh data)
    parentTasksWithSubtasks.forEach((task) => {
      fetchSubtasks(task.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, tasks.map((t) => t.id).join(',')]);

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

    setIsCreating(true);
    try {
      const response = await fetch("/api/task-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
          parent_group_id: isCreatingParentGroup ? undefined : newParentGroupId || undefined,
          is_parent_group: isCreatingParentGroup,
        } as CreateTaskGroupRequest),
      });

      if (response.ok) {
        const data = await response.json();
        setGroups((prev) => [...prev, data.group]);
        setNewGroupName("");
        setNewGroupColor("#3B82F6");
        setNewParentGroupId(null);
        setIsCreatingParentGroup(false);
        setIsCreateDialogOpen(false);
        toast.success(
          isCreatingParentGroup
            ? "Parent group created successfully"
            : "Task group created successfully"
        );
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Failed to create task group" }));
        console.error("Failed to create task group:", errorData.error || "Unknown error");
        toast.error(errorData.error || "Failed to create task group. Please try again.");
      }
    } catch (error) {
      console.error("Error creating task group:", error);
      toast.error("An error occurred while creating the task group. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const _updateGroup = async (groupId: string, updates: Partial<TaskGroup>) => {
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
        toast.success("Task group updated successfully");
      } else {
        console.error("Failed to update task group");
        toast.error("Failed to update task group");
      }
    } catch (error) {
      console.error("Error updating task group:", error);
      toast.error("An error occurred while updating the task group");
    }
  };

  const deleteGroup = async (groupId: string) => {
    const confirmed = await confirm({
      title: "Delete Task Group",
      description: "Are you sure you want to delete this group? This action cannot be undone.",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) {
      return;
    }

    setDeletingGroupId(groupId);
    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setGroups((prev) => prev.filter((group) => group.id !== groupId));
        if (selectedGroupId === groupId) {
          onGroupSelect?.(null);
        }
        toast.success("Task group deleted successfully");
      } else {
        console.error("Failed to delete task group");
        toast.error("Failed to delete task group");
      }
    } catch (error) {
      console.error("Error deleting task group:", error);
      toast.error("An error occurred while deleting the task group");
    } finally {
      setDeletingGroupId(null);
    }
  };

  const handleEditGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    setNewGroupName(group.name);
    setNewGroupColor(group.color);
    setNewParentGroupId(group.parent_group_id || null);
    setIsEditDialogOpen(true);
  };

  // Get available parent groups (only groups marked as parent groups, excluding current group when editing)
  const getAvailableParentGroups = (excludeGroupId?: string): TaskGroup[] => {
    // Only return groups that are marked as parent groups
    let parentGroups = groups.filter((g) => g.is_parent_group);

    if (excludeGroupId) {
      // When editing, exclude the current group and all its descendants
      const excludedIds = new Set([excludeGroupId, ...getGroupDescendants(excludeGroupId, groups)]);
      parentGroups = parentGroups.filter((g) => !excludedIds.has(g.id));
    }

    return parentGroups;
  };

  // Get all parent groups
  const parentGroups = groups.filter((g) => g.is_parent_group);

  // Get all regular groups (non-parent groups)
  const regularGroups = groups.filter((g) => !g.is_parent_group);

  // Build hierarchy including parent groups and their children
  // First, create a map of all groups (both parent and regular)
  const allGroupsForHierarchy = [...parentGroups, ...regularGroups];
  const hierarchicalGroups = buildGroupHierarchy(allGroupsForHierarchy);

  // Filter out parent groups that have no children
  const filteredHierarchicalGroups = hierarchicalGroups.filter((group) => {
    // If it's a parent group, only show it if it has children
    if (group.isParent || group.is_parent_group) {
      return group.children.length > 0;
    }
    // Show all regular groups
    return true;
  });

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      const isCurrentlyExpanded = newSet.has(groupId);

      if (isCurrentlyExpanded) {
        // Collapsing: remove this group and all its descendants
        newSet.delete(groupId);
        const descendants = getGroupDescendants(groupId, groups);
        // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach callback doesn't need return value
        descendants.forEach((descendantId) => newSet.delete(descendantId));
      } else {
        // Expanding: add this group
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
      // Exclude completed tasks
      if (task.status === "completed") return false;

      const isUnscheduled = !task.scheduled_start || !task.scheduled_end;
      if (!isUnscheduled) return false;

      // Exclude subtasks themselves (they will be shown nested under their parent)
      if (task.parent_task_id) {
        return false;
      }

      // Include parent tasks with subtasks (they will be shown with nested subtasks)

      if (groupId === null) {
        return !task.group_id;
      }
      return task.group_id === groupId;
    });
  };

  const getAllTasksForGroup = (groupId: string | null) => {
    return tasks.filter((task) => {
      // Exclude completed tasks
      if (task.status === "completed") return false;

      // Exclude subtasks themselves (they will be shown nested under their parent)
      if (task.parent_task_id) {
        return false;
      }

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
        return tasks.filter((t) => !t.group_id && t.status !== "completed").length;
      }
      return tasks.filter((t) => t.group_id === groupId && t.status !== "completed").length;
    }
    return getUnscheduledTasksForGroup(groupId).length;
  };

  // hierarchicalGroups is already built above

  // Recursive function to render a group and its children
  const renderGroup = (group: HierarchicalGroup, level: number = 0) => {
    const isParentGroup = group.isParent;
    const childGroupCount = group.children.length;
    const isExpanded = expandedGroups.has(group.id);

    // For parent groups, render children inside the wireframe
    if (isParentGroup) {
      return (
        <div key={group.id}>
          <GroupCard
            groupName={group.name}
            groupColor={group.color}
            taskCount={getTaskCountForGroup(group.id)}
            childGroupCount={childGroupCount}
            tasks={getTasksForGroup(group.id)}
            isExpanded={isExpanded}
            isHidden={hiddenGroups.has(group.id)}
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
            isParent={isParentGroup}
            indentLevel={level}
            isDeleting={deletingGroupId === group.id}
          >
            {/* Render children inside parent wireframe when expanded */}
            {isExpanded && group.children.length > 0 && (
              <div className="mt-2 space-y-2">
                {group.children.map((child) => renderGroup(child, 0))}
              </div>
            )}
          </GroupCard>
        </div>
      );
    }

    // Regular groups
    return (
      <div key={group.id}>
          <GroupCard
            groupName={group.name}
            groupColor={group.color}
            taskCount={getTaskCountForGroup(group.id)}
            childGroupCount={childGroupCount}
            tasks={getTasksForGroup(group.id)}
            isExpanded={isExpanded}
            isHidden={hiddenGroups.has(group.id)}
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
            isParent={isParentGroup}
            indentLevel={level}
            isDeleting={deletingGroupId === group.id}
            subtasksMap={subtasksMap}
          />
      </div>
    );
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
      <div className="flex-shrink-0 pb-2 px-3 pt-3 flex items-center gap-2">
        <Dialog
          open={isCreateDialogOpen}
          onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              setIsCreatingParentGroup(false);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3"
              onClick={() => setIsCreatingParentGroup(false)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span className="text-xs">New Group</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isCreatingParentGroup ? "Create New Parent Group" : "Create New Group"}
              </DialogTitle>
              <DialogDescription>
                {isCreatingParentGroup
                  ? "Create a new parent group to organize your task groups."
                  : "Create a new task group to organize your tasks."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-1">Group Name</div>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Enter group name"
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="group-color-input-create" className="text-sm font-medium">
                  Color
                </label>
                <div className="mt-1 flex items-center gap-3">
                  <div className="relative">
                    <input
                      id="group-color-input-create"
                      type="color"
                      value={newGroupColor}
                      onChange={(e) => setNewGroupColor(e.target.value)}
                      className="h-10 w-20 cursor-pointer rounded-md border border-input bg-background"
                      title="Pick a color"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-10 w-10 rounded-md border border-input"
                      style={{ backgroundColor: newGroupColor }}
                    />
                    <Input
                      type="text"
                      value={newGroupColor}
                      onChange={(e) => setNewGroupColor(e.target.value)}
                      placeholder="#3B82F6"
                      className="w-24 font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
              {!isCreatingParentGroup && (
                <div>
                  <label htmlFor="parent-group-select-create" className="text-sm font-medium">
                    Parent Group
                  </label>
                  <Select
                    value={newParentGroupId || "__none__"}
                    onValueChange={(value) =>
                      setNewParentGroupId(value === "__none__" ? null : value)
                    }
                  >
                    <SelectTrigger id="parent-group-select-create" className="mt-1 w-full">
                      <SelectValue placeholder="None (top-level group)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (top-level group)</SelectItem>
                      {getAvailableParentGroups().map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={createGroup}
                  loading={isCreating}
                  disabled={!newGroupName.trim() || isCreating}
                >
                  {isCreatingParentGroup ? "Create Parent Group" : "Create Group"}
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
        {/* Task Groups - rendered hierarchically */}
        {filteredHierarchicalGroups.map((group) => renderGroup(group))}

        {groups.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <Folder className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No task groups yet</p>
            <p className="text-[10px]">Create your first group to organize tasks</p>
          </div>
        )}

        {/* Ungrouped at the bottom - only show if there are ungrouped tasks */}
        {getTaskCountForGroup(null) > 0 && (
          <GroupCard
            groupName="Ungrouped"
            groupColor="#6B7280"
            taskCount={getTaskCountForGroup(null)}
            tasks={getTasksForGroup(null)}
            isExpanded={expandedGroups.has("ungrouped")}
            isHidden={hiddenGroups.has("ungrouped")}
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
            isDeleting={false}
            subtasksMap={subtasksMap}
          />
        )}
      </div>

      {/* Edit Group Dialog */}
      <EditGroupDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        group={editingGroup}
        groups={groups}
        onGroupUpdated={fetchGroups}
      />
    </div>
  );
}

// Re-export DraggableTaskItem for backward compatibility (used in calendar page)
export { SlimTaskCard as DraggableTaskItem } from "@/components/slim-task-card";
