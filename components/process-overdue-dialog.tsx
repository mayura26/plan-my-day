"use client";

import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { getOverdueTasks } from "@/lib/task-utils";
import { formatDateTimeLocalForTimezone, parseDateTimeLocalToUTC } from "@/lib/timezone-utils";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProcessOverdueDialogProps {
  tasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksUpdated: () => void;
  onTaskUpdate?: (taskId: string, updatedTask: Task) => void;
}

type TaskAction =
  | "carryover"
  | "reschedule"
  | "schedule-now"
  | "update-due-date"
  | "ignore"
  | "mark-complete"
  | null;

interface TaskActionState {
  action: TaskAction;
  additionalDuration?: number;
  notes?: string;
  newDueDate?: string;
  autoSchedule?: boolean;
  rescheduleMode?: "next-available" | "asap-shuffle";
}

export function ProcessOverdueDialog({
  tasks,
  open,
  onOpenChange,
  onTasksUpdated,
  onTaskUpdate,
}: ProcessOverdueDialogProps) {
  const { timezone } = useUserTimezone();
  const { confirm } = useConfirmDialog();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskActions, setTaskActions] = useState<Map<string, TaskActionState>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use getOverdueTasks which filters out completed, cancelled, rescheduled, and ignored tasks
  const overdueTasks = getOverdueTasks(tasks);

  // Determine task type for each overdue task
  const getTaskType = (task: Task): "scheduled" | "due-date" => {
    const now = new Date();
    // If scheduled_end has passed, it's a scheduled task
    if (task.scheduled_end && new Date(task.scheduled_end) < now) {
      return "scheduled";
    }
    // Otherwise it's a due-date task
    return "due-date";
  };

  const handleSelectAction = (taskId: string, action: TaskAction, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const newActions = new Map(taskActions);
    if (action === null) {
      newActions.delete(taskId);
      setSelectedTaskId(null);
    } else {
      // Get existing state to preserve duration/notes if action is the same
      const existing = newActions.get(taskId);
      if (existing && existing.action === action) {
        // Action already selected - toggle it off
        newActions.delete(taskId);
        setSelectedTaskId(null);
      } else {
        // Set new action, preserving existing duration/notes if switching actions
        const preservedState =
          existing && existing.action !== action
            ? {
                additionalDuration: existing.additionalDuration,
                notes: existing.notes,
                newDueDate: existing.newDueDate,
                rescheduleMode: existing.rescheduleMode,
              }
            : {};
        // Set default reschedule mode if action is reschedule
        const defaultState =
          action === "reschedule" && !preservedState.rescheduleMode
            ? { rescheduleMode: "next-available" as const }
            : {};
        newActions.set(taskId, { action, ...preservedState, ...defaultState });
        setSelectedTaskId(taskId);
      }
    }
    setTaskActions(newActions);
  };

  const updateTaskAction = (taskId: string, updates: Partial<TaskActionState>) => {
    const newActions = new Map(taskActions);
    const current = newActions.get(taskId) || { action: null };
    newActions.set(taskId, { ...current, ...updates });
    setTaskActions(newActions);
  };

  const handleProcessAll = async () => {
    if (taskActions.size === 0) {
      setError("Please select actions for at least one task");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const promises: Promise<void>[] = [];

      for (const [taskId, actionState] of taskActions.entries()) {
        if (!actionState.action) continue;

        const task = overdueTasks.find((t) => t.id === taskId);
        if (!task) continue;

        if (actionState.action === "carryover") {
          // Create carryover task
          const createCarryover = async () => {
            const duration = actionState.additionalDuration || task.duration || 30;
            
            // First attempt
            let response = await fetch(`/api/tasks/${taskId}/carryover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                additional_duration: duration,
                notes: actionState.notes,
                auto_schedule: actionState.autoSchedule ?? false,
              }),
            });

            // If it's a subtask and we got an expansion error, show confirmation
            if (!response.ok && task.task_type === "subtask") {
              const errorData = await response.json();
              if (
                errorData.error &&
                errorData.error.includes("exceeds parent task duration")
              ) {
                // Show confirmation dialog for parent duration expansion
                const confirmed = await confirm({
                  title: "Expand Parent Task Duration?",
                  description: `Creating this carryover subtask requires expanding the parent task duration from ${errorData.parent_duration} min to ${errorData.total_with_carryover} min (an increase of ${errorData.required_extension} min). Do you want to proceed?`,
                  confirmText: "Expand & Create",
                  cancelText: "Cancel",
                  variant: "default",
                });

                if (!confirmed) {
                  throw new Error(`Carryover cancelled for ${task.title}`);
                }

                // Retry with extend_parent_duration flag
                response = await fetch(`/api/tasks/${taskId}/carryover`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    additional_duration: duration,
                    notes: actionState.notes,
                    auto_schedule: actionState.autoSchedule ?? false,
                    extend_parent_duration: true,
                  }),
                });
              }
            }

            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || `Failed to process ${task.title}`);
            }
          };

          promises.push(createCarryover());
        } else if (actionState.action === "reschedule") {
          // Reschedule task
          const promise = fetch(`/api/tasks/${taskId}/reschedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: actionState.rescheduleMode || "next-available",
              auto_schedule: actionState.autoSchedule ?? false,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to reschedule ${task.title}`);
            }
          });
          promises.push(promise);
        } else if (actionState.action === "schedule-now") {
          // Schedule task now
          const promise = fetch(`/api/tasks/${taskId}/schedule-now`, {
            method: "POST",
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to schedule ${task.title}`);
            }
          });
          promises.push(promise);
        } else if (actionState.action === "update-due-date") {
          // Update due date
          if (!actionState.newDueDate) {
            throw new Error(`Please provide a new due date for ${task.title}`);
          }
          const utcDate = parseDateTimeLocalToUTC(actionState.newDueDate, timezone);
          const promise = fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              due_date: utcDate,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to update ${task.title}`);
            }
          });
          promises.push(promise);
        } else if (actionState.action === "ignore") {
          // Mark as ignored
          const promise = fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ignored: true,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to ignore ${task.title}`);
            }
          });
          promises.push(promise);
        } else if (actionState.action === "mark-complete") {
          // Mark task as completed
          const promise = fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "completed",
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to complete ${task.title}`);
            }
          });
          promises.push(promise);
        }
      }

      await Promise.all(promises);
      onTasksUpdated();
      onOpenChange(false);
      // Reset state
      setTaskActions(new Map());
      setSelectedTaskId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process tasks");
    } finally {
      setIsProcessing(false);
    }
  };

  if (overdueTasks.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>No Overdue Tasks</DialogTitle>
            <DialogDescription>All tasks are up to date!</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Process Overdue Tasks ({overdueTasks.length})
          </DialogTitle>
          <DialogDescription>
            Review and handle your overdue tasks. Select an action for each task below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {overdueTasks.map((task) => {
            const taskType = getTaskType(task);
            const actionState = taskActions.get(task.id);
            const isSelected = selectedTaskId === task.id;

            return (
              // biome-ignore lint/a11y/useSemanticElements: Task container requires div for complex layout
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "border rounded-lg p-4 space-y-3",
                  isSelected && "ring-2 ring-primary"
                )}
                onClick={(e) => {
                  // Prevent clicks on the container from interfering
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              >
                {/* Task Info */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium">{task.title}</h4>
                    {task.parent_task_id && (() => {
                      const parentTask = tasks.find((t) => t.id === task.parent_task_id);
                      return parentTask ? (
                        <p className="text-sm text-muted-foreground/70 mt-0.5 italic">
                          {parentTask.title}
                        </p>
                      ) : null;
                    })()}
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      {task.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {task.duration} min
                        </span>
                      )}
                      {task.due_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Due: {new Date(task.due_date).toLocaleDateString()}
                        </span>
                      )}
                      {task.scheduled_end && (
                        <span className="flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" />
                          Was scheduled: {new Date(task.scheduled_end).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-xs px-2 py-1 rounded",
                      taskType === "scheduled"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                    )}
                  >
                    {taskType === "scheduled" ? "Scheduled" : "Due Date"}
                  </span>
                </div>

                {/* Action Selection */}
                {taskType === "scheduled" ? (
                  // Scheduled task: carryover, reschedule, and mark complete options
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.status === "pending" && (
                        <Button
                          variant={actionState?.action === "reschedule" ? "default" : "outline"}
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectAction(task.id, "reschedule", e);
                          }}
                          className="flex-1"
                          type="button"
                        >
                          <CalendarClock className="h-4 w-4 mr-2" />
                          Reschedule
                        </Button>
                      )}
                      <Button
                        variant={actionState?.action === "carryover" ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectAction(task.id, "carryover", e);
                        }}
                        className="flex-1"
                        type="button"
                        disabled={false}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Create Carryover
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();

                          setProcessingTaskId(task.id);
                          setError(null);

                          try {
                            const response = await fetch(`/api/tasks/${task.id}`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                status: "completed",
                              }),
                            });

                            if (!response.ok) {
                              const data = await response.json();
                              throw new Error(data.error || `Failed to complete ${task.title}`);
                            }

                            const responseData = await response.json();
                            const updatedTask = responseData.task;

                            // Update task locally if callback provided, otherwise refresh all
                            if (onTaskUpdate && updatedTask) {
                              onTaskUpdate(task.id, updatedTask);
                            } else {
                              onTasksUpdated();
                            }

                            toast.success(`Task "${task.title}" marked as complete`, {
                              description:
                                "The dialog will stay open so you can process more tasks.",
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "Failed to mark task as complete"
                            );
                          } finally {
                            setProcessingTaskId(null);
                          }
                        }}
                        className="flex-1"
                        type="button"
                        disabled={processingTaskId === task.id}
                        loading={processingTaskId === task.id}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Mark Complete
                      </Button>
                      {(actionState?.action === "carryover" || actionState?.action === "reschedule") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectAction(task.id, null, e);
                          }}
                          type="button"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {actionState?.action === "carryover" ? (
                      <div className="space-y-2 pt-2 border-t">
                        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                          <div>
                            <Label htmlFor={`duration-${task.id}`}>
                              Additional Duration (minutes)
                            </Label>
                            <Input
                              id={`duration-${task.id}`}
                              type="number"
                              min="1"
                              value={actionState.additionalDuration || task.duration || 30}
                              onChange={(e) =>
                                updateTaskAction(task.id, {
                                  additionalDuration: parseInt(e.target.value, 10) || 0,
                                })
                              }
                              className="h-9"
                              disabled={processingTaskId === task.id}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`notes-${task.id}`}>Notes (optional)</Label>
                            <Textarea
                              id={`notes-${task.id}`}
                              value={actionState.notes || ""}
                              onChange={(e) => updateTaskAction(task.id, { notes: e.target.value })}
                              rows={2}
                              className="resize-none"
                              placeholder="What's left to do?"
                              disabled={processingTaskId === task.id}
                            />
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`auto-schedule-${task.id}`}
                              checked={actionState.autoSchedule ?? false}
                              onCheckedChange={(checked) =>
                                updateTaskAction(task.id, { autoSchedule: checked === true })
                              }
                              disabled={processingTaskId === task.id}
                            />
                            <Label
                              htmlFor={`auto-schedule-${task.id}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              Auto-schedule to next available slot
                            </Label>
                          </div>
                          <Button
                            onClick={async () => {
                              const duration =
                                actionState.additionalDuration || task.duration || 30;
                              if (!duration || duration <= 0) {
                                setError("Please enter a valid duration");
                                return;
                              }

                              setProcessingTaskId(task.id);
                              setError(null);

                              try {
                                // First attempt to create carryover
                                let response = await fetch(`/api/tasks/${task.id}/carryover`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    additional_duration: duration,
                                    notes: actionState.notes,
                                    auto_schedule: actionState.autoSchedule ?? false,
                                  }),
                                });

                                // If it's a subtask and we got an expansion error, show confirmation
                                if (!response.ok && task.task_type === "subtask") {
                                  const errorData = await response.json();
                                  if (
                                    errorData.error &&
                                    errorData.error.includes("exceeds parent task duration")
                                  ) {
                                    // Show confirmation dialog for parent duration expansion
                                    const confirmed = await confirm({
                                      title: "Expand Parent Task Duration?",
                                      description: `Creating this carryover subtask requires expanding the parent task duration from ${errorData.parent_duration} min to ${errorData.total_with_carryover} min (an increase of ${errorData.required_extension} min). Do you want to proceed?`,
                                      confirmText: "Expand & Create",
                                      cancelText: "Cancel",
                                      variant: "default",
                                    });

                                    if (!confirmed) {
                                      setProcessingTaskId(null);
                                      return;
                                    }

                                    // Retry with extend_parent_duration flag
                                    response = await fetch(`/api/tasks/${task.id}/carryover`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        additional_duration: duration,
                                        notes: actionState.notes,
                                        auto_schedule: actionState.autoSchedule ?? false,
                                        extend_parent_duration: true,
                                      }),
                                    });
                                  }
                                }

                                if (!response.ok) {
                                  const data = await response.json();
                                  throw new Error(
                                    data.error || `Failed to create carryover for ${task.title}`
                                  );
                                }

                                const _responseData = await response.json();

                                // Remove this task from the actions map
                                const newActions = new Map(taskActions);
                                newActions.delete(task.id);
                                setTaskActions(newActions);
                                setSelectedTaskId(null);

                                // Show success message
                                toast.success(`Carryover created for "${task.title}"`, {
                                  description:
                                    "The dialog will stay open so you can process more tasks.",
                                });

                                // Refresh tasks to update the list (this will filter out rescheduled tasks)
                                // The task should now be filtered out by getOverdueTasks since it's rescheduled
                                // Note: Dialog stays open intentionally so user can process more tasks
                                onTasksUpdated();
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : "Failed to create carryover task"
                                );
                              } finally {
                                setProcessingTaskId(null);
                              }
                            }}
                            disabled={
                              processingTaskId === task.id ||
                              !(actionState.additionalDuration || task.duration || 30)
                            }
                            loading={processingTaskId === task.id}
                            className="w-full"
                            size="sm"
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            {processingTaskId === task.id ? "Creating..." : "Create"}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {actionState?.action === "reschedule" ? (
                      <div className="space-y-2 pt-2 border-t">
                        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                          <div>
                            <Label>Reschedule Mode</Label>
                            <div className="flex items-center gap-2 mt-2">
                              <Button
                                variant={
                                  actionState.rescheduleMode === "next-available"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateTaskAction(task.id, { rescheduleMode: "next-available" });
                                }}
                                className="flex-1"
                                type="button"
                                disabled={processingTaskId === task.id}
                              >
                                Next Available Slot
                              </Button>
                              <Button
                                variant={
                                  actionState.rescheduleMode === "asap-shuffle"
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateTaskAction(task.id, { rescheduleMode: "asap-shuffle" });
                                }}
                                className="flex-1"
                                type="button"
                                disabled={processingTaskId === task.id}
                              >
                                ASAP with Shuffling
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              {actionState.rescheduleMode === "asap-shuffle"
                                ? "Places task at next working hours slot and shuffles conflicting tasks forward"
                                : "Finds the next available slot respecting due dates"}
                            </p>
                          </div>
                          <Button
                            onClick={async () => {
                              const mode = actionState.rescheduleMode || "next-available";

                              setProcessingTaskId(task.id);
                              setError(null);

                              try {
                                const response = await fetch(`/api/tasks/${task.id}/reschedule`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    mode,
                                    auto_schedule: actionState.autoSchedule ?? false,
                                  }),
                                });

                                if (!response.ok) {
                                  const data = await response.json();
                                  throw new Error(
                                    data.error || `Failed to reschedule ${task.title}`
                                  );
                                }

                                const responseData = await response.json();

                                // Remove this task from the actions map
                                const newActions = new Map(taskActions);
                                newActions.delete(task.id);
                                setTaskActions(newActions);
                                setSelectedTaskId(null);

                                // Show success message
                                toast.success(`Task "${task.title}" rescheduled`, {
                                  description:
                                    responseData.shuffledTasks?.length > 0
                                      ? `${responseData.shuffledTasks.length} task(s) were shuffled.`
                                      : "The dialog will stay open so you can process more tasks.",
                                });

                                // Refresh tasks
                                onTasksUpdated();
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : "Failed to reschedule task"
                                );
                              } finally {
                                setProcessingTaskId(null);
                              }
                            }}
                            disabled={processingTaskId === task.id}
                            loading={processingTaskId === task.id}
                            className="w-full"
                            size="sm"
                          >
                            <CalendarClock className="h-4 w-4 mr-2" />
                            {processingTaskId === task.id ? "Rescheduling..." : "Reschedule"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  // Due date task: four options
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant={actionState?.action === "schedule-now" ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => handleSelectAction(task.id, "schedule-now", e)}
                        className="text-xs"
                        type="button"
                      >
                        <CalendarClock className="h-3 w-3 mr-1" />
                        Schedule Now
                      </Button>
                      <Button
                        variant={actionState?.action === "update-due-date" ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => handleSelectAction(task.id, "update-due-date", e)}
                        className="text-xs"
                        type="button"
                      >
                        <Calendar className="h-3 w-3 mr-1" />
                        Update Due Date
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();

                          setProcessingTaskId(task.id);
                          setError(null);

                          try {
                            const response = await fetch(`/api/tasks/${task.id}`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                status: "completed",
                              }),
                            });

                            if (!response.ok) {
                              const data = await response.json();
                              throw new Error(data.error || `Failed to complete ${task.title}`);
                            }

                            const responseData = await response.json();
                            const updatedTask = responseData.task;

                            // Update task locally if callback provided, otherwise refresh all
                            if (onTaskUpdate && updatedTask) {
                              onTaskUpdate(task.id, updatedTask);
                            } else {
                              onTasksUpdated();
                            }

                            toast.success(`Task "${task.title}" marked as complete`, {
                              description:
                                "The dialog will stay open so you can process more tasks.",
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "Failed to mark task as complete"
                            );
                          } finally {
                            setProcessingTaskId(null);
                          }
                        }}
                        className="text-xs"
                        type="button"
                        disabled={processingTaskId === task.id}
                        loading={processingTaskId === task.id}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Mark Complete
                      </Button>
                      <Button
                        variant={actionState?.action === "ignore" ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => handleSelectAction(task.id, "ignore", e)}
                        className="text-xs"
                        type="button"
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Ignore
                      </Button>
                    </div>

                    {actionState?.action === "update-due-date" && (
                      <div className="pt-2 border-t">
                        <Label htmlFor={`due-date-${task.id}`}>New Due Date</Label>
                        <Input
                          id={`due-date-${task.id}`}
                          type="datetime-local"
                          value={
                            actionState.newDueDate ||
                            formatDateTimeLocalForTimezone(
                              task.due_date || new Date().toISOString(),
                              timezone
                            )
                          }
                          onChange={(e) =>
                            updateTaskAction(task.id, { newDueDate: e.target.value })
                          }
                          className="h-9"
                          min={formatDateTimeLocalForTimezone(new Date().toISOString(), timezone)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">{error}</div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            onClick={handleProcessAll}
            loading={isProcessing}
            disabled={isProcessing || taskActions.size === 0}
          >
            {isProcessing ? "Processing..." : `Process ${taskActions.size} Task(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
