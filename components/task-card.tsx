"use client";

import { Clock, Flag, Lock, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import {
  formatDuration,
  getEnergyLevelColor,
  getTaskPriorityColor,
  getTaskStatusColor,
  isTaskDueSoon,
  isTaskOverdue,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/lib/task-utils";
import { formatDateShort, formatTimeShort } from "@/lib/timezone-utils";
import type { Task, TaskGroup, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onEdit?: (taskId: string) => void;
  onUnschedule?: (taskId: string) => Promise<void>;
  compact?: boolean;
  groups?: TaskGroup[];
}

export function TaskCard({
  task,
  onUpdate,
  onDelete,
  onEdit,
  onUnschedule,
  compact = false,
  groups = [],
}: TaskCardProps) {
  const { confirm } = useConfirmDialog();
  const [isUpdating, setIsUpdating] = useState(false);
  const [_isUnscheduling, setIsUnscheduling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { timezone } = useUserTimezone();

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setIsUpdating(true);
    try {
      await onUpdate(task.id, { status: newStatus });
    } catch (error) {
      console.error("Error updating task status:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleComplete = async (completed: boolean) => {
    await handleStatusChange(completed ? "completed" : "pending");
  };

  const _handleUnschedule = async () => {
    if (!onUnschedule) return;
    setIsUnscheduling(true);
    try {
      await onUnschedule(task.id);
    } catch (error) {
      console.error("Error unscheduling task:", error);
    } finally {
      setIsUnscheduling(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Task",
      description: "Are you sure you want to delete this task?",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete(task.id);
    } catch (error) {
      console.error("Error deleting task:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const isOverdue = isTaskOverdue(task);
  const isDueSoon = isTaskDueSoon(task);
  const priorityColor = getTaskPriorityColor(task.priority);
  const statusColor = getTaskStatusColor(task.status);
  const energyColor = getEnergyLevelColor(task.energy_level_required);

  // Get group color for the task
  const group = task.group_id ? groups.find((g) => g.id === task.group_id) : null;
  const groupColor = group?.color || null;

  // Get priority color for top bar
  const getPriorityBarColor = (priority: number) => {
    switch (priority) {
      case 1:
        return "bg-red-500";
      case 2:
        return "bg-orange-500";
      case 3:
        return "bg-yellow-500";
      case 4:
        return "bg-green-500";
      case 5:
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };

  if (compact) {
    return (
      <Card
        className={cn(
          "transition-all hover:shadow-md relative",
          isOverdue && "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20",
          groupColor && "border-l-4"
        )}
        style={groupColor ? { borderLeftColor: groupColor } : undefined}
      >
        {/* Priority top bar */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 h-1 rounded-t-lg",
            getPriorityBarColor(task.priority)
          )}
        />
        <CardContent className="p-3 pt-4">
          <div className="flex items-center space-x-3">
            <Checkbox
              checked={task.status === "completed"}
              onCheckedChange={handleToggleComplete}
              disabled={isUpdating}
              className="h-5 w-5 md:h-4 md:w-4"
            />
            <div className="flex-1 min-w-0">
              <h4
                className={`text-sm font-medium truncate ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}
              >
                {task.title}
              </h4>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Badge variant="outline" className={`text-xs ${priorityColor}`}>
                  {task.priority}. {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                </Badge>
                {task.duration && (
                  <span className="text-xs text-muted-foreground flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDuration(task.duration)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-1 flex-shrink-0">
              {task.locked && <Lock className="w-3 h-3 text-muted-foreground" />}
              <Badge variant="outline" className={`text-xs ${statusColor}`}>
                {STATUS_LABELS[task.status]}
              </Badge>
            </div>
          </div>
          {/* Group badge in bottom right corner */}
          {group && (
            <Badge
              variant="outline"
              className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5"
              style={groupColor ? { borderColor: groupColor, color: groupColor } : undefined}
            >
              {group.name}
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  // Determine border color
  const borderStyle =
    groupColor && !isOverdue && !isDueSoon ? { borderLeftColor: groupColor } : undefined;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger edit if clicking on checkbox, buttons, or badges
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest('[role="checkbox"]') ||
      target.closest('input[type="checkbox"]')
    ) {
      return;
    }
    onEdit?.(task.id);
  };

  return (
    <Card
      className={cn(
        "transition-all hover:shadow-sm relative border-l-2 cursor-pointer",
        isOverdue && "border-red-500 bg-red-50/50 dark:bg-red-950/10",
        isDueSoon && !isOverdue && "border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/10",
        !groupColor && !isOverdue && !isDueSoon && "border-l-gray-300 dark:border-l-gray-700",
        onEdit && "hover:bg-accent/50"
      )}
      style={borderStyle}
      onClick={handleCardClick}
    >
      <CardContent className="px-3 pt-0.5 pb-1.5">
        <div className="flex items-center gap-3">
          {/* Checkbox */}
          <Checkbox
            checked={task.status === "completed"}
            onCheckedChange={handleToggleComplete}
            disabled={isUpdating}
            className="h-4 w-4 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Main content - horizontal layout */}
          <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
            {/* Title */}
            <div className="flex-1 min-w-0">
              <h4
                className={cn(
                  "text-sm font-medium truncate",
                  task.status === "completed" && "line-through text-muted-foreground"
                )}
              >
                {task.title}
              </h4>
              {/* Description on second line if exists */}
              {task.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
              )}
            </div>

            {/* Key info badges - inline */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Priority badge */}
              <Badge variant="outline" className={`text-xs h-5 px-1.5 ${priorityColor}`}>
                P{task.priority}
              </Badge>

              {/* Status badge */}
              <Badge variant="outline" className={`text-xs h-5 px-1.5 ${statusColor}`}>
                {STATUS_LABELS[task.status]}
              </Badge>

              {/* Duration */}
              {task.duration && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(task.duration)}
                </span>
              )}

              {/* Start time */}
              {task.scheduled_start && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateShort(task.scheduled_start, timezone)}{" "}
                  {formatTimeShort(task.scheduled_start, timezone)}
                </span>
              )}

              {/* Due date */}
              {task.due_date && (
                <Badge
                  variant="outline"
                  className="text-xs h-5 px-1.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800"
                >
                  <Flag className="w-3 h-3" />
                  {formatDateShort(task.due_date, timezone)}
                </Badge>
              )}

              {/* Energy level */}
              <span className={`text-xs flex items-center gap-1 ${energyColor}`}>
                <Zap className="w-3 h-3" />
                {task.energy_level_required}
              </span>

              {/* Lock indicator */}
              {task.locked && <Lock className="w-3 h-3 text-muted-foreground" />}

              {/* Overdue indicator */}
              {isOverdue && (
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                  ⚠ Overdue
                </span>
              )}
            </div>
          </div>

          {/* Actions - compact */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Container div for button group */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Container div doesn't need keyboard interaction */}
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {task.status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStatusChange("in_progress")}
                disabled={isUpdating || isDeleting}
                className="h-8 px-2 text-xs"
                title="Start"
              >
                Start
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStatusChange("completed")}
                disabled={isUpdating || isDeleting}
                className="h-8 px-2 text-xs"
                title="Complete"
              >
                Done
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={isUpdating || isDeleting}
              className="h-8 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/20"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Group badge in bottom right corner */}
        {group && (
          <Badge
            variant="outline"
            className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 h-4"
            style={groupColor ? { borderColor: groupColor, color: groupColor } : undefined}
          >
            {group.name}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
