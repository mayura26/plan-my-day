"use client";

import { CheckCircle2, Circle, Clock, Plus, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ENERGY_LABELS, formatDuration, PRIORITY_LABELS } from "@/lib/task-utils";
import type { Task } from "@/lib/types";

interface SubtaskManagerProps {
  parentTaskId: string;
  onSubtaskChange?: () => void;
  readOnly?: boolean;
  noCard?: boolean; // If true, don't render the Card wrapper
}

interface SubtaskFormData {
  title: string;
  duration?: number;
  priority: number;
  energy_level_required: number;
}

export function SubtaskManager({
  parentTaskId,
  onSubtaskChange,
  readOnly = false,
  noCard = false,
}: SubtaskManagerProps) {
  const { confirm } = useConfirmDialog();
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [parentTaskDuration, setParentTaskDuration] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [togglingSubtaskId, setTogglingSubtaskId] = useState<string | null>(null);
  const [deletingSubtaskId, setDeletingSubtaskId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SubtaskFormData>({
    title: "",
    duration: undefined,
    priority: 3,
    energy_level_required: 3,
  });

  const fetchParentTask = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}`);
      if (response.ok) {
        const data = await response.json();
        setParentTaskDuration(data.task?.duration ?? null);
      }
    } catch (error) {
      console.error("Error fetching parent task:", error);
    }
  }, [parentTaskId]);

  const fetchSubtasks = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}/subtasks`);
      if (response.ok) {
        const data = await response.json();
        setSubtasks(data.subtasks || []);
      }
    } catch (error) {
      console.error("Error fetching subtasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, [parentTaskId]);

  useEffect(() => {
    fetchParentTask();
    fetchSubtasks();
  }, [fetchParentTask, fetchSubtasks]);

  // Calculate duration metrics
  const calculateDurationMetrics = (includeNewSubtask: boolean = false) => {
    const totalUsed = subtasks.reduce((sum, st) => sum + (st.duration || 0), 0);
    const newSubtaskDuration = includeNewSubtask ? formData.duration || 0 : 0;
    const totalUsedWithNew = totalUsed + newSubtaskDuration;
    const remaining = parentTaskDuration !== null ? parentTaskDuration - totalUsedWithNew : null;
    return {
      used: totalUsedWithNew,
      remaining,
      total: parentTaskDuration,
    };
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    // Check if adding this subtask would exceed parent duration
    if (parentTaskDuration !== null) {
      const metricsWithNew = calculateDurationMetrics(true);
      if (metricsWithNew.remaining !== null && metricsWithNew.remaining < 0) {
        // Calculate new parent duration needed
        const newParentDuration = parentTaskDuration + Math.abs(metricsWithNew.remaining);
        const confirmed = await confirm({
          title: "Extend Parent Task Duration?",
          description: `Adding this subtask would exceed the parent task duration by ${formatDuration(
            Math.abs(metricsWithNew.remaining)
          )}. Would you like to extend the parent task duration from ${formatDuration(
            parentTaskDuration
          )} to ${formatDuration(newParentDuration)}?`,
          variant: "default",
          confirmText: "Extend & Add",
          cancelText: "Cancel",
        });

        if (!confirmed) {
          toast.error(
            "Subtask not added. Please reduce the subtask duration or extend the parent task duration."
          );
          return;
        }

        // Update parent task duration
        try {
          const updateResponse = await fetch(`/api/tasks/${parentTaskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ duration: newParentDuration }),
          });

          if (!updateResponse.ok) {
            toast.error("Failed to update parent task duration");
            return;
          }

          // Update local state
          setParentTaskDuration(newParentDuration);
        } catch (error) {
          console.error("Error updating parent task duration:", error);
          toast.error("Failed to update parent task duration");
          return;
        }
      }
    }

    setIsAdding(true);
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setFormData({
          title: "",
          duration: undefined,
          priority: 3,
          energy_level_required: 3,
        });
        setShowAddForm(false);
        await fetchSubtasks();
        await fetchParentTask(); // Refresh parent task to get updated duration
        onSubtaskChange?.();
        toast.success("Subtask added successfully");
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.error || "Failed to add subtask");
      }
    } catch (error) {
      console.error("Error adding subtask:", error);
      toast.error("Failed to add subtask");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleSubtask = async (subtask: Task) => {
    const newStatus = subtask.status === "completed" ? "pending" : "completed";
    setTogglingSubtaskId(subtask.id);
    try {
      const response = await fetch(`/api/tasks/${subtask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        await fetchSubtasks();
        await fetchParentTask(); // Refresh parent task duration
        onSubtaskChange?.();
      }
    } catch (error) {
      console.error("Error toggling subtask:", error);
    } finally {
      setTogglingSubtaskId(null);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    const confirmed = await confirm({
      title: "Delete Subtask",
      description: "Are you sure you want to delete this subtask?",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) return;

    setDeletingSubtaskId(subtaskId);
    try {
      const response = await fetch(`/api/tasks/${subtaskId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchSubtasks();
        await fetchParentTask(); // Refresh parent task duration
        onSubtaskChange?.();
        toast.success("Subtask deleted successfully");
      } else {
        toast.error("Failed to delete subtask");
      }
    } catch (error) {
      console.error("Error deleting subtask:", error);
      toast.error("Failed to delete subtask");
    } finally {
      setDeletingSubtaskId(null);
    }
  };

  const completedCount = subtasks.filter((st) => st.status === "completed").length;
  const totalCount = subtasks.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const durationMetrics = calculateDurationMetrics();

  const durationDisplay = (
    <>
      {parentTaskDuration !== null && (
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              Used: {formatDuration(durationMetrics.used)}
              {durationMetrics.total !== null &&
                ` / Total: ${formatDuration(durationMetrics.total)}`}
            </span>
          </div>
          {durationMetrics.remaining !== null && (
            <span
              className={
                durationMetrics.remaining < 0
                  ? "text-destructive font-medium"
                  : durationMetrics.total !== null &&
                      durationMetrics.remaining < durationMetrics.total * 0.1
                    ? "text-yellow-600 font-medium"
                    : "text-muted-foreground"
              }
            >
              {durationMetrics.remaining < 0
                ? `Over by ${formatDuration(Math.abs(durationMetrics.remaining))}`
                : `Remaining: ${formatDuration(durationMetrics.remaining)}`}
            </span>
          )}
        </div>
      )}
      {parentTaskDuration === null && subtasks.length > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>Used: {formatDuration(durationMetrics.used)} (No parent duration set)</span>
        </div>
      )}
    </>
  );

  const content = (
    <>
      {!noCard && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Subtasks</CardTitle>
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {completedCount}/{totalCount} ({progressPercentage}%)
              </span>
            )}
          </div>
          {totalCount > 0 && (
            <div className="w-full bg-secondary rounded-full h-1.5 mt-2">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          )}
          <div className="mt-2">{durationDisplay}</div>
        </CardHeader>
      )}
      <CardContent className={noCard ? "p-0 space-y-3" : "space-y-3"}>
        {noCard && (parentTaskDuration !== null || subtasks.length > 0) && (
          <div className="pb-2 border-b">{durationDisplay}</div>
        )}
        {/* Subtask List */}
        {subtasks.length > 0 && (
          <div className="space-y-2">
            {subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className={`flex items-center gap-2 p-2 rounded-md border ${
                  subtask.status === "completed"
                    ? "bg-muted/50 border-muted"
                    : "bg-background border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => !readOnly && handleToggleSubtask(subtask)}
                  disabled={readOnly || togglingSubtaskId === subtask.id}
                  className="flex-shrink-0 hover:opacity-70 disabled:cursor-not-allowed relative"
                >
                  {togglingSubtaskId === subtask.id ? (
                    <LoadingSpinner size="sm" className="h-5 w-5" />
                  ) : subtask.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={`flex-1 text-sm ${
                    subtask.status === "completed" ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {subtask.title}
                </span>
                {subtask.duration && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(subtask.duration)}
                  </span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteSubtask(subtask.id)}
                    disabled={deletingSubtaskId === subtask.id}
                    className="flex-shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    {deletingSubtaskId === subtask.id ? (
                      <LoadingSpinner size="sm" className="h-4 w-4" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Subtask Form */}
        {!readOnly &&
          (showAddForm ? (
            <form onSubmit={handleAddSubtask} className="space-y-3 pt-2 border-t">
              <div>
                <Input
                  placeholder="Subtask title..."
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Time
                  </Label>
                  <Input
                    type="number"
                    placeholder="mins"
                    min="1"
                    value={formData.duration || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        duration: e.target.value ? parseInt(e.target.value, 10) : undefined,
                      })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Priority</Label>
                  <Select
                    value={formData.priority.toString()}
                    onValueChange={(v) => setFormData({ ...formData, priority: parseInt(v, 10) })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    Energy
                  </Label>
                  <Select
                    value={formData.energy_level_required.toString()}
                    onValueChange={(v) =>
                      setFormData({ ...formData, energy_level_required: parseInt(v, 10) })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ENERGY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isAdding || !formData.title.trim()}
                  className="flex-1"
                >
                  {isAdding ? "Adding..." : "Add"}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Subtask
            </Button>
          ))}

        {subtasks.length === 0 && !showAddForm && (
          <p className="text-sm text-muted-foreground text-center py-2">No subtasks yet</p>
        )}
      </CardContent>
    </>
  );

  // Reserve space during loading to prevent layout shift
  if (isLoading) {
    if (noCard) {
      return <div className="text-sm text-muted-foreground py-2">Loading subtasks...</div>;
    }
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Subtasks</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground py-2">Loading subtasks...</div>
        </CardContent>
      </Card>
    );
  }

  if (noCard) {
    return <div className="space-y-3">{content}</div>;
  }

  return <Card>{content}</Card>;
}
