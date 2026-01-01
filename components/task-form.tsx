"use client";

import { Calendar, Clock, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { DependencySelector } from "@/components/dependency-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { ENERGY_LABELS, PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/task-utils";
import {
  createDateInTimezone,
  formatDateTimeLocalForTimezone,
  getDateInTimezone,
  parseDateTimeLocalToUTC,
} from "@/lib/timezone-utils";
import type { CreateTaskRequest, TaskGroup, TaskType } from "@/lib/types";

interface TaskFormProps {
  onSubmit: (task: CreateTaskRequest) => Promise<void>;
  onCancel?: () => void;
  initialData?: Partial<CreateTaskRequest> & { id?: string };
  isLoading?: boolean;
}

export function TaskForm({ onSubmit, onCancel, initialData, isLoading = false }: TaskFormProps) {
  const { timezone } = useUserTimezone();

  const [formData, setFormData] = useState<CreateTaskRequest>({
    title: initialData?.title || "",
    description: initialData?.description || "",
    priority: initialData?.priority || 3,
    duration: initialData?.duration || undefined,
    task_type: initialData?.task_type || "task",
    energy_level_required: initialData?.energy_level_required || 3,
    group_id: initialData?.group_id || undefined,
    template_id: initialData?.template_id || undefined,
    depends_on_task_id: initialData?.depends_on_task_id || undefined,
    dependency_ids: initialData?.dependency_ids || [],
    scheduled_start: formatDateTimeLocalForTimezone(initialData?.scheduled_start, timezone),
    scheduled_end: formatDateTimeLocalForTimezone(initialData?.scheduled_end, timezone),
    due_date: formatDateTimeLocalForTimezone(initialData?.due_date, timezone),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [showDescription, setShowDescription] = useState(!!initialData?.description);
  const [showDependencies, setShowDependencies] = useState(
    (initialData?.dependency_ids?.length ?? 0) > 0
  );

  // Fetch task groups
  useEffect(() => {
    const fetchTaskGroups = async () => {
      try {
        const response = await fetch("/api/task-groups");
        if (response.ok) {
          const data = await response.json();
          setTaskGroups(data.groups || []);
        }
      } catch (error) {
        console.error("Error fetching task groups:", error);
      }
    };
    fetchTaskGroups();
  }, []);

  // Fetch existing dependencies when editing a task
  useEffect(() => {
    const fetchDependencies = async () => {
      if (initialData?.id) {
        try {
          const response = await fetch(`/api/tasks/${initialData.id}/dependencies`);
          if (response.ok) {
            const data = await response.json();
            const depIds = (data.dependencies || []).map((d: any) => d.depends_on_task_id);
            if (depIds.length > 0) {
              setFormData((prev) => ({ ...prev, dependency_ids: depIds }));
              setShowDependencies(true);
            }
          }
        } catch (error) {
          console.error("Error fetching dependencies:", error);
        }
      }
    };
    fetchDependencies();
  }, [initialData?.id]);

  // Update form data when initialData or timezone changes (for edit mode)
  useEffect(() => {
    if (initialData?.title) {
      setFormData((prev) => ({
        ...prev,
        title: initialData.title || "",
        description: initialData.description || "",
        priority: initialData.priority || 3,
        duration: initialData.duration || undefined,
        task_type: initialData.task_type || "task",
        energy_level_required: initialData.energy_level_required || 3,
        group_id: initialData.group_id || undefined,
        template_id: initialData.template_id || undefined,
        depends_on_task_id: initialData.depends_on_task_id || undefined,
        scheduled_start: formatDateTimeLocalForTimezone(initialData.scheduled_start, timezone),
        scheduled_end: formatDateTimeLocalForTimezone(initialData.scheduled_end, timezone),
        due_date: formatDateTimeLocalForTimezone(initialData.due_date, timezone),
      }));
      setShowDescription(!!initialData.description);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, timezone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    }

    if (formData.task_type === "task") {
      if (formData.priority && (formData.priority < 1 || formData.priority > 5)) {
        newErrors.priority = "Priority must be between 1 and 5";
      }
      if (
        formData.energy_level_required &&
        (formData.energy_level_required < 1 || formData.energy_level_required > 5)
      ) {
        newErrors.energy_level_required = "Energy level must be between 1 and 5";
      }
      if (formData.duration && formData.duration < 0) {
        newErrors.duration = "Duration must be positive";
      }
    }

    if (formData.task_type === "event") {
      if (!formData.scheduled_start) {
        newErrors.scheduled_start = "Start time required";
      }
      if (!formData.scheduled_end) {
        newErrors.scheduled_end = "End time required";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      const submissionData = { ...formData };
      if (submissionData.scheduled_start) {
        submissionData.scheduled_start = parseDateTimeLocalToUTC(
          submissionData.scheduled_start,
          timezone
        );
      }
      if (submissionData.scheduled_end) {
        submissionData.scheduled_end = parseDateTimeLocalToUTC(
          submissionData.scheduled_end,
          timezone
        );
      }
      if (submissionData.due_date) {
        submissionData.due_date = parseDateTimeLocalToUTC(submissionData.due_date, timezone);
      }

      // If editing, update dependencies separately
      if (initialData?.id && formData.dependency_ids) {
        await fetch(`/api/tasks/${initialData.id}/dependencies`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dependency_ids: formData.dependency_ids }),
        });
      }

      await onSubmit(submissionData);
    } catch (error) {
      console.error("Error submitting task:", error);
    }
  };

  const calculateEndTime = (startTime: string, duration: number): string | null => {
    try {
      const match = startTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
      if (match) {
        const [, year, month, day, hours, minutes] = match;
        const startDate = new Date(+year, +month - 1, +day, +hours, +minutes);
        const endDate = new Date(startDate.getTime() + duration * 60000);
        return `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
      }
    } catch (error) {
      console.error("Error calculating end time:", error);
    }
    return null;
  };

  const handleInputChange = (field: keyof CreateTaskRequest, value: any) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === "task_type") {
        if (value === "event") {
          updated.priority = undefined;
          updated.energy_level_required = undefined;
          updated.due_date = undefined;
        } else if (value === "todo") {
          updated.energy_level_required = undefined;
          if (!updated.priority) updated.priority = 3;
        } else {
          if (!updated.priority) updated.priority = 3;
          if (!updated.energy_level_required) updated.energy_level_required = 3;
        }
      }

      if (field === "scheduled_start" || field === "duration") {
        const startTime = field === "scheduled_start" ? value : prev.scheduled_start;
        const duration = field === "duration" ? value : prev.duration;
        if (startTime && duration) {
          const newEndTime = calculateEndTime(startTime, duration);
          if (newEndTime) updated.scheduled_end = newEndTime;
        }
      }

      if (field === "due_date") {
        // When user selects a date, default to 5pm (17:00) in their timezone
        // If the previous value was empty or the time is midnight (00:00), set to 5pm
        if (value && typeof value === "string") {
          const datetimePattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
          const match = value.match(datetimePattern);
          if (match) {
            const [, datePart, hours, minutes] = match;
            // If this is a new due date (was empty) or time is 00:00 (midnight), default to 5pm (17:00)
            const wasEmpty = !prev.due_date;
            const isMidnight = hours === "00" && minutes === "00";
            if (wasEmpty || isMidnight) {
              updated.due_date = `${datePart}T17:00`;
            } else {
              // User has specified a different time, keep it as is
              updated.due_date = value;
            }
          } else {
            // Fallback: if format doesn't match, use as-is
            updated.due_date = value;
          }
        } else {
          updated.due_date = value;
        }
      }

      return updated;
    });

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const isEvent = formData.task_type === "event";
  const isTodo = formData.task_type === "todo";
  const isTask = formData.task_type === "task";

  const showPriority = isTask || isTodo;
  const showEnergy = isTask;
  const showDuration = isTask || isTodo;
  const showDueDate = isTask || isTodo;
  const showDependencyOption = isTask; // Only tasks can have dependencies

  const getTypeLabel = () => {
    switch (formData.task_type) {
      case "event":
        return "Event";
      case "todo":
        return "To-Do";
      default:
        return "Task";
    }
  };

  const handleDueDateFocus = () => {
    // If due_date is empty, initialize it to today at 5pm in user's timezone
    if (!formData.due_date) {
      const today = new Date();
      const todayInTimezone = getDateInTimezone(today, timezone);
      const dateAt5pm = createDateInTimezone(todayInTimezone, 17, 0, timezone);
      const formattedDate = formatDateTimeLocalForTimezone(dateAt5pm.toISOString(), timezone);
      handleInputChange("due_date", formattedDate);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Header with Type Selector */}
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span className="text-muted-foreground">{initialData ? "Edit" : "New"}</span>
        <Select
          value={formData.task_type}
          onValueChange={(value) => handleInputChange("task_type", value as TaskType)}
        >
          <SelectTrigger className="h-8 w-auto gap-1 border-none bg-transparent p-0 font-semibold text-lg hover:bg-accent/50 focus:ring-0 focus:ring-offset-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="task">{TASK_TYPE_LABELS.task}</SelectItem>
            <SelectItem value="todo">{TASK_TYPE_LABELS.todo}</SelectItem>
            <SelectItem value="event">{TASK_TYPE_LABELS.event}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Title - Full width, prominent */}
      <div className="space-y-1.5">
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => handleInputChange("title", e.target.value)}
          placeholder={`${getTypeLabel()} title...`}
          className={`h-12 text-base font-medium ${errors.title ? "border-red-500" : ""}`}
          autoFocus
        />
        {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
      </div>

      {/* Description toggle */}
      {!showDescription ? (
        <button
          type="button"
          onClick={() => setShowDescription(true)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add description
        </button>
      ) : (
        <Textarea
          id="description"
          value={formData.description || ""}
          onChange={(e) => handleInputChange("description", e.target.value)}
          placeholder="Add details..."
          rows={2}
          className="min-h-[60px] text-sm resize-none"
        />
      )}

      {/* Priority & Group Row */}
      <div className="grid grid-cols-2 gap-3">
        {showPriority && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Priority</Label>
            <Select
              value={formData.priority?.toString() || "3"}
              onValueChange={(value) => handleInputChange("priority", parseInt(value, 10))}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {taskGroups.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Group</Label>
            <Select
              value={formData.group_id || "no-group"}
              onValueChange={(value) =>
                handleInputChange("group_id", value === "no-group" ? undefined : value)
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-group">None</SelectItem>
                {taskGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      {group.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Duration & Energy Row */}
      {(showDuration || showEnergy) && (
        <div className="grid grid-cols-2 gap-3">
          {showDuration && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Est. Time
              </Label>
              <Input
                id="duration"
                type="number"
                value={formData.duration || ""}
                onChange={(e) =>
                  handleInputChange(
                    "duration",
                    e.target.value ? parseInt(e.target.value, 10) : undefined
                  )
                }
                placeholder="mins"
                min="1"
                className="h-10"
              />
            </div>
          )}

          {showEnergy && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Energy Level
              </Label>
              <Select
                value={formData.energy_level_required?.toString() || "3"}
                onValueChange={(value) =>
                  handleInputChange("energy_level_required", parseInt(value, 10))
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ENERGY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Due Date */}
      {showDueDate && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Due Date
          </Label>
          <Input
            id="due_date"
            type="datetime-local"
            value={formData.due_date || ""}
            onChange={(e) => handleInputChange("due_date", e.target.value)}
            onFocus={handleDueDateFocus}
            className="h-10"
          />
        </div>
      )}

      {/* Dependencies Section */}
      {showDependencyOption &&
        (!showDependencies ? (
          <button
            type="button"
            onClick={() => setShowDependencies(true)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add dependencies
          </button>
        ) : (
          <DependencySelector
            taskId={initialData?.id}
            selectedIds={formData.dependency_ids || []}
            onChange={(ids) => handleInputChange("dependency_ids", ids)}
          />
        ))}

      {/* Schedule Section */}
      <div className="pt-3 border-t space-y-3">
        <Label className="text-xs text-muted-foreground">
          {isEvent ? "Event Time *" : "Schedule"}
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Start</span>
            <Input
              id="scheduled_start"
              type="datetime-local"
              value={formData.scheduled_start || ""}
              onChange={(e) => handleInputChange("scheduled_start", e.target.value)}
              className={`h-10 text-sm ${errors.scheduled_start ? "border-red-500" : ""}`}
            />
            {errors.scheduled_start && (
              <p className="text-xs text-red-500">{errors.scheduled_start}</p>
            )}
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">End</span>
            <Input
              id="scheduled_end"
              type="datetime-local"
              value={formData.scheduled_end || ""}
              onChange={(e) => handleInputChange("scheduled_end", e.target.value)}
              className={`h-10 text-sm ${errors.scheduled_end ? "border-red-500" : ""}`}
            />
            {errors.scheduled_end && <p className="text-xs text-red-500">{errors.scheduled_end}</p>}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 h-11"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isLoading}
          className={`h-11 ${onCancel ? "flex-1" : "w-full"}`}
        >
          {isLoading
            ? "Saving..."
            : initialData
              ? `Update ${getTypeLabel()}`
              : `Create ${getTypeLabel()}`}
        </Button>
      </div>
    </form>
  );
}
