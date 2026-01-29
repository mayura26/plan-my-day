"use client";

import { format } from "date-fns";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Magnet,
  RotateCcw,
  ScrollText,
  Shuffle,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SchedulerOperation =
  | "shuffle"
  | "pull-forward"
  | "auto-schedule-group"
  | "schedule-now"
  | "schedule-today"
  | "schedule-tomorrow"
  | "schedule-next-week"
  | "schedule-next-month"
  | "schedule-asap"
  | "schedule-due-date"
  | "reschedule"
  | "carryover";

export interface SchedulerLogEntry {
  id: string;
  timestamp: Date;
  operation: SchedulerOperation;
  targetDate: string;
  feedback: string[];
  movedCount: number;
  success: boolean;
  taskName?: string;
}

interface SchedulerLogPanelProps {
  entries: SchedulerLogEntry[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClear: () => void;
}

const operationConfig: Record<
  SchedulerOperation,
  { label: string; icon: typeof Shuffle; color: string }
> = {
  shuffle: {
    label: "Shuffle",
    icon: Shuffle,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  "pull-forward": {
    label: "Pull Forward",
    icon: Magnet,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  "auto-schedule-group": {
    label: "Auto Schedule",
    icon: Zap,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  "schedule-now": {
    label: "Now",
    icon: CalendarClock,
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  "schedule-today": {
    label: "Today",
    icon: CalendarClock,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  "schedule-tomorrow": {
    label: "Tomorrow",
    icon: CalendarClock,
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  "schedule-next-week": {
    label: "Next Week",
    icon: CalendarClock,
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  "schedule-next-month": {
    label: "Next Month",
    icon: CalendarClock,
    color: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  "schedule-asap": {
    label: "ASAP",
    icon: Zap,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  "schedule-due-date": {
    label: "Due Date",
    icon: CalendarClock,
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  reschedule: {
    label: "Reschedule",
    icon: CalendarClock,
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
  carryover: {
    label: "Carryover",
    icon: RotateCcw,
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
};

export function SchedulerLogPanel({
  entries,
  isExpanded,
  onToggleExpand,
  onClear,
}: SchedulerLogPanelProps) {
  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-accent/50 transition-colors py-2 px-3"
        onClick={onToggleExpand}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <CardTitle className="text-sm flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              Scheduler Log
            </CardTitle>
            {entries.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem]">
                {entries.length}
              </Badge>
            )}
          </div>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title="Clear log"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="px-2 pb-2 pt-0">
          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                No scheduler activity yet
              </p>
            ) : (
              entries.map((entry) => {
                const config = operationConfig[entry.operation];
                const Icon = config.icon;
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-md border px-2.5 py-2 text-xs space-y-1",
                      entry.success
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-muted bg-muted/30"
                    )}
                  >
                    {/* Header row: time + operation badge + date */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-muted-foreground font-mono text-[10px]">
                        {format(entry.timestamp, "HH:mm:ss")}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px] px-1.5 py-0 h-4 gap-0.5", config.color)}
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {config.label}
                      </Badge>
                      {entry.taskName ? (
                        <span
                          className="text-foreground text-[10px] font-medium truncate max-w-[120px]"
                          title={entry.taskName}
                        >
                          {entry.taskName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">
                          {entry.targetDate}
                        </span>
                      )}
                      {entry.success && (
                        <span className="text-green-600 dark:text-green-400 font-medium ml-auto">
                          {entry.movedCount} moved
                        </span>
                      )}
                    </div>
                    {/* Feedback lines */}
                    {entry.feedback.length > 0 && (
                      <div className="text-muted-foreground text-[11px] leading-relaxed space-y-0.5">
                        {entry.feedback.map((line, i) => (
                          <div key={`${entry.id}-${i}`} className="break-words">
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
