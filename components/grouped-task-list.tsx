"use client";

import {
  ChevronDown,
  ChevronRight,
  Edit,
  Folder,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  sortTasksByCreatedTime,
  sortTasksByPriority,
  sortTasksByScheduledTime,
} from "@/lib/task-utils";
import type { Task, TaskGroup, TaskStatus, TaskWithSubtasks } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TaskCard } from "./task-card";

interface GroupedTaskListProps {
  tasks: (Task | TaskWithSubtasks)[];
  groups: TaskGroup[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onEditTask?: (taskId: string) => void;
  onExtendTask?: (taskId: string) => void;
  onUnscheduleTask?: (taskId: string) => Promise<void>;
  onCreateTask?: () => void;
  onImport?: () => void;
  showAllTasks?: boolean;
  onShowAllTasksChange?: (show: boolean) => void;
  onRenameGroup?: (group: TaskGroup) => void;
  onDeleteGroup?: (groupId: string) => Promise<void>;
  onCreateParentGroup?: () => void;
}

type GroupByOption = "status" | "group" | "none";
type FilterOption = "all" | "pending" | "in_progress" | "completed" | "cancelled";

export function GroupedTaskList({
  tasks,
  groups,
  onUpdateTask,
  onDeleteTask,
  onEditTask,
  onExtendTask: _onExtendTask,
  onUnscheduleTask,
  onCreateTask,
  onImport,
  showAllTasks = false,
  onShowAllTasksChange,
  onRenameGroup,
  onDeleteGroup,
  onCreateParentGroup,
}: GroupedTaskListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupByOption>("status");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"priority" | "scheduled" | "created">("priority");
  const [showCompleted, setShowCompleted] = useState(false);

  // Build hierarchy of groups (parent groups with their children)
  const buildGroupHierarchy = useCallback((): Array<{
    id: string;
    name: string;
    color: string;
    isParent: boolean;
    children: Array<{ id: string; name: string; color: string }>;
  }> => {
    const parentGroups = groups.filter((g) => g.is_parent_group);
    const regularGroups = groups.filter((g) => !g.is_parent_group);
    const topLevelGroups = regularGroups.filter((g) => !g.parent_group_id);

    // Build hierarchy
    const hierarchy: Array<{
      id: string;
      name: string;
      color: string;
      isParent: boolean;
      children: Array<{ id: string; name: string; color: string }>;
    }> = [];

    // Add top-level regular groups first (not under any parent)
    topLevelGroups.forEach((group) => {
      hierarchy.push({
        id: group.id,
        name: group.name,
        color: group.color,
        isParent: false,
        children: [],
      });
    });

    // Add parent groups
    parentGroups.forEach((parentGroup) => {
      const children = regularGroups.filter((g) => g.parent_group_id === parentGroup.id);
      hierarchy.push({
        id: parentGroup.id,
        name: parentGroup.name,
        color: parentGroup.color,
        isParent: true,
        children: children.map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
        })),
      });
    });

