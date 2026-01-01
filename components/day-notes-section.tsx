"use client";

import { Edit2, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import type { DayNote } from "@/lib/types";

interface DayNotesSectionProps {
  note: DayNote;
  onUpdate: (content: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function DayNotesSection({ note, onUpdate, onDelete }: DayNotesSectionProps) {
  const { confirm } = useConfirmDialog();
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    if (content.trim() === note.content.trim()) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onUpdate(content.trim());
      setIsEditing(false);
      toast.success("Note updated successfully");
    } catch (error) {
      console.error("Error updating day note:", error);
      toast.error("Failed to update note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setContent(note.content);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Note",
      description: "Are you sure you want to delete this note?",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete();
      toast.success("Note deleted successfully");
    } catch (error) {
      console.error("Error deleting day note:", error);
      toast.error("Failed to delete note");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Notes</CardTitle>
          {!isEditing && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="h-7 px-2"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="h-7 px-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {isEditing && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
                className="h-7 px-2"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !content.trim()}
                className="h-7 px-2"
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isEditing ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[100px] resize-none"
            disabled={isSaving}
            autoFocus
          />
        ) : (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</div>
        )}
      </CardContent>
    </Card>
  );
}
