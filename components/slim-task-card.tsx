"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDuration, STATUS_LABELS } from "@/lib/task-utils";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SlimTaskCardProps {
  task: Task;
  onTaskClick?: (taskId: string) => void;
}

export function SlimTaskCard({ task, onTaskClick }: SlimTaskCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "py-1.5 px-2 rounded border bg-card hover:bg-accent/50 transition-colors cursor-grab active:cursor-grabbing text-xs overflow-hidden",
        task.locked && "cursor-not-allowed opacity-75"
      )}
      onClick={handleClick}
    >
      {/* Line 1: Title */}
      <div className="font-medium truncate text-xs leading-tight flex items-center gap-1">
        {task.locked && <span className="text-[10px]">🔒</span>}
        {task.title}
      </div>

      {/* Line 2: Priority, Status, Duration */}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        <Badge
          variant="outline"
          className={cn("text-[10px] px-1 py-0 h-4 border-0", getPriorityBadgeColor(task.priority))}
        >
          P{task.priority}
        </Badge>
        <Badge
          variant="outline"
          className={cn("text-[10px] px-1 py-0 h-4 border-0", getStatusBadgeColor(task.status))}
        >
          {STATUS_LABELS[task.status]}
        </Badge>
        {task.duration && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(task.duration)}
          </span>
        )}
      </div>
    </div>
  );
}