    return hierarchy;
  }, [groups]);

  // Initialize with all sections expanded
  useEffect(() => {
    if (groupBy === "status") {
      setExpandedSections(new Set(["pending", "in_progress", "completed", "cancelled"]));
    } else if (groupBy === "group") {
      const hierarchy = buildGroupHierarchy();
      const allIds: string[] = [];
      // Only add "ungrouped" if there are actually ungrouped tasks
      const ungroupedCount = tasks.filter((task) => !task.group_id).length;
      if (ungroupedCount > 0) {
        allIds.push("ungrouped");
      }
      hierarchy.forEach((item) => {
        allIds.push(item.id);
        if (item.isParent) {
          // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach callback doesn't need return value
          item.children.forEach((child) => allIds.push(child.id));
        }
      });
      setExpandedSections(new Set(allIds));
    }
  }, [groupBy, tasks, buildGroupHierarchy]);

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    // Exclude subtasks from the main list (they'll be shown under their parent)
    if (task.parent_task_id) {
      return false;
    }

    // Search filter
    if (
      searchQuery &&
      !task.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !task.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    // Hide completed tasks by default (unless showCompleted is true)
    if (!showCompleted && task.status === "completed") {
      return false;
    }

    // Status filter
    if (filter !== "all" && task.status !== filter) {
      return false;
    }

    // Show all tasks or only unscheduled
    if (!showAllTasks) {
      const isUnscheduled = !task.scheduled_start || !task.scheduled_end;
      if (!isUnscheduled) return false;

      // Exclude parent tasks that have subtasks (only show subtasks in unscheduled view)
      if (!task.parent_task_id && (task.subtask_count || 0) > 0) {
        return false;
      }
    }

    return true;
  });

  // Sort tasks
  const sortedTasks = (() => {
    switch (sortBy) {
      case "priority":
        return sortTasksByPriority(filteredTasks);
      case "scheduled":
        return sortTasksByScheduledTime(filteredTasks);
      case "created":
        return sortTasksByCreatedTime(filteredTasks);
      default:
        return filteredTasks;
    }
  })();

  // Group tasks
  const groupedTasks: Record<string, Task[]> = (() => {
    if (groupBy === "status") {
      const grouped: Record<string, Task[]> = {
        pending: [],
        in_progress: [],
        completed: [],
        cancelled: [],
      };
      sortedTasks.forEach((task) => {
        if (grouped[task.status]) {
          grouped[task.status].push(task);
        }
      });
      return grouped;
    } else if (groupBy === "group") {
      const grouped: Record<string, Task[]> = {
        ungrouped: [],
      };
      groups.forEach((group) => {
        grouped[group.id] = [];
      });
      sortedTasks.forEach((task) => {
        if (task.group_id) {
          if (grouped[task.group_id]) {
            grouped[task.group_id].push(task);
          }
        } else {
          grouped.ungrouped.push(task);
        }
      });
      return grouped;
    } else {
      return { all: sortedTasks };
    }
  })();

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    if (groupBy === "status") {
      setExpandedSections(new Set(["pending", "in_progress", "completed", "cancelled"]));
    } else if (groupBy === "group") {
      const hierarchy = buildGroupHierarchy();
      const allIds: string[] = [];
      // Only add "ungrouped" if there are actually ungrouped tasks
      if ((groupedTasks.ungrouped || []).length > 0) {
        allIds.push("ungrouped");
      }
      hierarchy.forEach((item) => {
        allIds.push(item.id);
        if (item.isParent) {
          // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach callback doesn't need return value
          item.children.forEach((child) => allIds.push(child.id));
        }
      });
      setExpandedSections(new Set(allIds));
    }
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  const getStatusLabel = (status: TaskStatus) => {
    switch (status) {
      case "pending":
        return "Pending";
      case "in_progress":
        return "In Progress";
      case "completed":
        return "Completed";
      case "cancelled":
        return "Cancelled";
      case "rescheduled":
        return "Rescheduled";
    }
  };

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case "pending":
        return "bg-blue-500";
      case "in_progress":
        return "bg-yellow-500";
      case "completed":
        return "bg-green-500";
      case "cancelled":
        return "bg-red-500";
      case "rescheduled":
        return "bg-teal-500";
      default:
        return "bg-gray-500";
    }
  };

  // Helper to extract subtasks from a task
  const getSubtasks = (task: Task | TaskWithSubtasks): Task[] => {
    if ("subtasks" in task && task.subtasks) {
      return task.subtasks;
    }
    return [];
  };

  const taskCounts = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
  };

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold">Tasks</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            {filteredTasks.length} of {tasks.length} tasks
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCreateParentGroup && (
            <Button
              onClick={onCreateParentGroup}
              variant="outline"
              className="h-11 px-4 md:h-10 md:px-4"
            >
              <Folder className="w-4 h-4 mr-2" />
              Manage Parent Groups
            </Button>
          )}
          {onImport && (
            <Button onClick={onImport} variant="outline" className="h-11 px-4 md:h-10 md:px-4">
              <Upload className="w-4 h-4 mr-2" />
              Import Tasks
            </Button>
          )}
          {onCreateTask && (
            <Button onClick={onCreateTask} className="h-11 px-4 md:h-10 md:px-4">
              <Plus className="w-4 h-4 mr-2" />
              Add Task
            </Button>
          )}
        </div>
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
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("all")}
                className="h-11 px-4 md:h-9 md:px-3 text-sm"
              >
                All ({taskCounts.all})
              </Button>
              <Button
                variant={filter === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("pending")}
                className="h-11 px-4 md:h-9 md:px-3 text-sm"
              >
                Pending ({taskCounts.pending})
              </Button>
              <Button
                variant={filter === "in_progress" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("in_progress")}
                className="h-11 px-4 md:h-9 md:px-3 text-sm"
              >
                In Progress ({taskCounts.in_progress})
              </Button>
              <Button
                variant={filter === "completed" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("completed")}
                className="h-11 px-4 md:h-9 md:px-3 text-sm"
              >
                Completed ({taskCounts.completed})
              </Button>
              <Button
                variant={filter === "cancelled" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("cancelled")}
                className="h-11 px-4 md:h-9 md:px-3 text-sm"
              >
                Cancelled ({taskCounts.cancelled})
              </Button>
            </div>

            {/* Group by and other controls */}
            <div className="flex flex-col md:flex-row md:items-center gap-4 pt-2 border-t">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">Group by:</span>
                  <div className="flex gap-2">
                    <Button
                      variant={groupBy === "status" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupBy("status")}
                      className="h-11 px-4 md:h-9 md:px-3"
                    >
                      Status
                    </Button>
                    <Button
                      variant={groupBy === "group" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupBy("group")}
                      className="h-11 px-4 md:h-9 md:px-3"
                    >
                      Group
                    </Button>
                    <Button
                      variant={groupBy === "none" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupBy("none")}
                      className="h-11 px-4 md:h-9 md:px-3"
                    >
                      None
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as "priority" | "scheduled" | "created")
                    }
                    className="px-3 py-2.5 md:py-1.5 text-sm border rounded-md bg-background h-11 md:h-9"
                  >
                    <option value="priority">Priority</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="created">Created</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:gap-4 md:ml-auto">
                <Button
                  variant={showCompleted ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="h-11 px-4 md:h-9 md:px-3 text-sm"
                >
                  {showCompleted ? "Hide Completed" : "Show Completed"}
                </Button>
                {onShowAllTasksChange && (
                  <Button
                    variant={showAllTasks ? "default" : "outline"}
                    size="sm"
                    onClick={() => onShowAllTasksChange(!showAllTasks)}
                    className="h-11 px-4 md:h-9 md:px-3 text-sm"
                  >
                    {showAllTasks ? "Show Unscheduled Only" : "Show All"}
                  </Button>
                )}

                {groupBy !== "none" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={expandAll}
                      className="h-11 px-4 md:h-9 md:px-3"
                    >
                      Expand All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={collapseAll}
                      className="h-11 px-4 md:h-9 md:px-3"
                    >
                      Collapse All
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grouped Task Lists */}
      {groupBy === "status" && (
        <div className="space-y-3">
          {(["pending", "in_progress", "completed", "cancelled"] as TaskStatus[]).map((status) => {
            const sectionTasks = groupedTasks[status] || [];
            if (sectionTasks.length === 0 && filter !== "all" && filter !== status) return null;

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
                  <CardContent className="pt-0 overflow-x-hidden">
                    <div className="space-y-3 overflow-x-hidden">
                      {sectionTasks.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No {getStatusLabel(status)?.toLowerCase() || status} tasks
                        </p>
                      ) : (
                        sectionTasks.map((task) => {
                          const subtasks = getSubtasks(task);
                          return (
                            <TaskCard
                              key={task.id}
                              task={task}
                              onUpdate={onUpdateTask}
                              onDelete={onDeleteTask}
                              onEdit={onEditTask}
                              onUnschedule={onUnscheduleTask}
                              groups={groups}
                              subtasks={subtasks.length > 0 ? subtasks : undefined}
                              showAllTasks={showAllTasks}
                            />
                          );
                        })
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {groupBy === "group" && (
        <div className="space-y-3">
          {/* Ungrouped tasks - only show if there are ungrouped tasks */}
          {(groupedTasks.ungrouped || []).length > 0 && (
            <Card>
              <CardHeader
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => toggleSection("ungrouped")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {expandedSections.has("ungrouped") ? (
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
              {expandedSections.has("ungrouped") && (
                <CardContent className="pt-0 overflow-x-hidden">
                  <div className="space-y-3 overflow-x-hidden">
                    {(groupedTasks.ungrouped || []).map((task) => {
                      const subtasks = getSubtasks(task);
                      return (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onUpdate={onUpdateTask}
                          onDelete={onDeleteTask}
                          onEdit={onEditTask}
                          onUnschedule={onUnscheduleTask}
                          groups={groups}
                          subtasks={subtasks.length > 0 ? subtasks : undefined}
                          showAllTasks={showAllTasks}
                        />
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Group tasks - organized by parent groups */}
          {buildGroupHierarchy().map((hierarchyItem) => {
            if (hierarchyItem.isParent) {
              // Parent group section
              const parentGroup = groups.find((g) => g.id === hierarchyItem.id);
              if (!parentGroup) return null;

              // Calculate total tasks in all child groups
              const totalTasks = hierarchyItem.children.reduce(
                (sum, child) => sum + (groupedTasks[child.id]?.length || 0),
                0
              );

              if (hierarchyItem.children.length === 0 && totalTasks === 0) return null;

              return (
                <Card
                  key={hierarchyItem.id}
                  className="border-2 border-dashed"
                  style={{ borderColor: hierarchyItem.color }}
                >
                  <CardHeader
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => toggleSection(hierarchyItem.id)}
                    style={{ backgroundColor: `${hierarchyItem.color}10` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {expandedSections.has(hierarchyItem.id) ? (
                          <ChevronDown className="h-4 w-4" style={{ color: hierarchyItem.color }} />
                        ) : (
                          <ChevronRight
                            className="h-4 w-4"
                            style={{ color: hierarchyItem.color }}
                          />
                        )}
                        <Folder className="h-4 w-4" style={{ color: hierarchyItem.color }} />
                        <CardTitle className="text-lg" style={{ color: hierarchyItem.color }}>
                          {hierarchyItem.name}
                        </CardTitle>
                        <Badge
                          variant="secondary"
                          style={{
                            backgroundColor: `${hierarchyItem.color}20`,
                            color: hierarchyItem.color,
                          }}
                        >
                          {hierarchyItem.children.length}{" "}
                          {hierarchyItem.children.length === 1 ? "group" : "groups"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  {expandedSections.has(hierarchyItem.id) && (
                    <CardContent className="pt-0 pl-4 pr-4 pb-4">
                      <div className="space-y-3">
                        {hierarchyItem.children.map((childGroup) => {
                          const sectionTasks = groupedTasks[childGroup.id] || [];
                          const childGroupFull = groups.find((g) => g.id === childGroup.id);
                          if (!childGroupFull) return null;

                          return (
                            <Card key={childGroup.id} className="ml-4">
                              <CardHeader
                                className="cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={() => toggleSection(childGroup.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    {expandedSections.has(childGroup.id) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                    <div
                                      className="w-3 h-3 rounded-full border"
                                      style={{ backgroundColor: childGroup.color }}
                                    />
                                    <CardTitle className="text-base">{childGroup.name}</CardTitle>
                                    <Badge variant="secondary">{sectionTasks.length}</Badge>
                                  </div>
                                  {/* biome-ignore lint/a11y/useSemanticElements: Container div for button group requires div layout */}
                                  <div
                                    className="flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                  >
                                    {onRenameGroup && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRenameGroup(childGroupFull);
                                        }}
                                        title="Rename group"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {onDeleteGroup && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDeleteGroup(childGroup.id);
                                        }}
                                        title="Delete group"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardHeader>
                              {expandedSections.has(childGroup.id) && (
                                <CardContent className="pt-0 overflow-x-hidden">
                                  <div className="space-y-3 overflow-x-hidden">
                                    {sectionTasks.map((task) => {
                                      const subtasks = getSubtasks(task);
                                      return (
                                        <TaskCard
                                          key={task.id}
                                          task={task}
                                          onUpdate={onUpdateTask}
                                          onDelete={onDeleteTask}
                                          onEdit={onEditTask}
                                          onUnschedule={onUnscheduleTask}
                                          groups={groups}
                                          subtasks={subtasks.length > 0 ? subtasks : undefined}
                                          showAllTasks={showAllTasks}
                                        />
                                      );
                                    })}
                                    {sectionTasks.length === 0 && (
                                      <p className="text-sm text-muted-foreground py-2 text-center">
                                        No tasks in this group
                                      </p>
                                    )}
                                  </div>
                                </CardContent>
                              )}
                            </Card>
                          );
                        })}
                        {hierarchyItem.children.length === 0 && (
                          <p className="text-sm text-muted-foreground py-2 text-center">
                            No groups in this parent group
                          </p>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            } else {
              // Regular top-level group (not under a parent)
              const sectionTasks = groupedTasks[hierarchyItem.id] || [];
              if (sectionTasks.length === 0) return null;

              const group = groups.find((g) => g.id === hierarchyItem.id);
              if (!group) return null;

              return (
                <Card key={hierarchyItem.id}>
                  <CardHeader
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => toggleSection(hierarchyItem.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {expandedSections.has(hierarchyItem.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <div
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: hierarchyItem.color }}
                        />
                        <CardTitle className="text-lg">{hierarchyItem.name}</CardTitle>
                        <Badge variant="secondary">{sectionTasks.length}</Badge>
                      </div>
                      {/* biome-ignore lint/a11y/useSemanticElements: Container div for button group requires div layout */}
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {onRenameGroup && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRenameGroup(group);
                            }}
                            title="Rename group"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {onDeleteGroup && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteGroup(hierarchyItem.id);
                            }}
                            title="Delete group"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {expandedSections.has(hierarchyItem.id) && (
                    <CardContent className="pt-0 overflow-x-hidden">
                      <div className="space-y-3 overflow-x-hidden">
                        {sectionTasks.map((task) => {
                          const subtasks = getSubtasks(task);
                          return (
                            <TaskCard
                              key={task.id}
                              task={task}
                              onUpdate={onUpdateTask}
                              onDelete={onDeleteTask}
                              onEdit={onEditTask}
                              onUnschedule={onUnscheduleTask}
                              groups={groups}
                              subtasks={subtasks.length > 0 ? subtasks : undefined}
                              showAllTasks={showAllTasks}
                            />
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            }
          })}
        </div>
      )}

      {groupBy === "none" && (
        <div className="space-y-3">
          {sortedTasks.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No tasks found</p>
              </CardContent>
            </Card>
          ) : (
            sortedTasks.map((task) => {
              const subtasks = getSubtasks(task);
              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  onUpdate={onUpdateTask}
                  onDelete={onDeleteTask}
                  onEdit={onEditTask}
                  onUnschedule={onUnscheduleTask}
                  groups={groups}
                  subtasks={subtasks.length > 0 ? subtasks : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
