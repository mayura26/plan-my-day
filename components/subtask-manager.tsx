"use client";

import { CheckCircle2, Circle, Clock, Plus, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { ENERGY_LABELS, formatDuration, PRIORITY_LABELS } from "@/lib/task-utils";
import type { Task } from "@/lib/types";

interface SubtaskManagerProps {
  parentTaskId: string;
  onSubtaskChange?: () => void;
  readOnly?: boolean;
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
}: SubtaskManagerProps) {
  const { confirm } = useConfirmDialog();
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<SubtaskFormData>({
    title: "",
    duration: undefined,
    priority: 3,
    energy_level_required: 3,
  });

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
    fetchSubtasks();
  }, [fetchSubtasks]);

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

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
        onSubtaskChange?.();
        toast.success("Subtask added successfully");
      } else {
        toast.error("Failed to add subtask");
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
    try {
      const response = await fetch(`/api/tasks/${subtask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        await fetchSubtasks();
        onSubtaskChange?.();
      }
    } catch (error) {
      console.error("Error toggling subtask:", error);
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

    try {
      const response = await fetch(`/api/tasks/${subtaskId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchSubtasks();
        onSubtaskChange?.();
        toast.success("Subtask deleted successfully");
      } else {
        toast.error("Failed to delete subtask");
      }
    } catch (error) {
      console.error("Error deleting subtask:", error);
      toast.error("Failed to delete subtask");
    }
  };

  const completedCount = subtasks.filter((st) => st.status === "completed").length;
  const totalCount = subtasks.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Reserve space during loading to prevent layout shift
  if (isLoading) {
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

  return (
    <Card>
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
      </CardHeader>
      <CardContent className="space-y-3">
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
                  disabled={readOnly}
                  className="flex-shrink-0 hover:opacity-70 disabled:cursor-not-allowed"
                >
                  {subtask.status === "completed" ? (
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
                    className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Subtask Form */}
        {!readOnly && (
          <>
            {showAddForm ? (
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
            )}
          </>
        )}

        {subtasks.length === 0 && !showAddForm && (
          <p className="text-sm text-muted-foreground text-center py-2">No subtasks yet</p>
        )}
      </CardContent>
    </Card>
  );
}
