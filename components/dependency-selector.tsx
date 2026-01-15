"use client";

import { CheckCircle2, Circle, GitBranch, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Task } from "@/lib/types";

interface DependencySelectorProps {
  taskId?: string; // Current task ID (to exclude from options)
  groupId?: string | null; // Current task's group_id (to filter by same group)
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function DependencySelector({
  taskId,
  groupId,
  selectedIds,
  onChange,
  disabled = false,
}: DependencySelectorProps) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      // Build query params: exclude completed tasks, filter by group_id, and only parent tasks
      const params = new URLSearchParams();
      params.append("parent_only", "true");
      
      // Filter by group_id - if current task has a group, only show tasks in that group
      // If current task has no group (null), only show tasks with no group
      if (groupId !== undefined) {
        if (groupId !== null) {
          params.append("group_id", groupId);
        } else {
          // For null group_id, pass empty string to filter for tasks with no group
          params.append("group_id", "");
        }
      }
      
      // Exclude completed tasks - we'll filter these out
      // Note: We'll filter completed tasks client-side since API might not support status != 'completed'
      
      const response = await fetch(`/api/tasks?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        // Filter out: current task, subtasks, and completed tasks
        const availableTasks = (data.tasks || []).filter(
          (t: Task) =>
            t.id !== taskId &&
            t.task_type !== "subtask" &&
            !t.parent_task_id &&
            t.status !== "completed" &&
            // Handle group_id filtering: if groupId is null/undefined, show only tasks with no group
            // If groupId is set, show only tasks with matching group_id
            (groupId === undefined || groupId === null
              ? t.group_id === null || t.group_id === undefined
              : t.group_id === groupId)
        );
        setTasks(availableTasks);
      }
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, [taskId, groupId]);

  useEffect(() => {
    if (open) {
      fetchTasks();
    }
  }, [open, fetchTasks]);

  const handleSelect = (taskIdToToggle: string) => {
    if (selectedIds.includes(taskIdToToggle)) {
      onChange(selectedIds.filter((id) => id !== taskIdToToggle));
    } else {
      onChange([...selectedIds, taskIdToToggle]);
    }
  };

  const handleRemove = (taskIdToRemove: string) => {
    onChange(selectedIds.filter((id) => id !== taskIdToRemove));
  };

  const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id));

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        Dependencies (tasks that must be completed first)
      </Label>

      {/* Selected Dependencies */}
      {selectedTasks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTasks.map((task) => (
            <Badge key={task.id} variant="secondary" className="flex items-center gap-1 pr-1">
              {task.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
              <span className="max-w-[150px] truncate">{task.title}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(task.id)}
                  className="ml-1 rounded-full hover:bg-muted p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Dependency Picker */}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={disabled}
            >
              <GitBranch className="h-4 w-4 mr-2" />
              {selectedIds.length > 0
                ? `${selectedIds.length} dependenc${selectedIds.length === 1 ? "y" : "ies"} selected`
                : "Add dependencies..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search tasks..." />
              <CommandList>
                <CommandEmpty>{isLoading ? "Loading tasks..." : "No tasks found."}</CommandEmpty>
                <CommandGroup>
                  {tasks.map((task) => {
                    const isSelected = selectedIds.includes(task.id);
                    return (
                      <CommandItem
                        key={task.id}
                        value={task.title}
                        onSelect={() => handleSelect(task.id)}
                        className="flex items-center gap-2"
                      >
                        <div
                          className={`flex h-4 w-4 items-center justify-center rounded-sm border ${
                            isSelected
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground"
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="h-3 w-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{task.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {task.status === "completed" ? (
                              <span className="text-green-500">Completed</span>
                            ) : task.status === "in_progress" ? (
                              <span className="text-blue-500">In Progress</span>
                            ) : (
                              <span>Pending</span>
                            )}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {selectedIds.length === 0 && !disabled && (
        <p className="text-xs text-muted-foreground">
          No dependencies. This task can be started anytime.
        </p>
      )}
    </div>
  );
}
