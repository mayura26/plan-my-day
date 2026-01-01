"use client";

import { Clock, Link2, RotateCcw } from "lucide-react";
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
import { formatDuration } from "@/lib/task-utils";
import type { Task } from "@/lib/types";

interface CarryoverTaskDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCarryoverCreated: (carryoverTask: Task, originalTask: Task) => void;
}

export function CarryoverTaskDialog({
  task,
  open,
  onOpenChange,
  onCarryoverCreated,
}: CarryoverTaskDialogProps) {
  const [additionalDuration, setAdditionalDuration] = useState<number>(task?.duration || 30);
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens with new task
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && task) {
      setAdditionalDuration(task.duration || 30);
      setNotes("");
      setError(null);
    }
    onOpenChange(isOpen);
  };

  if (!task) return null;

  const handleCreateCarryover = async () => {
    if (!additionalDuration || additionalDuration <= 0) {
      setError("Please enter a valid duration");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${task.id}/carryover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          additional_duration: additionalDuration,
          notes: notes.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create carryover task");
      }

      const data = await response.json();
      onCarryoverCreated(data.carryover_task, data.original_task);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create carryover task");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-blue-500" />
            Create Carryover Task
          </DialogTitle>
          <DialogDescription>
            Create a new task to continue the remaining work from "{task.title}".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Original Task Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Original task:</span>
            </div>
            <h4 className="font-medium">{task.title}</h4>
            {task.duration && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Original estimate: {formatDuration(task.duration)}</span>
              </div>
            )}
          </div>

          {/* Additional Duration Input */}
          <div className="space-y-2">
            <Label htmlFor="additional-duration" className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Additional time needed (minutes)
            </Label>
            <Input
              id="additional-duration"
              type="number"
              min="1"
              value={additionalDuration}
              onChange={(e) => setAdditionalDuration(parseInt(e.target.value, 10) || 0)}
              placeholder="30"
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              The carryover task will be created with this duration
            </p>
          </div>

          {/* Notes Input */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What's left to do? Any notes for the carryover task..."
              rows={3}
              className="resize-none"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">{error}</div>
          )}

          {/* What will happen */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 space-y-1">
            <p className="font-medium">What will happen:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>A new task "{task.title} (continued)" will be created</li>
              <li>It will inherit priority, energy level, and group</li>
              <li>The original task will be marked as cancelled</li>
              <li>You can schedule the new task whenever you like</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateCarryover}
            disabled={isCreating || !additionalDuration || additionalDuration <= 0}
            className="w-full sm:w-auto"
          >
            {isCreating ? (
              "Creating..."
            ) : (
              <>
                <RotateCcw className="h-4 w-4 mr-2" />
                Create Carryover
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
