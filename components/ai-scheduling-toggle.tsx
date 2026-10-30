"use client";

import { CalendarCheck2, CalendarX2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AISchedulingToggle({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const enabled = !task.locked;
  const label = `AI scheduling ${enabled ? "on" : "off"}. Click to ${enabled ? "exclude" : "include"} this task.${task.locked ? " This will unlock the task." : " This will lock the task in place."}`;
  const Icon = saving ? Loader2 : enabled ? CalendarCheck2 : CalendarX2;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      disabled={saving}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        if (saving) return;
        setSaving(true);
        try {
          await onUpdate(task.id, { locked: enabled });
        } catch {
          toast.error("Could not update AI scheduling. Please try again.");
        } finally {
          setSaving(false);
        }
      }}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-muted bg-muted/50 text-muted-foreground hover:bg-muted"
      )}
    >
      <Icon aria-hidden="true" className={cn("h-4 w-4", saving && "animate-spin")} />
    </button>
  );
}
