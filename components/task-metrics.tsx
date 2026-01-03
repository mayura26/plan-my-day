"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Clock, PlayCircle, Star } from "lucide-react";
import { useState } from "react";
import { RefreshButton } from "@/components/refresh-button";
import { SlimTaskCard } from "@/components/slim-task-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getHighPriorityUnscheduledTasks,
  getInProgressTasks,
  getOverdueTasks,
  getUpcomingSoonTasks,
} from "@/lib/task-utils";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export type MetricType = "overdue" | "upcoming" | "in_progress" | "high_priority_unscheduled";

interface TaskMetricsProps {
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  onProcessOverdue?: () => void;
  onRefresh?: () => void | Promise<void>;
  className?: string;
}

interface MetricSectionProps {
  icon: React.ReactNode;
  label: string;
  tasks: Task[];
  colorClass: string;
  isExpanded: boolean;
  onToggle: () => void;
  onTaskClick?: (taskId: string) => void;
  actionButton?: React.ReactNode;
}

function MetricSection({
  icon,
  label,
  tasks,
  colorClass,
  isExpanded,
  onToggle,
  onTaskClick,
  actionButton,
}: MetricSectionProps) {
  const count = tasks.length;

  return (
    <div className="border-b last:border-b-0">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Conditionally interactive element based on count */}
      <div
        role={count > 0 ? "button" : undefined}
        tabIndex={count > 0 ? 0 : undefined}
        className={cn(
          "flex items-center justify-between py-2 px-2 rounded-md transition-colors",
          count > 0 && "cursor-pointer hover:bg-accent/50"
        )}
        onClick={count > 0 ? onToggle : undefined}
        onKeyDown={
          count > 0
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
      >
        <div className="flex items-center gap-2 flex-1">
          <span className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className={cn("flex-shrink-0", colorClass)}>{icon}</span>
          <span className="text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {actionButton}
          <span
            className={cn(
              "font-semibold text-sm",
              count > 0 ? colorClass : "text-muted-foreground"
            )}
          >
            {count}
          </span>
        </div>
      </div>

      {/* Expanded task list */}
      {isExpanded && count > 0 && (
        <div className="px-2 pb-2 space-y-1">
          {tasks.map((task) => (
            <SlimTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
          ))}
        </div>
      )}

      {isExpanded && count === 0 && (
        <div className="px-2 pb-2">
          <p className="text-xs text-muted-foreground text-center py-2">No tasks</p>
        </div>
      )}
    </div>
  );
}

export function TaskMetrics({ tasks, onTaskClick, onProcessOverdue, onRefresh, className }: TaskMetricsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<MetricType>>(new Set());

  const overdueTasks = getOverdueTasks(tasks);
  const upcomingSoonTasks = getUpcomingSoonTasks(tasks, 2);
  const inProgressTasks = getInProgressTasks(tasks);
  const highPriorityUnscheduledTasks = getHighPriorityUnscheduledTasks(tasks);

  const toggleSection = (section: MetricType) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const handleProcessOverdueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onProcessOverdue?.();
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Task Metrics</CardTitle>
          {onRefresh && (
            <RefreshButton
              onRefresh={onRefresh}
              size="sm"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Refresh task metrics"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="px-1 pb-2 pt-0">
        <MetricSection
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Overdue"
          tasks={overdueTasks}
          colorClass="text-red-600 dark:text-red-400"
          isExpanded={expandedSections.has("overdue")}
          onToggle={() => toggleSection("overdue")}
          onTaskClick={onTaskClick}
          actionButton={
            overdueTasks.length > 0 && onProcessOverdue ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={handleProcessOverdueClick}
              >
                Process
              </Button>
            ) : undefined
          }
        />
        <MetricSection
          icon={<Clock className="h-4 w-4" />}
          label="Upcoming Soon"
          tasks={upcomingSoonTasks}
          colorClass="text-orange-600 dark:text-orange-400"
          isExpanded={expandedSections.has("upcoming")}
          onToggle={() => toggleSection("upcoming")}
          onTaskClick={onTaskClick}
        />
        <MetricSection
          icon={<PlayCircle className="h-4 w-4" />}
          label="In Progress"
          tasks={inProgressTasks}
          colorClass="text-blue-600 dark:text-blue-400"
          isExpanded={expandedSections.has("in_progress")}
          onToggle={() => toggleSection("in_progress")}
          onTaskClick={onTaskClick}
        />
        <MetricSection
          icon={<Star className="h-4 w-4" />}
          label="High Priority"
          tasks={highPriorityUnscheduledTasks}
          colorClass="text-purple-600 dark:text-purple-400"
          isExpanded={expandedSections.has("high_priority_unscheduled")}
          onToggle={() => toggleSection("high_priority_unscheduled")}
          onTaskClick={onTaskClick}
        />
      </CardContent>
    </Card>
  );
}
