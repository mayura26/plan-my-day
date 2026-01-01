"use client";

import { parseISO } from "date-fns";
import {
  Calendar,
  CalendarX,
  CheckCircle2,
  Circle,
  Clock,
  Edit,
  Flag,
  GitBranch,
  Link2,
  Lock,
  Tag,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SubtaskManager } from "@/components/subtask-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnscheduling, setIsUnscheduling] = useState(false);
  const [dependencies, setDependencies] = useState<DependencyInfo[]>([]);
  const [blockedBy, setBlockedBy] = useState<Task[]>([]);
  const [isBlocked, setIsBlocked] = useState(false);
  const { timezone } = useUserTimezone();

  const fetchDependencies = useCallback(async () => {
    if (!task) return;
    try {
      const response = await fetch(`/api/tasks/${task.id}/dependencies`);
      if (response.ok) {
        const data = await response.json();
        setDependencies(data.dependencies || []);
        setBlockedBy(data.blocked_by || []);
        setIsBlocked(data.is_blocked || false);
      }
    } catch (error) {
      console.error("Error fetching dependencies:", error);
    }
  }, [task]);

  useEffect(() => {
    if (open && task) {
      fetchDependencies();
    }
  }, [open, task, fetchDependencies]);

  if (!task) return null;

  // Handle dialog close - refresh task list when dialog is closed
  const handleDialogClose = (newOpen: boolean) => {
    if (!newOpen) {
      // Dialog is being closed, refresh the task list
      onTaskUpdate?.();
    }
    onOpenChange(newOpen);
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    setIsDeleting(true);
    try {
      await onDelete?.(task.id);
      handleDialogClose(false);
    } catch (error) {
      console.error("Error deleting task:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = () => {
    onEdit?.(task.id);
    handleDialogClose(false);
  };

  const handleUnschedule = async () => {
    if (
      !confirm(
        "Are you sure you want to unschedule this task? It will be removed from the calendar."
      )
    )
      return;

    setIsUnscheduling(true);
    try {
      await onUnschedule?.(task.id);
    } catch (error) {
      console.error("Error unscheduling task:", error);
    } finally {
      setIsUnscheduling(false);
    }
  };

  const handleSubtaskChange = async () => {
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

        <div className="space-y-6">
          {/* Status and Type Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge className={getStatusColor(task.status)}>
              {task.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <Circle className="h-3 w-3 mr-1" />
              )}
              {getStatusLabel(task.status)}
            </Badge>
            <Badge variant="outline">
              <Tag className="h-3 w-3 mr-1" />
              {TASK_TYPE_LABELS[task.task_type]}
            </Badge>
            <Badge className={getPriorityColor(task.priority)}>
              <Flag className="h-3 w-3 mr-1" />
              Priority {task.priority} -{" "}
              {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
            </Badge>
            {task.locked && (
              <Badge variant="destructive">
                <Lock className="h-3 w-3 mr-1" />
                Locked
              </Badge>
            )}
            {isBlocked && (
              <Badge variant="destructive">
                <GitBranch className="h-3 w-3 mr-1" />
                Blocked
              </Badge>
            )}
            {isCarryover && (
              <Badge variant="secondary">
                <Link2 className="h-3 w-3 mr-1" />
                Continued
              </Badge>
            )}
          </div>

          {/* Blocked By Warning */}
          {isBlocked && blockedBy.length > 0 && (
            <Card className="border-destructive bg-destructive/10">
              <CardContent className="pt-6">
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

          {/* Description */}
          {task.description && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold mb-2">Description</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Subtasks - Only show for non-subtask tasks */}
          {!isSubtask && (
            <SubtaskManager
              parentTaskId={task.id}
              onSubtaskChange={handleSubtaskChange}
              readOnly={task.status === "completed" || task.status === "cancelled"}
            />
          )}

          {/* Dependencies */}
          {dependencies.length > 0 && (
            <Card>
              <CardContent className="pt-6">
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

          {/* Schedule Information */}
          {(task.scheduled_start || task.scheduled_end) && (
            <Card>
              <CardContent className="pt-6">
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
                      disabled={isUnscheduling}
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

          {/* Task Properties */}
          <Card>
            <CardContent className="pt-6">
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

          {/* Quick Status Change */}
          {task.status !== "completed" && task.status !== "cancelled" && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
                <div className="flex flex-wrap gap-2">
                  {task.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onStatusChange?.(task.id, "in_progress")}
                      disabled={isBlocked}
                    >
                      {isBlocked ? "Blocked" : "Start Task"}
                    </Button>
                  )}
                  {task.status === "in_progress" && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onStatusChange?.(task.id, "completed")}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark Complete
                    </Button>
                  )}
                  {task.status === "pending" && !isBlocked && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onStatusChange?.(task.id, "completed")}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark Complete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-0 pt-4 border-t">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="h-11 px-4 md:h-10 md:px-4 w-full sm:w-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? "Deleting..." : "Delete Task"}
            </Button>
            <Button onClick={handleEdit} className="h-11 px-4 md:h-10 md:px-4 w-full sm:w-auto">
              <Edit className="h-4 w-4 mr-2" />
              Edit Task
            </Button>
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1 pt-4 border-t">
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
