"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { formatTimeShort } from "@/lib/timezone-utils";
import { isTaskOverdue, isTaskTimeExpired } from "@/lib/task-utils";
import type { Task, TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

// Helper function to get priority bar color
export const getPriorityBarColor = (priority: number) => {
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

interface ResizableTaskProps {
  task: Task;
  position: { top: string; height: string };
  onTaskClick?: (taskId: string) => void;
  onResize?: (taskId: string, newEndTime: Date) => void;
  activeDragId?: string | null;
  resizingTaskId?: string | null;
  selectedGroupId?: string | null;
  groups?: TaskGroup[];
}

export function ResizableTask({
  task,
  position,
  onTaskClick,
  onResize,
  activeDragId,
  resizingTaskId,
  selectedGroupId,
  groups = [],
}: ResizableTaskProps) {
  const { timezone } = useUserTimezone();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: task.locked,
    data: {
      type: "task",
      task,
    },
  });

  const bottomResizeHandleId = `resize-bottom-${task.id}`;
  const topResizeHandleId = `resize-top-${task.id}`;

  const {
    attributes: bottomResizeAttributes,
    listeners: bottomResizeListeners,
    setNodeRef: setBottomResizeRef,
    isDragging: isBottomResizing,
  } = useDraggable({
    id: bottomResizeHandleId,
    disabled: task.locked,
    data: {
      type: "resize-handle",
      task,
      resizeDirection: "bottom",
    },
  });

  const {
    attributes: topResizeAttributes,
    listeners: topResizeListeners,
    setNodeRef: setTopResizeRef,
    isDragging: isTopResizing,
  } = useDraggable({
    id: topResizeHandleId,
    disabled: task.locked,
    data: {
      type: "resize-handle",
      task,
      resizeDirection: "top",
    },
  });

  const isResizing = isTopResizing || isBottomResizing;
  const isActiveDrag =
    activeDragId === task.id ||
    activeDragId === bottomResizeHandleId ||
    activeDragId === topResizeHandleId;
  const isTaskResizing = resizingTaskId === task.id || isResizing;

  // Determine if task belongs to selected group
  // Handle 'ungrouped' string for ungrouped tasks
  const taskGroupId = task.group_id || null;
  const belongsToSelectedGroup =
    selectedGroupId === null
      ? false
      : selectedGroupId === "ungrouped"
        ? taskGroupId === null
        : taskGroupId === selectedGroupId;
  const shouldFade = selectedGroupId !== null && !belongsToSelectedGroup;

  // Get group color for the task
  const group = task.group_id ? groups.find((g) => g.id === task.group_id) : null;
  const groupColor = group?.color || null;

  // Check task states
  const isCompleted = task.status === "completed";
  const isOverdue = !isCompleted && isTaskOverdue(task);
  const isPastEvent = task.task_type === "event" && isTaskTimeExpired(task);

  // Convert hex color to rgba for background
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const style = {
    top: position.top,
    height: position.height,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging || isTaskResizing ? 0.7 : shouldFade ? 0.3 : isCompleted || isPastEvent ? 0.5 : 1,
    transition: isDragging || isTaskResizing ? "none" : "all 0.2s ease-in-out",
    zIndex: isActiveDrag ? 50 : 10,
    ...(groupColor && {
      backgroundColor: hexToRgba(groupColor, 0.4),
      borderColor: groupColor,
    }),
  };

  // Handle click on the task content (not the drag area)
  const handleTaskClick = (e: React.MouseEvent) => {
    // Stop propagation to prevent triggering on parent elements
    e.stopPropagation();
    // Only trigger if we're not currently dragging
    if (!isDragging && !isResizing) {
      onTaskClick?.(task.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(task.locked ? {} : listeners)}
      {...attributes}
      className={cn(
        "absolute left-1 right-1 rounded-md border-l-4 p-1.5 md:p-2 cursor-pointer pointer-events-auto",
        "min-h-[44px] md:min-h-0", // Minimum touch target height on mobile
        "hover:shadow-lg transition-shadow overflow-hidden group relative",
        task.locked && "cursor-not-allowed opacity-75",
        !task.locked && "cursor-grab active:cursor-grabbing",
        isActiveDrag && "shadow-xl ring-2 ring-primary/50",
        isTaskResizing && "ring-2 ring-primary/50",
        belongsToSelectedGroup && selectedGroupId !== null && "ring-2 ring-primary ring-offset-1",
        !groupColor && "bg-gray-500/40 border-gray-500",
        isOverdue && "ring-2 ring-red-500 ring-offset-0",
        (isCompleted || isPastEvent) && "opacity-50"
      )}
      onClick={handleTaskClick}
    >
      {/* Priority top bar */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-1 rounded-t-md",
          getPriorityBarColor(task.priority)
        )}
      />
      <div className={cn(
        "text-xs font-medium text-white truncate pointer-events-none mt-1",
        (isCompleted || isPastEvent) && "line-through"
      )}>
        {task.title}
      </div>
      <div className="text-xs text-white/90 mt-1">
        {formatTimeShort(task.scheduled_start!, timezone)}
      </div>
      {task.locked && (
        <div className="text-xs text-white/90 mt-1 flex items-center gap-1">🔒 Locked</div>
      )}
      {/* Group badge in bottom right corner - hide for tasks < 45m to avoid blocking title, and hide on mobile/width < 1000px */}
      {group && task.duration && task.duration >= 45 && (
        <div
          className="hidden lg:block absolute bottom-1 right-1 px-1 py-0.5 rounded text-[10px] font-medium text-white pointer-events-none"
          style={{
            backgroundColor: groupColor ? hexToRgba(groupColor, 0.8) : "rgba(107, 114, 128, 0.8)",
          }}
        >
          {group.name}
        </div>
      )}
      {!task.locked && (
        <>
          {/* Top resize handle */}
          <div
            ref={setTopResizeRef}
            {...topResizeListeners}
            {...topResizeAttributes}
            className={cn(
              "absolute top-0 left-0 right-0 h-3 md:h-2 cursor-ns-resize bg-white/20 hover:bg-white/30 transition-opacity flex items-center justify-center touch-none",
              isTopResizing
                ? "opacity-100 bg-white/40"
                : "opacity-50 md:opacity-0 md:group-hover:opacity-100"
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3 text-white" />
          </div>
          {/* Bottom resize handle */}
          <div
            ref={setBottomResizeRef}
            {...bottomResizeListeners}
            {...bottomResizeAttributes}
            className={cn(
              "absolute bottom-0 left-0 right-0 h-3 md:h-2 cursor-ns-resize bg-white/20 hover:bg-white/30 transition-opacity flex items-center justify-center touch-none",
              isBottomResizing
                ? "opacity-100 bg-white/40"
                : "opacity-50 md:opacity-0 md:group-hover:opacity-100"
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3 text-white" />
          </div>
        </>
      )}
    </div>
  );
}
