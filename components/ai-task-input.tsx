"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TaskGroup } from "@/lib/types";
import type { CreateTaskRequestWithSubtasks } from "./task-form";

interface AITaskInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onParsed: (data: Partial<CreateTaskRequestWithSubtasks>) => void;
  groups?: TaskGroup[];
}

const EXAMPLES = [
  "Team meeting tomorrow at 2pm for 1 hour, high priority",
  "Submit quarterly report by Friday, 2 hours, urgent",
  "Quick email reply to client, low energy needed",
];

export function AITaskInput({ open, onOpenChange, onParsed, groups = [] }: AITaskInputProps) {
  const [text, setText] = useState("");
  const [generateSubtasks, setGenerateSubtasks] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setText("");
      setParseError(null);
      setPartialWarning(null);
      setIsParsing(false);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const handleParse = async () => {
    if (!text.trim() || isParsing) return;

    setIsParsing(true);
    setParseError(null);
    setPartialWarning(null);

    try {
      const response = await fetch("/api/ai/parse-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          groups: groups.map((g) => ({ id: g.id, name: g.name })),
          generate_subtasks: generateSubtasks,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setParseError(data.error || "Failed to parse task");
        return;
      }

      if (!data.parsed?.title) {
        setParseError("Could not extract a task title. Please be more specific.");
        return;
      }

      if (data.confidence === "partial" && data.unparsed_hints?.length) {
        setPartialWarning(data.unparsed_hints);
      }

      // API already returns dates in datetime-local format for the user's timezone
      onParsed(data.parsed);
      onOpenChange(false);
    } catch {
      setParseError("Network error. Please check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter alone submits; Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto w-[95vw] md:w-full mx-2 md:mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Add Task with AI
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your task in plain English..."
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isParsing}
            />
          </div>

          {/* Generate subtasks option */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="generate-subtasks"
              checked={generateSubtasks}
              onCheckedChange={(checked) => setGenerateSubtasks(checked === true)}
              disabled={isParsing}
            />
            <label htmlFor="generate-subtasks" className="text-sm cursor-pointer select-none">
              Generate subtasks
            </label>
          </div>

          {/* Example hints */}
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Examples:</p>
            {EXAMPLES.map((ex) => (
              <p
                key={ex}
                className="cursor-pointer hover:text-foreground transition-colors"
                onClick={() => setText(ex)}
              >
                • {ex}
              </p>
            ))}
            <p className="mt-1 opacity-70">Press Enter to parse · Shift+Enter for new line</p>
          </div>

          {/* Error */}
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}

          {/* Partial warning */}
          {partialWarning && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Could not extract: {partialWarning.join(", ")}. You can fill these in the form.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isParsing}>
              Cancel
            </Button>
            <Button onClick={handleParse} disabled={!text.trim() || isParsing}>
              {isParsing ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Parsing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Parse with AI
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
