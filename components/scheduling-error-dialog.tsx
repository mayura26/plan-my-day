"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle } from "lucide-react";

interface SchedulingErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string;
  feedback?: string[];
}

export function SchedulingErrorDialog({
  open,
  onOpenChange,
  error,
  feedback = [],
}: SchedulingErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <DialogTitle>Scheduling Failed</DialogTitle>
          </div>
          <DialogDescription className="pt-2">{error}</DialogDescription>
        </DialogHeader>
        {feedback.length > 0 && (
          <div className="py-4">
            <h4 className="text-sm font-medium mb-2">Details:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              {feedback.map((msg, index) => (
                <li key={index}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

