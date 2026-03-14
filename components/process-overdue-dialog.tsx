"use client";

import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  RotateCcw,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SchedulerLogEntry } from "@/components/scheduler-log-panel";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { getOverdueTasks } from "@/lib/task-utils";
import {
  formatDateInTimezone,
  formatDateTimeLocalForTimezone,
  parseDateTimeLocalToUTC,
} from "@/lib/timezone-utils";
import type { SchedulingMode, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProcessOverdueDialogProps {
  tasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksUpdated: () => void;
  onTaskUpdate?: (taskId: string, updatedTask: Task) => void;
  onSchedulerLog?: (entry: Omit<SchedulerLogEntry, "id" | "timestamp">) => void;
}

type MissedScheduleAction = "carryover" | "reschedule" | "complete";
type OverdueDeadlineAction = "extend-due-date" | "schedule" | "complete" | "ignore";

interface TaskDecision {
  action: MissedScheduleAction | OverdueDeadlineAction;
  scheduleMode?: SchedulingMode;
  carryoverDuration?: number;
  carryoverNotes?: string;
  newDueDate?: string;
}

const SCHEDULE_MODE_LABELS: Record<SchedulingMode, string> = {
  now: "Schedule Now",
  today: "Later Today",
  tomorrow: "Tomorrow",
  "next-week": "Next Week",
  "next-month": "Next Month",
  asap: "ASAP",
  "due-date": "By Due Date",
  smart: "Smart",
};

const MODE_TO_ENDPOINT: Record<SchedulingMode, string> = {
  now: "schedule-now",
  today: "schedule-today",
  tomorrow: "schedule-tomorrow",
  "next-week": "schedule-next-week",
  "next-month": "schedule-next-month",
  asap: "schedule-asap",
  "due-date": "schedule-due-date",
  smart: "schedule-smart",
};

type DecisionMap = Record<string, TaskDecision>;

function partitionOverdueTasks(tasks: Task[]) {
  const now = new Date();
  const groupA: Task[] = [];
  const groupB: Task[] = [];
  for (const task of tasks) {
    if (task.scheduled_end && new Date(task.scheduled_end) < now) {
      groupA.push(task);
    } else {
      groupB.push(task);
    }
  }
  return { groupA, groupB };
}

export function ProcessOverdueDialog({
  tasks,
  open,
  onOpenChange,
  onTasksUpdated,
  onTaskUpdate: _onTaskUpdate,
  onSchedulerLog,
}: ProcessOverdueDialogProps) {
  const { timezone } = useUserTimezone();
  const { confirm } = useConfirmDialog();
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const overdueTasks = getOverdueTasks(tasks);
  const { groupA, groupB } = useMemo(() => partitionOverdueTasks(overdueTasks), [overdueTasks]);
  const resolvedCount = Object.keys(decisions).length;
  const canApply = resolvedCount > 0 && !isApplying;

  const setDecision = (taskId: string, decision: TaskDecision) => {
    setDecisions((prev) => ({ ...prev, [taskId]: decision }));
  };

  const clearDecision = (taskId: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const updateDecision = (taskId: string, updates: Partial<TaskDecision>) => {
    setDecisions((prev) => {
      const existing = prev[taskId];
      if (!existing) return prev;
      return { ...prev, [taskId]: { ...existing, ...updates } };
    });
  };

  const executeDecision = async (task: Task, decision: TaskDecision) => {
    const { action } = decision;

    if (action === "carryover") {
      const duration = decision.carryoverDuration ?? task.duration ?? 30;

      let response = await fetch(`/api/tasks/${task.id}/carryover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          additional_duration: duration,
          notes: decision.carryoverNotes,
          auto_schedule: true,
        }),
      });

      if (!response.ok && task.task_type === "subtask") {
        const errorData = await response.json();
        if (errorData.error?.includes("exceeds parent task duration")) {
          const confirmed = await confirm({
            title: "Expand Parent Task Duration?",
            description: `Creating this carryover subtask requires expanding the parent task duration from ${errorData.parent_duration} min to ${errorData.total_with_carryover} min (an increase of ${errorData.required_extension} min). Do you want to proceed?`,
            confirmText: "Expand & Create",
            cancelText: "Cancel",
            variant: "default",
          });

          if (!confirmed) {
            throw new Error(`Carryover cancelled for "${task.title}"`);
          }

          response = await fetch(`/api/tasks/${task.id}/carryover`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              additional_duration: duration,
              notes: decision.carryoverNotes,
              auto_schedule: true,
              extend_parent_duration: true,
            }),
          });
        }
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to process "${task.title}"`);
      }

      const carryoverData = await response.json();
      onSchedulerLog?.({
        operation: "carryover",
        targetDate: "",
        feedback: [carryoverData.message || `Carryover created for "${task.title}"`],
        movedCount: 1,
        success: true,
        taskName: task.title,
      });
    } else if (action === "reschedule" || action === "schedule") {
      const mode: SchedulingMode = decision.scheduleMode ?? "asap";
      const endpoint = MODE_TO_ENDPOINT[mode];
      const res = await fetch(`/api/tasks/${task.id}/${endpoint}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to reschedule "${task.title}"`);
      }
      const resData = await res.json();
      onSchedulerLog?.({
        operation: endpoint as SchedulerLogEntry["operation"],
        targetDate: "",
        feedback: resData.feedback || [],
        movedCount: resData.shuffledTasks?.length || 0,
        success: true,
        taskName: task.title,
      });
    } else if (action === "complete") {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to complete "${task.title}"`);
      }
    } else if (action === "extend-due-date") {
      if (!decision.newDueDate) {
        throw new Error(`No due date provided for "${task.title}"`);
      }
      const utcDate = parseDateTimeLocalToUTC(decision.newDueDate, timezone);
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_date: utcDate }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to update due date for "${task.title}"`);
      }
    } else if (action === "ignore") {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignored: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ignore "${task.title}"`);
      }
    }
  };

  const handleApplyAll = async () => {
    // Pre-apply validation
    const validationErrors: string[] = [];
    for (const [taskId, decision] of Object.entries(decisions)) {
      const task = overdueTasks.find((t) => t.id === taskId);
      if (!task) continue;
      if (decision.action === "carryover" && (decision.carryoverDuration ?? 30) <= 0) {
        validationErrors.push(`"${task.title}": carryover duration must be > 0`);
      }
      if (decision.action === "extend-due-date") {
        if (!decision.newDueDate) {
          validationErrors.push(`"${task.title}": new due date is required`);
        } else if (new Date(decision.newDueDate) <= new Date()) {
          validationErrors.push(`"${task.title}": new due date must be in the future`);
        }
      }
    }
    if (validationErrors.length > 0) {
      setApplyError(validationErrors.join(" · "));
      return;
    }

    setIsApplying(true);
    setApplyError(null);
    const errors: string[] = [];

    for (const [taskId, decision] of Object.entries(decisions)) {
      const task = overdueTasks.find((t) => t.id === taskId);
      if (!task) continue;
      try {
        await executeDecision(task, decision);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed: "${task.title}"`);
      }
    }

    setIsApplying(false);
    if (errors.length > 0) {
      setApplyError(errors.join(" · "));
    } else {
      setDecisions({});
      onTasksUpdated();
      onOpenChange(false);
    }
  };

  if (overdueTasks.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>No Overdue Tasks</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">All tasks are up to date!</p>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        {/* Sticky header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Review Overdue Tasks ({overdueTasks.length})
          </DialogTitle>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {resolvedCount} of {overdueTasks.length} resolved
              </span>
              <span>{Math.round((resolvedCount / overdueTasks.length) * 100)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(resolvedCount / overdueTasks.length) * 100}%` }}
              />
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable task list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4 space-y-6">
            {groupA.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Missed Schedule ({groupA.length})
                  </h3>
                </div>
                {groupA.map((task) => (
                  <GroupACard
                    key={task.id}
                    task={task}
                    tasks={tasks}
                    decision={decisions[task.id]}
                    timezone={timezone}
                    onDecisionChange={(d) => setDecision(task.id, d)}
                    onDecisionUpdate={(u) => updateDecision(task.id, u)}
                    onDecisionClear={() => clearDecision(task.id)}
                  />
                ))}
              </section>
            )}

            {groupB.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Overdue Deadline ({groupB.length})
                  </h3>
                </div>
                {groupB.map((task) => (
                  <GroupBCard
                    key={task.id}
                    task={task}
                    tasks={tasks}
                    decision={decisions[task.id]}
                    timezone={timezone}
                    onDecisionChange={(d) => setDecision(task.id, d)}
                    onDecisionUpdate={(u) => updateDecision(task.id, u)}
                    onDecisionClear={() => clearDecision(task.id)}
                  />
                ))}
              </section>
            )}

            {applyError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                {applyError}
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button onClick={handleApplyAll} disabled={!canApply}>
            {isApplying ? "Applying…" : `Apply All (${resolvedCount} resolved)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Group A Card (Missed Schedule) ───────────────────────────────────────────

interface GroupACardProps {
  task: Task;
  tasks: Task[];
  decision: TaskDecision | undefined;
  timezone: string;
  onDecisionChange: (d: TaskDecision) => void;
  onDecisionUpdate: (u: Partial<TaskDecision>) => void;
  onDecisionClear: () => void;
}

function GroupACard({
  task,
  tasks,
  decision,
  timezone,
  onDecisionChange,
  onDecisionUpdate,
  onDecisionClear,
}: GroupACardProps) {
  const isResolved = !!decision;
  const selectedAction = decision?.action as MissedScheduleAction | undefined;

  const selectAction = (action: MissedScheduleAction) => {
    if (selectedAction === action) {
      onDecisionClear();
      return;
    }
    if (action === "carryover") {
      onDecisionChange({
        action,
        carryoverDuration: task.duration ?? 30,
        carryoverNotes: "",
      });
    } else if (action === "reschedule") {
      onDecisionChange({ action, scheduleMode: decision?.scheduleMode ?? "asap" });
    } else {
      onDecisionChange({ action });
    }
  };

  const parentTask = task.parent_task_id ? tasks.find((t) => t.id === task.parent_task_id) : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3 border-l-4 transition-colors",
        isResolved ? "border-l-primary bg-primary/5" : "border-l-amber-400"
      )}
    >
      <TaskCardHeader
        task={task}
        parentTask={parentTask ?? null}
        timezone={timezone}
        groupLabel="Missed Schedule"
      />

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <ActionButton
          active={selectedAction === "carryover"}
          onClick={() => selectAction("carryover")}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="Carryover"
        />
        <ActionButton
          active={selectedAction === "reschedule"}
          onClick={() => selectAction("reschedule")}
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Reschedule"
        />
        <ActionButton
          active={selectedAction === "complete"}
          onClick={() => selectAction("complete")}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Complete"
        />
      </div>

      {/* Reschedule mode dropdown */}
      {selectedAction === "reschedule" && (
        <div className="pt-1 space-y-1">
          <Label className="text-xs">Schedule mode</Label>
          <ScheduleModeSelect
            value={decision?.scheduleMode ?? "asap"}
            onChange={(mode) => onDecisionUpdate({ scheduleMode: mode })}
          />
        </div>
      )}

      {/* Carryover extra fields */}
      {selectedAction === "carryover" && (
        <div className="flex items-end gap-3 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Duration (min)</Label>
            <Input
              type="number"
              min={1}
              className="w-24 h-8 text-sm"
              value={decision?.carryoverDuration ?? task.duration ?? 30}
              onChange={(e) => onDecisionUpdate({ carryoverDuration: Number(e.target.value) })}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Input
              className="h-8 text-sm"
              placeholder="Optional notes…"
              value={decision?.carryoverNotes ?? ""}
              onChange={(e) => onDecisionUpdate({ carryoverNotes: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Group B Card (Overdue Deadline) ──────────────────────────────────────────

interface GroupBCardProps {
  task: Task;
  tasks: Task[];
  decision: TaskDecision | undefined;
  timezone: string;
  onDecisionChange: (d: TaskDecision) => void;
  onDecisionUpdate: (u: Partial<TaskDecision>) => void;
  onDecisionClear: () => void;
}

function GroupBCard({
  task,
  tasks,
  decision,
  timezone,
  onDecisionChange,
  onDecisionUpdate,
  onDecisionClear,
}: GroupBCardProps) {
  const isResolved = !!decision;
  const selectedAction = decision?.action as OverdueDeadlineAction | undefined;

  const selectAction = (action: OverdueDeadlineAction) => {
    if (selectedAction === action) {
      onDecisionClear();
      return;
    }
    if (action === "extend-due-date") {
      onDecisionChange({ action, newDueDate: "" });
    } else if (action === "schedule") {
      onDecisionChange({ action, scheduleMode: decision?.scheduleMode ?? "asap" });
    } else {
      onDecisionChange({ action });
    }
  };

  const applyQuickExtend = (offsetMs: number) => {
    const base = task.due_date ? new Date(task.due_date) : new Date();
    const newDate = new Date(base.getTime() + offsetMs);
    onDecisionUpdate({
      newDueDate: formatDateTimeLocalForTimezone(newDate.toISOString(), timezone),
    });
  };

  const parentTask = task.parent_task_id ? tasks.find((t) => t.id === task.parent_task_id) : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3 border-l-4 transition-colors",
        isResolved ? "border-l-primary bg-primary/5" : "border-l-amber-400"
      )}
    >
      <TaskCardHeader
        task={task}
        parentTask={parentTask ?? null}
        timezone={timezone}
        groupLabel="Overdue Deadline"
      />

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <ActionButton
          active={selectedAction === "extend-due-date"}
          onClick={() => selectAction("extend-due-date")}
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Extend Due Date"
        />
        <ActionButton
          active={selectedAction === "schedule"}
          onClick={() => selectAction("schedule")}
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Schedule"
        />
        <ActionButton
          active={selectedAction === "complete"}
          onClick={() => selectAction("complete")}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Complete"
        />
        <ActionButton
          active={selectedAction === "ignore"}
          onClick={() => selectAction("ignore")}
          label="Ignore"
        />
      </div>

      {/* Schedule mode dropdown */}
      {selectedAction === "schedule" && (
        <div className="pt-1 space-y-1">
          <Label className="text-xs">Schedule mode</Label>
          <ScheduleModeSelect
            value={decision?.scheduleMode ?? "asap"}
            onChange={(mode) => onDecisionUpdate({ scheduleMode: mode })}
          />
        </div>
      )}

      {/* Extend due date */}
      {selectedAction === "extend-due-date" && (
        <div className="pt-1 space-y-2">
          {task.due_date && (
            <p className="text-xs text-muted-foreground">
              Current deadline:{" "}
              <span className="font-medium text-foreground">
                {formatDateInTimezone(task.due_date, timezone, DATE_FORMAT)}
              </span>
            </p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { label: "+1d", ms: 86_400_000 },
              { label: "+3d", ms: 3 * 86_400_000 },
              { label: "+1w", ms: 7 * 86_400_000 },
              { label: "+2w", ms: 14 * 86_400_000 },
              { label: "+1mo", ms: 30 * 86_400_000 },
            ].map(({ label, ms }) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => applyQuickExtend(ms)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Or pick a date</Label>
            <Input
              type="datetime-local"
              className="h-8 text-sm w-auto"
              value={decision?.newDueDate ?? ""}
              onChange={(e) => onDecisionUpdate({ newDueDate: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

interface TaskCardHeaderProps {
  task: Task;
  parentTask: Task | null;
  timezone: string;
  groupLabel: string;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function TaskCardHeader({ task, parentTask, timezone, groupLabel }: TaskCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{task.title}</p>
        {parentTask && (
          <p className="text-xs text-muted-foreground italic mt-0.5">↳ {parentTask.title}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          {task.duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.duration} min
            </span>
          )}
          {task.scheduled_end && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Scheduled end: {formatDateInTimezone(task.scheduled_end, timezone, DATE_FORMAT)}
            </span>
          )}
          {task.due_date && !task.scheduled_end && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Due: {formatDateInTimezone(task.due_date, timezone, DATE_FORMAT)}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
        {groupLabel}
      </span>
    </div>
  );
}

interface ActionButtonProps {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}

function ActionButton({ active, onClick, icon, label }: ActionButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-7 text-xs gap-1.5"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

interface ScheduleModeSelectProps {
  value: SchedulingMode;
  onChange: (mode: SchedulingMode) => void;
}

function ScheduleModeSelect({ value, onChange }: ScheduleModeSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SchedulingMode)}>
      <SelectTrigger className="h-8 text-sm w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(SCHEDULE_MODE_LABELS) as [SchedulingMode, string][]).map(
          ([mode, label]) => (
            <SelectItem key={mode} value={mode}>
              {label}
            </SelectItem>
          )
        )}
      </SelectContent>
    </Select>
  );
}
