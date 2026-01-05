"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDuration, STATUS_LABELS } from "@/lib/task-utils";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SlimTaskCardProps {
  task: Task;
  onTaskClick?: (taskId: string) => void;
  subtasks?: Task[];
  allSubtasks?: Task[]; // All subtasks (unfiltered) for calculating step numbers
  isSubtask?: boolean;
  showAllTasks?: boolean;
  subtaskIndex?: number;
  subtaskTotal?: number;
}

export function SlimTaskCard({
  task,
  onTaskClick,
  subtasks,
  allSubtasks,
  isSubtask = false,
  showAllTasks = false,
  subtaskIndex,
  subtaskTotal,
}: SlimTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.locked,
    data: {
      type: "sidebar-task",
      task,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: "none" as const,
  };

  const handleClick = (_e: React.MouseEvent) => {
    if (!isDragging) {
      onTaskClick?.(task.id);
    }
  };

  const taskIsUnscheduled = !task.scheduled_start || !task.scheduled_end;

  // If task has subtasks, check if all subtasks are scheduled
  // If all subtasks are scheduled, don't show unscheduled badge on parent
  const allSubtasksScheduled =
    subtasks && subtasks.length > 0
      ? subtasks.every((st) => st.scheduled_start && st.scheduled_end)
      : false;

  const isUnscheduled = taskIsUnscheduled && !allSubtasksScheduled;

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
      case "in_progress":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300";
      case "completed":
        return "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300";
      case "cancelled":
        return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
      case "rescheduled":
        return "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const getPriorityBadgeColor = (priority: number) => {
    switch (priority) {
      case 1:
        return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
      case 2:
        return "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300";
      case 3:
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300";
      case 4:
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300";
      case 5:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const taskCardContent = (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "w-full text-left py-1.5 px-2 rounded border bg-card hover:bg-accent/50 transition-colors cursor-grab active:cursor-grabbing text-xs overflow-hidden overflow-x-hidden",
        task.locked && "cursor-not-allowed opacity-75",
        isSubtask && "pl-6 pr-2 border-l-2 border-l-primary/30 bg-muted/30 rounded-r-md py-1"
      )}
      onClick={handleClick}
    >
      {/* Line 1: Title */}
      <div
        className={cn(
          "font-medium truncate leading-tight flex items-center gap-1 overflow-x-hidden",
          isSubtask ? "text-[11px]" : "text-xs"
        )}
      >
        {task.locked && <span className="text-[10px] flex-shrink-0">🔒</span>}
        {isSubtask && subtaskIndex !== undefined && subtaskTotal !== undefined && (
          <span className="text-[10px] text-muted-foreground font-medium flex-shrink-0">
            Step {subtaskIndex + 1} of {subtaskTotal}
          </span>
        )}
        <span className="truncate min-w-0">{task.title}</span>
      </div>

      {/* Line 2: Priority, Status, Duration */}
      <div
        className={cn(
          "flex items-center gap-1 flex-wrap overflow-x-hidden",
          isSubtask ? "mt-0.5" : "mt-1"
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            isSubtask ? "text-[9px] h-3.5 px-1" : "text-[10px] px-1 py-0 h-4",
            "border-0 flex-shrink-0",
            getPriorityBadgeColor(task.priority)
          )}
        >
          P{task.priority}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            isSubtask ? "text-[9px] h-3.5 px-1" : "text-[10px] px-1 py-0 h-4",
            "border-0 flex-shrink-0",
            getStatusBadgeColor(task.status)
          )}
        >
          {STATUS_LABELS[task.status]}
        </Badge>
        {showAllTasks && isUnscheduled && (
          <Badge
            variant="outline"
            className={cn(
              isSubtask ? "text-[9px] h-3.5 px-1" : "text-[10px] px-1 py-0 h-4",
              "border-0 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 flex-shrink-0"
            )}
          >
            <Calendar className={isSubtask ? "h-2 w-2" : "h-2.5 w-2.5"} />
            Unscheduled
          </Badge>
        )}
        {task.duration && (
          <span
            className={cn(
              "text-muted-foreground flex items-center gap-0.5 flex-shrink-0",
              isSubtask ? "text-[9px]" : "text-[10px]"
            )}
          >
            <Clock className={isSubtask ? "h-2 w-2" : "h-2.5 w-2.5"} />
            {formatDuration(task.duration)}
          </span>
        )}
      </div>
    </button>
  );

  // If this is a parent task with subtasks, wrap it in a container with nested subtasks
  if (subtasks && subtasks.length > 0) {
    // Use allSubtasks for step numbering if provided, otherwise fall back to subtasks
    const subtasksForNumbering = allSubtasks || subtasks;

    return (
      <div className="space-y-1 border rounded-md border-border bg-card/50 p-1 overflow-x-hidden">
        {/* Parent task card */}
        <div className="pb-1 border-b border-border/50 overflow-x-hidden">{taskCardContent}</div>
        {/* Nested subtasks */}
        <div className="space-y-1 overflow-x-hidden">
          {subtasks.map((subtask) => {
            // Find the original index in allSubtasks (or subtasks if allSubtasks not provided)
            const originalIndex = subtasksForNumbering.findIndex((st) => st.id === subtask.id);
            return (
              <SlimTaskCard
                key={subtask.id}
                task={subtask}
                onTaskClick={onTaskClick}
                isSubtask={true}
                showAllTasks={showAllTasks}
                subtaskIndex={originalIndex >= 0 ? originalIndex : undefined}
                subtaskTotal={subtasksForNumbering.length}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Regular task card (no subtasks)
  return taskCardContent;
}
