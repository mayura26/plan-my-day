"use client";

import { AlertTriangle, Calendar, CalendarClock, Clock, RotateCcw, X, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { getOverdueTasks } from "@/lib/task-utils";
import { formatDateTimeLocalForTimezone, parseDateTimeLocalToUTC } from "@/lib/timezone-utils";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProcessOverdueDialogProps {
  tasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksUpdated: () => void;
}

type TaskAction = "carryover" | "schedule-now" | "update-due-date" | "ignore" | null;

interface TaskActionState {
  action: TaskAction;
  additionalDuration?: number;
  notes?: string;
  newDueDate?: string;
}

export function ProcessOverdueDialog({
  tasks,
  open,
  onOpenChange,
  onTasksUpdated,
}: ProcessOverdueDialogProps) {
  const { timezone } = useUserTimezone();
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
              }
            : {};
        newActions.set(taskId, { action, ...preservedState });
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
          const promise = fetch(`/api/tasks/${taskId}/carryover`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              additional_duration: actionState.additionalDuration || task.duration || 30,
              notes: actionState.notes,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || `Failed to process ${task.title}`);
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
              <div
                key={task.id}
                className={cn(
                  "border rounded-lg p-4 space-y-3",
                  isSelected && "ring-2 ring-primary"
                )}
                onClick={(e) => {
                  // Prevent clicks on the container from interfering
                  e.stopPropagation();
                }}
              >
                {/* Task Info */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium">{task.title}</h4>
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
                  // Scheduled task: only carryover option
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <div className="flex items-center gap-2">
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
                      {actionState?.action === "carryover" && (
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
                                const response = await fetch(`/api/tasks/${task.id}/carryover`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    additional_duration: duration,
                                    notes: actionState.notes,
                                  }),
                                });

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

                                // Refresh tasks to update the list (this will filter out rescheduled tasks)
                                // The task should now be filtered out by getOverdueTasks since it's rescheduled
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
                            className="w-full"
                            size="sm"
                          >
                            {processingTaskId === task.id ? (
                              "Creating..."
                            ) : (
                              <>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Create
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  // Due date task: three options
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <div className="grid grid-cols-3 gap-2">
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
          <Button onClick={handleProcessAll} disabled={isProcessing || taskActions.size === 0}>
            {isProcessing ? "Processing..." : `Process ${taskActions.size} Task(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
