"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { DayNote } from "@/lib/types";

interface DayNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  note: DayNote | null;
  onSave: (date: Date, content: string) => Promise<void>;
}

export function DayNoteDialog({ open, onOpenChange, date, note, onSave }: DayNoteDialogProps) {
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset content when dialog opens/closes or note changes
  useEffect(() => {
    if (open) {
      setContent(note?.content || "");
    } else {
      setContent("");
    }
  }, [open, note]);

  const handleSave = async () => {
    if (!content.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(date, content.trim());
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving day note:", error);
      // Error handling - could show toast here
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSaving) {
      onOpenChange(newOpen);
    }
  };

  // Format date for display
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{note ? "Edit Note" : "Add Note"}</DialogTitle>
          <DialogDescription>{dateStr}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="note-content" className="text-sm font-medium">
              Note
            </label>
            <Textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add your plans and notes for this day..."
              className="min-h-[150px] resize-none"
              disabled={isSaving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !content.trim()}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
