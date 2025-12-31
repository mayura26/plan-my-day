"use client";

import { AlertCircle, CheckCircle2, Clock, RotateCcw } from "lucide-react";
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
import { formatDuration } from "@/lib/task-utils";
import type { Task } from "@/lib/types";

interface TaskCompletionCheckDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkComplete: (taskId: string) => Promise<void>;
  onCreateCarryover: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
}

export function TaskCompletionCheckDialog({
  task,
  open,
  onOpenChange,
  onMarkComplete,
  onCreateCarryover,
  onDismiss,
}: TaskCompletionCheckDialogProps) {
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  if (!task) return null;

  const handleMarkComplete = async () => {
    setIsMarkingComplete(true);
    try {
      await onMarkComplete(task.id);
      onOpenChange(false);
    } catch (error) {
      console.error("Error marking task complete:", error);
    } finally {
      setIsMarkingComplete(false);
    }
  };

  const handleCreateCarryover = () => {
    onCreateCarryover(task.id);
    onOpenChange(false);
  };

  const handleDismiss = () => {
    onDismiss(task.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Task Time Ended
          </DialogTitle>
          <DialogDescription>
            The scheduled time for this task has ended. Did you complete it?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Task Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium">{task.title}</h4>
            {task.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
            )}
            {task.duration && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Estimated: {formatDuration(task.duration)}</span>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="space-y-3">
            <Button
              onClick={handleMarkComplete}
              disabled={isMarkingComplete}
              className="w-full justify-start"
              variant="default"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {isMarkingComplete ? "Marking complete..." : "Yes, mark as complete"}
            </Button>

            <Button
              onClick={handleCreateCarryover}
              className="w-full justify-start"
              variant="outline"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              No, I need more time (create carryover)
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleDismiss} className="w-full sm:w-auto">
            Remind me later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


