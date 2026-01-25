"use client";

import { parseISO } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  CalendarClock,
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
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { NotesManager } from "@/components/notes-manager";
import { SchedulingErrorDialog } from "@/components/scheduling-error-dialog";
import { SubtaskManager } from "@/components/subtask-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { ENERGY_LABELS, TASK_TYPE_LABELS } from "@/lib/task-utils";
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
  const [isMarkingIncomplete, setIsMarkingIncomplete] = useState(false);
  const [isStartingTask, setIsStartingTask] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [schedulingMode, setSchedulingMode] = useState<string | null>(null);
  const [_schedulingFeedback, setSchedulingFeedback] = useState<string[]>([]);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDialogError, setErrorDialogError] = useState<string>("");
  const [errorDialogFeedback, setErrorDialogFeedback] = useState<string[]>([]);
  const [isLoadingParent, setIsLoadingParent] = useState(false);
  const [_dependencies, setDependencies] = useState<DependencyInfo[]>([]);
  const [blockedBy, setBlockedBy] = useState<Task[]>([]);
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [subtasksCount, setSubtasksCount] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesCount, setNotesCount] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [parentTaskName, setParentTaskName] = useState<string | null>(null);
  const { timezone } = useUserTimezone();

  const fetchDependencies = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/dependencies`);
      if (response.ok) {
        const data = await response.json();
        // Filter out the task itself from dependencies
        const filteredDependencies = (data.dependencies || []).filter(
          (dep: DependencyInfo) => dep.depends_on_task_id !== taskId
        );
        setDependencies(filteredDependencies);
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

  const fetchNotesCount = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/todos`);
      if (response.ok) {
        const data = await response.json();
        const todos = data.todos || [];
        const completed = todos.filter((todo: { completed: boolean }) => todo.completed).length;
        setNotesCount({ completed, total: todos.length });
      }
    } catch (error) {
      console.error("Error fetching notes count:", error);
    }
  }, []);

  const fetchParentTaskName = useCallback(async (parentTaskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}`);
      if (response.ok) {
        const data = await response.json();
        setParentTaskName(data.task?.title || null);
      }
    } catch (error) {
      console.error("Error fetching parent task:", error);
      setParentTaskName(null);
    }
  }, []);

  // Track when dialog opens to fetch dependencies only once
  const openedTaskIdRef = useRef<string | null>(null);
  const lastUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && task?.id) {
      // Fetch dependencies if this is a new dialog open (different task or first open)
      // OR if the task's updated_at has changed (indicating the task was modified)
      const isNewTask = openedTaskIdRef.current !== task.id;
      const taskWasUpdated = task.updated_at && lastUpdatedAtRef.current !== task.updated_at;

      if (isNewTask || taskWasUpdated) {
        openedTaskIdRef.current = task.id;
        lastUpdatedAtRef.current = task.updated_at || null;
        fetchDependencies(task.id);
        // Fetch subtasks count for non-subtask tasks
        if (!(task.task_type === "subtask" || !!task.parent_task_id)) {
          fetchSubtasksCount(task.id);
        }
        // Fetch notes count for all tasks
        fetchNotesCount(task.id);
        // Fetch parent task name if this is a subtask
        if (task.parent_task_id) {
          fetchParentTaskName(task.parent_task_id);
        } else {
          setParentTaskName(null);
        }
        // Reset change tracking when dialog opens
        if (isNewTask) {
          setHasChanges(false);
        }
      }
    }
    // Reset ref when dialog closes
    if (!open) {
      openedTaskIdRef.current = null;
      lastUpdatedAtRef.current = null;
      setParentTaskName(null);
    }
  }, [
    open,
    task?.id,
    task?.updated_at,
    fetchDependencies,
    fetchSubtasksCount,
    fetchNotesCount,
    fetchParentTaskName,
    task?.task_type,
    task?.parent_task_id,
  ]);

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
        // Refresh notes count
        await fetchNotesCount(task.id);
      } catch (error) {
        console.error("Error refreshing task:", error);
      }
    }
  };

  const handleNotesChange = async () => {
    // Mark that changes were made
    setHasChanges(true);
    // Refresh notes count
    if (task) {
      await fetchNotesCount(task.id);
    }
  };

  const handleNavigateToParent = async () => {
    if (!task?.parent_task_id) return;

    setIsLoadingParent(true);
    try {
      const response = await fetch(`/api/tasks/${task.parent_task_id}`);
      if (response.ok) {
        const data = await response.json();
        const parentTask = data.task;
        if (parentTask) {
          // Update the dialog to show the parent task
          onTaskRefresh?.(parentTask);
          toast.success(`Navigated to parent task: ${parentTask.title}`);
        } else {
          toast.error("Parent task not found");
        }
      } else {
        toast.error("Failed to load parent task");
      }
    } catch (error) {
      console.error("Error fetching parent task:", error);
      toast.error("Failed to load parent task");
    } finally {
      setIsLoadingParent(false);
    }
  };

  const handleSchedule = async (
    mode: "now" | "today" | "tomorrow" | "next-week" | "next-month" | "asap" | "due-date"
  ) => {
    if (!task) return;

    setIsScheduling(true);
    setSchedulingMode(mode);
    try {
      const endpointMap = {
        now: "schedule-now",
        today: "schedule-today",
        tomorrow: "schedule-tomorrow",
        "next-week": "schedule-next-week",
        "next-month": "schedule-next-month",
        asap: "schedule-asap",
        "due-date": "schedule-due-date",
      };

      const response = await fetch(`/api/tasks/${task.id}/${endpointMap[mode]}`, {
        method: "POST",
      });

      if (!response.ok) {
        let errorData: { error?: string; feedback?: string[] } = {};
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
        }

        // Store feedback from error response if available
        const feedback =
          errorData.feedback && Array.isArray(errorData.feedback) ? errorData.feedback : [];
        setSchedulingFeedback(feedback);

        // Show error in dialog instead of toast
        setErrorDialogError(errorData.error || `Failed to schedule task (${mode})`);
        setErrorDialogFeedback(feedback);
        setErrorDialogOpen(true);

        throw new Error(errorData.error || `Failed to schedule task (${mode})`);
      }

      const data = await response.json();
      const updatedTask = data.task;
      const shuffledTasks = data.shuffledTasks || [];
      const scheduledSubtasks = data.scheduledSubtasks || [];
      const feedback = data.feedback || [];

      // Store feedback for display
      setSchedulingFeedback(feedback);

      if (updatedTask) {
        onTaskRefresh?.(updatedTask);
      }
      setHasChanges(true);

      // Refresh task list to show shuffled tasks if any were shuffled
      if (shuffledTasks.length > 0 || scheduledSubtasks.length > 0) {
        onTaskUpdate?.();
        // Also trigger subtask change to refresh SubtaskManager component
        if (scheduledSubtasks.length > 0) {
          handleSubtaskChange();
        }
      }

      // Show success message
      const modeLabels = {
        now: "Schedule Now",
        today: "Schedule Today",
        tomorrow: "Schedule Tomorrow",
        "next-week": "Schedule Next Week",
        "next-month": "Schedule Next Month",
        asap: "Schedule ASAP",
        "due-date": "Schedule to Due Date",
      };

      // Show feedback messages as toasts
      if (feedback.length > 0) {
        // Show the last few feedback messages
        const recentFeedback = feedback.slice(-3);
        recentFeedback.forEach((msg: string, index: number) => {
          setTimeout(() => {
            toast.info(msg, { duration: 3000 });
          }, index * 500);
        });
      }

      if (scheduledSubtasks.length > 0) {
        toast.success(
          `${modeLabels[mode]} completed. Scheduled ${scheduledSubtasks.length} subtask(s).`
        );
      } else if (shuffledTasks.length > 0) {
        toast.success(
          `${modeLabels[mode]} completed. ${shuffledTasks.length} task(s) shuffled forward.`
        );
      } else {
        toast.success(`${modeLabels[mode]} completed successfully`);
      }
    } catch (error) {
      console.error(`Error scheduling task (${mode}):`, error);
      // Only show dialog if it's not already open (to avoid duplicate dialogs)
      if (!errorDialogOpen) {
        setErrorDialogError(
          error instanceof Error ? error.message : `Failed to schedule task (${mode})`
        );
        setErrorDialogFeedback([]);
        setErrorDialogOpen(true);
      }
    } finally {
      setIsScheduling(false);
      setSchedulingMode(null);
      // Clear feedback after a delay
      setTimeout(() => setSchedulingFeedback([]), 5000);
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden w-[95vw] md:w-full mx-2 md:mx-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <div className="flex-1">
              <DialogTitle className="text-xl sm:text-2xl">{task.title}</DialogTitle>
              {isSubtask && parentTaskName && (
                <p className="text-sm text-muted-foreground mt-1">{parentTaskName}</p>
              )}
            </div>
            {isSubtask && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleNavigateToParent}
                loading={isLoadingParent}
                className="flex-shrink-0"
                title="Go to parent task"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Parent Task</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 overflow-x-hidden">
          {/* Top Action Bar */}
          <div className="space-y-2 sm:space-y-3">
            {/* Compact Status Badges */}
            <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
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
                <Flag className="h-2.5 w-2.5 mr-0.5" />P{task.priority}
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
            <div className="border rounded-lg bg-muted/30 py-2 px-3 sm:py-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {/* Status Change Actions */}
                {task.status === "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      flushSync(() => {
                        setIsMarkingIncomplete(true);
                      });
                      try {
                        await onStatusChange?.(task.id, "pending");
                        setHasChanges(true);
                      } finally {
                        setIsMarkingIncomplete(false);
                      }
                    }}
                    loading={isMarkingIncomplete}
                    className="flex-1 sm:flex-initial text-xs sm:text-sm"
                  >
                    <Circle className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Mark Incomplete</span>
                    <span className="sm:hidden">Incomplete</span>
                  </Button>
                )}
                {task.status === "pending" && !isBlocked && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      flushSync(() => {
                        setIsStartingTask(true);
                      });
                      try {
                        await onStatusChange?.(task.id, "in_progress");
                        setHasChanges(true);
                      } finally {
                        setIsStartingTask(false);
                      }
                    }}
                    loading={isStartingTask}
                    className="flex-1 sm:flex-initial text-xs sm:text-sm"
                  >
                    Start Task
                  </Button>
                )}
                {task.status === "pending" && !isBlocked && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      flushSync(() => {
                        setIsMarkingComplete(true);
                      });
                      try {
                        await onStatusChange?.(task.id, "completed");
                        setHasChanges(true);
                      } finally {
                        setIsMarkingComplete(false);
                      }
                    }}
                    loading={isMarkingComplete}
                    className="flex-1 sm:flex-initial text-xs sm:text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Mark Complete</span>
                    <span className="sm:hidden">Complete</span>
                  </Button>
                )}
                {task.status === "in_progress" && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={async () => {
                      flushSync(() => {
                        setIsMarkingComplete(true);
                      });
                      try {
                        await onStatusChange?.(task.id, "completed");
                        setHasChanges(true);
                      } finally {
                        setIsMarkingComplete(false);
                      }
                    }}
                    loading={isMarkingComplete}
                    className="flex-1 sm:flex-initial text-xs sm:text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Mark Complete</span>
                    <span className="sm:hidden">Complete</span>
                  </Button>
                )}
                {task.status === "pending" && isBlocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="flex-1 sm:flex-initial text-xs sm:text-sm"
                  >
                    Blocked
                  </Button>
                )}

                {/* Edit and Delete */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEdit}
                  className="flex-1 sm:flex-initial text-xs sm:text-sm"
                >
                  <Edit className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  loading={isDeleting}
                  className="flex-1 sm:flex-initial text-xs sm:text-sm"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Schedule Information */}
          {(task.scheduled_start ||
            task.scheduled_end ||
            ((task.task_type === "task" || task.task_type === "todo") && task.duration)) && (
            <Card className="py-2 overflow-x-hidden">
              <CardContent className="pt-0 pb-0 px-3 sm:px-6 overflow-x-hidden">
                <div className="flex flex-col gap-2 mb-2 sm:mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Schedule
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    {(task.task_type === "task" || task.task_type === "todo") &&
                      task.duration &&
                      task.duration > 0 && (
                        <div className="flex items-center">
                          <Button
                            size="sm"
                            variant="default"
                            disabled={isScheduling}
                            onClick={() => handleSchedule("now")}
                            className="text-xs sm:text-sm flex-1 min-w-[140px] rounded-r-none"
                          >
                            <Clock className="h-4 w-4 mr-2" />
                            {isScheduling
                              ? `Scheduling${schedulingMode ? ` (${schedulingMode})` : ""}...`
                              : "Schedule Now"}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="default"
                                disabled={isScheduling}
                                className="px-2 rounded-l-none border-l border-l-white/20"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => handleSchedule("today")}>
                                <CalendarClock className="h-4 w-4 mr-2" />
                                Schedule Today
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleSchedule("tomorrow")}>
                                <CalendarClock className="h-4 w-4 mr-2" />
                                Schedule Tomorrow
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleSchedule("next-week")}>
                                <Calendar className="h-4 w-4 mr-2" />
                                Schedule Next Week
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleSchedule("next-month")}>
                                <Calendar className="h-4 w-4 mr-2" />
                                Schedule Next Month
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => task.due_date && handleSchedule("due-date")}
                                disabled={!task.due_date}
                              >
                                <Flag className="h-4 w-4 mr-2" />
                                Schedule to Due Date
                                {!task.due_date && (
                                  <span className="ml-2 text-xs text-muted-foreground">(no due date)</span>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleSchedule("asap")}>
                                <Zap className="h-4 w-4 mr-2" />
                                Schedule ASAP
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    {onUnschedule && (task.scheduled_start || task.scheduled_end) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleUnschedule}
                        loading={isUnscheduling}
                        className="text-xs sm:text-sm flex-1 min-w-[140px]"
                      >
                        <CalendarX className="h-4 w-4 mr-2" />
                        {isUnscheduling ? "Unscheduling..." : "Unschedule"}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {task.scheduled_start && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                      <span className="text-muted-foreground sm:w-16">Start:</span>
                      <span className="font-medium break-words">
                        {formatDateTimeFull(task.scheduled_start, timezone)}
                      </span>
                    </div>
                  )}
                  {task.scheduled_end && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                      <span className="text-muted-foreground sm:w-16">End:</span>
                      <span className="font-medium break-words">
                        {formatDateTimeFull(task.scheduled_end, timezone)}
                      </span>
                    </div>
                  )}
                  {task.scheduled_start && task.scheduled_end && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm pt-2 border-t">
                      <span className="text-muted-foreground sm:w-16">Duration:</span>
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
                  {!task.scheduled_start &&
                    !task.scheduled_end &&
                    (task.task_type === "task" || task.task_type === "todo") &&
                    task.duration &&
                    task.duration > 0 && (
                      <div className="text-sm text-muted-foreground pt-2">
                        This {task.task_type === "todo" ? "todo" : "task"} is not yet scheduled.
                        Click "Schedule Now" to automatically schedule it to the next available slot
                        today.
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subtasks - Only show for non-subtask tasks */}
          {!isSubtask && (
            <Card className="py-0 overflow-x-hidden">
              <CardContent className="p-0 overflow-x-hidden">
                <button
                  type="button"
                  onClick={() => setSubtasksExpanded(!subtasksExpanded)}
                  className="w-full flex items-center justify-between py-2 px-3 sm:py-4 sm:px-6 hover:bg-accent/50 transition-colors"
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
                  <div className="border-t py-2 px-3 sm:py-4 sm:px-6 overflow-x-hidden">
                    <SubtaskManager
                      key={`${task.id}-${task.updated_at}`}
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

          {/* Notes */}
          <Card className="py-0 overflow-x-hidden">
            <CardContent className="p-0 overflow-x-hidden">
              <button
                type="button"
                onClick={() => setNotesExpanded(!notesExpanded)}
                className="w-full flex items-center justify-between py-2 px-3 sm:py-4 sm:px-6 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {notesExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h3 className="text-sm font-semibold">Notes</h3>
                  {notesCount.total > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({notesCount.completed}/{notesCount.total} checked)
                    </span>
                  )}
                </div>
                {notesCount.total === 0 && !notesExpanded && (
                  <span className="text-xs text-muted-foreground">No notes</span>
                )}
              </button>
              {notesExpanded && (
                <div className="border-t py-2 px-3 sm:py-4 sm:px-6 overflow-x-hidden">
                  <NotesManager
                    taskId={task.id}
                    onNotesChange={handleNotesChange}
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

          {/* Description */}
          {task.description && (
            <Card className="py-2 overflow-x-hidden">
              <CardContent className="pt-0 pb-0 px-3 sm:px-6 overflow-x-hidden">
                <h3 className="text-sm font-semibold mb-1.5 sm:mb-2">Description</h3>
                <p className="text-xs sm:text-sm text-muted-foreground whitespace-pre-wrap break-words">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Blocked By Warning */}
          {isBlocked && blockedBy.length > 0 && (
            <Card className="border-destructive bg-destructive/10 py-2 overflow-x-hidden">
              <CardContent className="pt-0 pb-0 px-3 sm:px-6 overflow-x-hidden">
                <h3 className="text-sm font-semibold mb-1.5 sm:mb-2 text-destructive flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Blocked by incomplete tasks
                </h3>
                <ul className="text-xs sm:text-sm space-y-1">
                  {blockedBy.map((dep) => (
                    <li key={dep.id} className="flex items-center gap-2 break-words">
                      <Circle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span>{dep.title}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Task Properties */}
          <Card className="py-2 sm:py-6 overflow-x-hidden">
            <CardContent className="pt-0 pb-0 px-3 sm:px-6 overflow-x-hidden">
              <h3 className="text-sm font-semibold mb-2 sm:mb-3">Task Properties</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {task.duration && (
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">{task.duration} min</span>
                  </div>
                )}
                {task.energy_level_required && (
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <Zap className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Energy:</span>
                    <span className="font-medium">
                      {ENERGY_LABELS[task.energy_level_required as keyof typeof ENERGY_LABELS]}
                    </span>
                  </div>
                )}
                {task.due_date && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm col-span-2">
                    <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Due:</span>
                    <span className="font-medium break-words">
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
      <SchedulingErrorDialog
        open={errorDialogOpen}
        onOpenChange={setErrorDialogOpen}
        error={errorDialogError}
        feedback={errorDialogFeedback}
      />
    </Dialog>
  );
}
