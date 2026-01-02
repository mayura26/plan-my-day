"use client";

import { parseISO } from "date-fns";
import {
  Calendar,
  CalendarX,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Edit,
  Flag,
  GitBranch,
  Link2,
  Lock,
  Tag,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SubtaskManager } from "@/components/subtask-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { ENERGY_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/task-utils";
import { formatDateTimeFull } from "@/lib/timezone-utils";
import type { Task, TaskDependency, TaskStatus } from "@/lib/types";

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onStatusChange?: (taskId: string, status: Task["status"]) => void;
  onUnschedule?: (taskId: string) => void;
  onTaskUpdate?: () => void | Promise<void>;
  onTaskRefresh?: (task: Task) => void; // Callback to refresh the task prop from parent
}

interface DependencyInfo extends TaskDependency {
  dependency_title: string;
  dependency_status: TaskStatus;
}

export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onStatusChange,
  onUnschedule,
  onTaskUpdate,
  onTaskRefresh,
}: TaskDetailDialogProps) {
  const { confirm } = useConfirmDialog();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnscheduling, setIsUnscheduling] = useState(false);
  const [isUnignoring, setIsUnignoring] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [dependencies, setDependencies] = useState<DependencyInfo[]>([]);
  const [blockedBy, setBlockedBy] = useState<Task[]>([]);
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [subtasksCount, setSubtasksCount] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const { timezone } = useUserTimezone();

  const fetchDependencies = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/dependencies`);
      if (response.ok) {
        const data = await response.json();
        setDependencies(data.dependencies || []);
        setBlockedBy(data.blocked_by || []);
        setIsBlocked(data.is_blocked || false);
      }
    } catch (error) {
      console.error("Error fetching dependencies:", error);
    }
  }, []);

  const fetchSubtasksCount = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/subtasks`);
      if (response.ok) {
        const data = await response.json();
        const subtasks = data.subtasks || [];
        const completed = subtasks.filter((st: Task) => st.status === "completed").length;
        setSubtasksCount({ completed, total: subtasks.length });
        // Auto-expand if subtasks exist, collapse if empty
        setSubtasksExpanded(subtasks.length > 0);
      }
    } catch (error) {
      console.error("Error fetching subtasks count:", error);
    }
  }, []);

  // Track when dialog opens to fetch dependencies only once
  const openedTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && task?.id) {
      // Only fetch dependencies if this is a new dialog open (different task or first open)
      if (openedTaskIdRef.current !== task.id) {
        openedTaskIdRef.current = task.id;
        fetchDependencies(task.id);
        // Fetch subtasks count for non-subtask tasks
        if (!(task.task_type === "subtask" || !!task.parent_task_id)) {
          fetchSubtasksCount(task.id);
        }
        // Reset change tracking when dialog opens
        setHasChanges(false);
      }
    }
    // Reset ref when dialog closes
    if (!open) {
      openedTaskIdRef.current = null;
    }
  }, [open, task?.id, fetchDependencies, fetchSubtasksCount, task?.task_type, task?.parent_task_id]);

  if (!task) return null;

  // Handle dialog close - only refresh task list if changes were made
  const handleDialogClose = (newOpen: boolean) => {
    if (!newOpen) {
      // Only refresh if changes were made
      if (hasChanges) {
        onTaskUpdate?.();
      }
    }
    onOpenChange(newOpen);
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
      await onDelete?.(task.id);
      handleDialogClose(false);
      toast.success("Task deleted successfully");
    } catch (error) {
      console.error("Error deleting task:", error);
      toast.error("Failed to delete task");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = () => {
    onEdit?.(task.id);
    // Close dialog without refreshing - refresh will happen when edit dialog closes
    onOpenChange(false);
  };

  const handleUnschedule = async () => {
    const confirmed = await confirm({
      title: "Unschedule Task",
      description:
        "Are you sure you want to unschedule this task? It will be removed from the calendar.",
      variant: "default",
      confirmText: "Unschedule",
    });

    if (!confirmed) return;

    setIsUnscheduling(true);
    try {
      await onUnschedule?.(task.id);
      setHasChanges(true);
      toast.success("Task unscheduled successfully");
    } catch (error) {
      console.error("Error unscheduling task:", error);
      toast.error("Failed to unschedule task");
    } finally {
      setIsUnscheduling(false);
    }
  };

  const handleUnignore = async () => {
    if (!task) return;

    setIsUnignoring(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignored: false }),
      });

      if (!response.ok) {
        throw new Error("Failed to update task");
      }

      const updatedTask = await response.json();
      onTaskRefresh?.(updatedTask.task);
      setHasChanges(true);
      toast.success("Task is no longer ignored");
    } catch (error) {
      console.error("Error un-ignoring task:", error);
      toast.error("Failed to un-ignore task");
    } finally {
      setIsUnignoring(false);
    }
  };

  const handleSubtaskChange = async () => {
    // Mark that changes were made
    setHasChanges(true);
    // Refresh the task data in the dialog itself (parent task may have been unscheduled)
    // But don't refresh the full list until dialog closes for smoother UX
    if (task) {
      try {
        const response = await fetch(`/api/tasks/${task.id}`);
        if (response.ok) {
          const data = await response.json();
          // Update the task in parent component so dialog shows fresh data
          onTaskRefresh?.(data.task);
        }
        // Refresh subtasks count
        if (!(task.task_type === "subtask" || !!task.parent_task_id)) {
          await fetchSubtasksCount(task.id);
        }
      } catch (error) {
        console.error("Error refreshing task:", error);
      }
    }
  };

  const getStatusColor = (status: Task["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "in_progress":
        return "bg-blue-500";
      case "cancelled":
        return "bg-red-500";
      case "rescheduled":
        return "bg-teal-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusLabel = (status: Task["status"]) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "in_progress":
        return "In Progress";
      case "cancelled":
        return "Cancelled";
      case "rescheduled":
        return "Rescheduled";
      default:
        return "Pending";
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1:
        return "bg-red-500 text-white";
      case 2:
        return "bg-orange-500 text-white";
      case 3:
        return "bg-yellow-500 text-white";
      case 4:
        return "bg-green-500 text-white";
      case 5:
        return "bg-blue-500 text-white";
      default:
        return "bg-gray-500 text-white";
    }
  };

  const isSubtask = task.task_type === "subtask" || !!task.parent_task_id;
  const isCarryover = !!task.continued_from_task_id;

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] md:w-full mx-2 md:mx-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Top Action Bar */}
          <div className="space-y-3">
            {/* Compact Status Badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={`${getStatusColor(task.status)} text-xs px-1.5 py-0.5`}>
                {task.status === "completed" ? (
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                ) : (
                  <Circle className="h-2.5 w-2.5 mr-0.5" />
                )}
                {getStatusLabel(task.status)}
              </Badge>
              <Badge variant="outline" className="text-xs px-1.5 py-0.5">
                <Tag className="h-2.5 w-2.5 mr-0.5" />
                {TASK_TYPE_LABELS[task.task_type]}
              </Badge>
              <Badge className={`${getPriorityColor(task.priority)} text-xs px-1.5 py-0.5`}>
                <Flag className="h-2.5 w-2.5 mr-0.5" />
                P{task.priority}
              </Badge>
              {task.locked && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
                  <Lock className="h-2.5 w-2.5 mr-0.5" />
                  Locked
                </Badge>
              )}
              {isBlocked && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
                  <GitBranch className="h-2.5 w-2.5 mr-0.5" />
                  Blocked
                </Badge>
              )}
              {isCarryover && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                  <Link2 className="h-2.5 w-2.5 mr-0.5" />
                  Continued
                </Badge>
              )}
              {task.ignored && (
                <>
                  <Badge variant="outline" className="opacity-60 text-xs px-1.5 py-0.5">
                    <XCircle className="h-2.5 w-2.5 mr-0.5" />
                    Ignored
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnignore}
                    loading={isUnignoring}
                    className="h-6 text-xs px-2"
                  >
                    {isUnignoring ? "Removing..." : "Remove Ignore"}
                  </Button>
                </>
              )}
            </div>
            {/* Action Buttons */}
            <div className="border rounded-lg bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Status Change Actions */}
                {task.status === "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setIsChangingStatus(true);
                      try {
                        await onStatusChange?.(task.id, "pending");
                        setHasChanges(true);
                      } finally {
                        setIsChangingStatus(false);
                      }
                    }}
                    loading={isChangingStatus}
                  >
                    <Circle className="h-4 w-4 mr-1" />
                    Mark Incomplete
                  </Button>
                )}
                {task.status === "pending" && !isBlocked && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      setIsChangingStatus(true);
                      try {
                        await onStatusChange?.(task.id, "in_progress");
                        setHasChanges(true);
                      } finally {
                        setIsChangingStatus(false);
                      }
                    }}
                    loading={isChangingStatus}
                  >
                    Start Task
                  </Button>
                )}
                {task.status === "pending" && !isBlocked && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      setIsChangingStatus(true);
                      try {
                        await onStatusChange?.(task.id, "completed");
                        setHasChanges(true);
                      } finally {
                        setIsChangingStatus(false);
                      }
                    }}
                    loading={isChangingStatus}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Complete
                  </Button>
                )}
                {task.status === "in_progress" && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      setIsChangingStatus(true);
                      try {
                        await onStatusChange?.(task.id, "completed");
                        setHasChanges(true);
                      } finally {
                        setIsChangingStatus(false);
                      }
                    }}
                    loading={isChangingStatus}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Mark Complete
                  </Button>
                )}
                {task.status === "pending" && isBlocked && (
                  <Button size="sm" variant="outline" disabled>
                    Blocked
                  </Button>
                )}

                {/* Edit and Delete */}
                <Button size="sm" variant="outline" onClick={handleEdit}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  loading={isDeleting}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {/* Schedule Information */}
          {(task.scheduled_start || task.scheduled_end) && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Schedule
                  </h3>
                  {onUnschedule && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleUnschedule}
                      loading={isUnscheduling}
                    >
                      <CalendarX className="h-4 w-4 mr-2" />
                      {isUnscheduling ? "Unscheduling..." : "Unschedule"}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {task.scheduled_start && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16">Start:</span>
                      <span className="font-medium">
                        {formatDateTimeFull(task.scheduled_start, timezone)}
                      </span>
                    </div>
                  )}
                  {task.scheduled_end && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16">End:</span>
                      <span className="font-medium">
                        {formatDateTimeFull(task.scheduled_end, timezone)}
                      </span>
                    </div>
                  )}
                  {task.scheduled_start && task.scheduled_end && (
                    <div className="flex items-center gap-2 text-sm pt-2 border-t">
                      <span className="text-muted-foreground w-16">Duration:</span>
                      <span className="font-medium">
                        {Math.round(
                          (parseISO(task.scheduled_end).getTime() -
                            parseISO(task.scheduled_start).getTime()) /
                          60000
                        )}{" "}
                        minutes
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subtasks - Only show for non-subtask tasks */}
          {!isSubtask && (
            <Card>
              <CardContent className="p-0">
                <button
                  type="button"
                  onClick={() => setSubtasksExpanded(!subtasksExpanded)}
                  className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {subtasksExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <h3 className="text-sm font-semibold">Subtasks</h3>
                    {subtasksCount.total > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({subtasksCount.completed}/{subtasksCount.total})
                      </span>
                    )}
                  </div>
                  {subtasksCount.total === 0 && !subtasksExpanded && (
                    <span className="text-xs text-muted-foreground">No subtasks</span>
                  )}
                </button>
                {subtasksExpanded && (
                  <div className="border-t p-4">
                    <SubtaskManager
                      parentTaskId={task.id}
                      onSubtaskChange={handleSubtaskChange}
                      readOnly={
                        task.status === "completed" ||
                        task.status === "cancelled" ||
                        task.status === "rescheduled"
                      }
                      noCard={true}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Description */}
          {task.description && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-2">Description</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Blocked By Warning */}
          {isBlocked && blockedBy.length > 0 && (
            <Card className="border-destructive bg-destructive/10">
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-2 text-destructive flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Blocked by incomplete tasks
                </h3>
                <ul className="text-sm space-y-1">
                  {blockedBy.map((dep) => (
                    <li key={dep.id} className="flex items-center gap-2">
                      <Circle className="h-3 w-3 text-muted-foreground" />
                      <span>{dep.title}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Dependencies */}
          {dependencies.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Dependencies
                </h3>
                <ul className="text-sm space-y-1">
                  {dependencies.map((dep) => (
                    <li key={dep.id} className="flex items-center gap-2">
                      {dep.dependency_status === "completed" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span
                        className={
                          dep.dependency_status === "completed"
                            ? "line-through text-muted-foreground"
                            : ""
                        }
                      >
                        {dep.dependency_title}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Task Properties */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="text-sm font-semibold mb-3">Task Properties</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {task.duration && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">{task.duration} min</span>
                  </div>
                )}
                {task.energy_level_required && (
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Energy:</span>
                    <span className="font-medium">
                      {ENERGY_LABELS[task.energy_level_required as keyof typeof ENERGY_LABELS]}
                    </span>
                  </div>
                )}
                {task.due_date && (
                  <div className="flex items-center gap-2 text-sm col-span-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Due:</span>
                    <span className="font-medium">
                      {formatDateTimeFull(task.due_date, timezone)}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <div className="text-[10px] text-muted-foreground space-y-0.5 pt-3 border-t">
            <div>Created: {formatDateTimeFull(task.created_at, timezone)}</div>
            <div>Updated: {formatDateTimeFull(task.updated_at, timezone)}</div>
            {task.id && <div className="font-mono">ID: {task.id}</div>}
            {task.continued_from_task_id && (
              <div className="font-mono">Continued from: {task.continued_from_task_id}</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
