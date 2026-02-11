"use client";

import {
  Calendar,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Plus,
  Trash2,
  Unlock,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DependencySelector } from "@/components/dependency-selector";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { ENERGY_LABELS, generateTaskId, PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/task-utils";
import {
  createDateInTimezone,
  type DueDatePreset,
  formatDateTimeLocalForTimezone,
  getDateInTimezone,
  getDueDatePresetDateTimeLocal,
  getDueDatePresetTooltip,
  parseDateTimeLocalToUTC,
} from "@/lib/timezone-utils";
import type { CreateTaskRequest, TaskGroup, TaskType } from "@/lib/types";

/** Form-only: optional subtasks and initial notes (todos) when creating a task. */
export type CreateTaskRequestWithSubtasks = CreateTaskRequest & {
  subtasks?: Array<{ title: string; duration?: number }>;
  /** Note texts to create as task todos (same "Notes" as in task detail). */
  initial_notes?: string[];
};

interface TaskFormProps {
  onSubmit: (task: CreateTaskRequestWithSubtasks) => Promise<void>;
  onCancel?: () => void;
  initialData?: Partial<CreateTaskRequest> & { id?: string };
  isLoading?: boolean;
  taskGroups?: TaskGroup[];
}

export function TaskForm({
  onSubmit,
  onCancel,
  initialData,
  isLoading = false,
  taskGroups: propTaskGroups,
}: TaskFormProps) {
  const { timezone } = useUserTimezone();

  // Use prop groups if provided, otherwise fall back to empty array for backward compatibility
  const taskGroups = propTaskGroups ?? [];

  const initialTaskType = initialData?.task_type || "task";
  const [formData, setFormData] = useState<CreateTaskRequest>({
    title: initialData?.title || "",
    description: initialData?.description || "",
    priority: initialData?.priority || 3,
    duration: initialData?.duration || (initialTaskType === "todo" ? 30 : undefined),
    task_type: initialTaskType,
    energy_level_required: initialData?.energy_level_required || 3,
    group_id: initialData?.group_id || undefined,
    template_id: initialData?.template_id || undefined,
    depends_on_task_id: initialData?.depends_on_task_id || undefined,
    dependency_ids: initialData?.dependency_ids || [],
    scheduled_start: formatDateTimeLocalForTimezone(initialData?.scheduled_start, timezone),
    scheduled_end: formatDateTimeLocalForTimezone(initialData?.scheduled_end, timezone),
    due_date: formatDateTimeLocalForTimezone(initialData?.due_date, timezone),
    auto_schedule: initialData?.auto_schedule || false,
    schedule_mode: (initialData as any)?.schedule_mode || "now",
    locked:
      initialData?.locked !== undefined
        ? initialData.locked
        : initialTaskType === "event" || initialTaskType === "todo",
  } as CreateTaskRequest & { schedule_mode?: string });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDependencies, setShowDependencies] = useState(
    (initialData?.dependency_ids?.length ?? 0) > 0
  );
  const [hasTriedSubmitWithoutDueDate, setHasTriedSubmitWithoutDueDate] = useState(false);
  const [subtaskDrafts, setSubtaskDrafts] = useState<
    Array<{ id: string; title: string; duration?: number }>
  >([]);
  const [initialNoteTexts, setInitialNoteTexts] = useState<Array<{ id: string; text: string }>>([]);
  const [showExtraInfo, setShowExtraInfo] = useState(!!initialData?.description);
  const titleInputRef = useRef<HTMLInputElement>(null);

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

  // Focus title input when form is first rendered (for new tasks)
  useEffect(() => {
    if (!initialData?.id && titleInputRef.current) {
      // Small delay to ensure dialog animation completes
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [initialData?.id]);

  // Update form data when initialData or timezone changes (for edit mode)
  useEffect(() => {
    if (initialData?.title) {
      const taskType = initialData.task_type || "task";
      setFormData((prev) => ({
        ...prev,
        title: initialData.title || "",
        description: initialData.description || "",
        priority: initialData.priority || 3,
        duration: initialData.duration || (taskType === "todo" ? 30 : undefined),
        task_type: taskType,
        energy_level_required: initialData.energy_level_required || 3,
        group_id: initialData.group_id || undefined,
        template_id: initialData.template_id || undefined,
        depends_on_task_id: initialData.depends_on_task_id || undefined,
        scheduled_start: formatDateTimeLocalForTimezone(initialData.scheduled_start, timezone),
        scheduled_end: formatDateTimeLocalForTimezone(initialData.scheduled_end, timezone),
        due_date: formatDateTimeLocalForTimezone(initialData.due_date, timezone),
        auto_schedule: initialData.auto_schedule || false,
        locked:
          initialData.locked !== undefined
            ? initialData.locked
            : taskType === "event" || taskType === "todo",
      }));
      setShowExtraInfo(!!initialData.description);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, timezone]);

  // Focus title input when form is first rendered (for new tasks)
  useEffect(() => {
    if (!initialData?.id && titleInputRef.current) {
      // Small delay to ensure dialog animation completes
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [initialData?.id]);

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
        newErrors.scheduled_start = "Start time is required for events";
      }
      if (!formData.scheduled_end) {
        newErrors.scheduled_end = "End time is required for events";
      }
      // Prevent submission if scheduling is missing
      if (!formData.scheduled_start || !formData.scheduled_end) {
        // Errors already added above, just ensure we return early
      }
    }

    // Handle todo due date requirement with smart auto-fill
    let autoSetDueDate: string | undefined;
    if (formData.task_type === "todo") {
      if (!formData.due_date) {
        if (hasTriedSubmitWithoutDueDate) {
          // Second attempt: auto-set due date to today at 5pm (or tomorrow if after 5pm)
          const now = new Date();
          const nowInTimezone = getDateInTimezone(now, timezone);
          const currentHour = nowInTimezone.getHours();

          let targetDate = nowInTimezone;
          if (currentHour >= 17) {
            // After 5pm, set to tomorrow
            targetDate = new Date(nowInTimezone);
            targetDate.setDate(targetDate.getDate() + 1);
          }

          const dateAt5pm = createDateInTimezone(targetDate, 17, 0, timezone);
          autoSetDueDate = formatDateTimeLocalForTimezone(dateAt5pm.toISOString(), timezone);
          // Update form data for UI
          setFormData((prev) => ({ ...prev, due_date: autoSetDueDate }));
          // Clear the error and flag
          setHasTriedSubmitWithoutDueDate(false);
          setErrors((prev) => ({ ...prev, due_date: "" }));
        } else {
          // First attempt: show error message
          newErrors.due_date = "Due date is required for todos";
          setHasTriedSubmitWithoutDueDate(true);
        }
      } else {
        // Due date is set, reset the flag
        setHasTriedSubmitWithoutDueDate(false);
      }
      if (formData.duration && formData.duration < 0) {
        newErrors.duration = "Duration must be positive";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      const submissionData = { ...formData };
      // Use auto-set due date if it was calculated
      if (autoSetDueDate) {
        submissionData.due_date = autoSetDueDate;
      }
      // Remove energy_level_required for todos (not used)
      if (submissionData.task_type === "todo") {
        submissionData.energy_level_required = undefined;
      }
      // Only include schedule_mode if auto_schedule is enabled
      if (!submissionData.auto_schedule) {
        (submissionData as any).schedule_mode = undefined;
      }
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

      // Include optional subtasks and initial notes (todos) when creating a task/todo
      const payload: CreateTaskRequestWithSubtasks = { ...submissionData };
      const validSubtasks = subtaskDrafts.filter((s) => s.title.trim());
      if (validSubtasks.length > 0) {
        payload.subtasks = validSubtasks.map((s) => ({
          title: s.title.trim(),
          duration: s.duration ?? 30,
        }));
      }
      const validNotes = initialNoteTexts.map((n) => n.text.trim()).filter(Boolean);
      if (validNotes.length > 0) {
        payload.initial_notes = validNotes;
      }
      await onSubmit(payload);
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
          updated.locked = true;
        } else if (value === "todo") {
          updated.energy_level_required = undefined;
          if (!updated.priority) updated.priority = 3;
          // Set default duration to 30 minutes for todos if not already set
          if (!updated.duration) updated.duration = 30;
          // Reset the flag when switching to todo type
          setHasTriedSubmitWithoutDueDate(false);
          updated.locked = false;
        } else {
          if (!updated.priority) updated.priority = 3;
          if (!updated.energy_level_required) updated.energy_level_required = 3;
          updated.locked = false;
        }
      }

      if (field === "scheduled_start" || field === "duration") {
        const startTime = field === "scheduled_start" ? value : prev.scheduled_start;
        const duration = field === "duration" ? value : prev.duration;
        if (startTime && duration) {
          const newEndTime = calculateEndTime(startTime, duration);
          if (newEndTime) updated.scheduled_end = newEndTime;
        }
        // If manual times are set, disable auto-schedule
        if (field === "scheduled_start" && value) {
          updated.auto_schedule = false;
        }
      }

      if (field === "scheduled_end" && value) {
        // If manual end time is set, disable auto-schedule
        updated.auto_schedule = false;
      }

      if (field === "auto_schedule" && value) {
        // If auto-schedule is enabled, clear manual scheduled times
        updated.scheduled_start = undefined;
        updated.scheduled_end = undefined;
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
          ref={titleInputRef}
          id="title"
          value={formData.title}
          onChange={(e) => handleInputChange("title", e.target.value)}
          placeholder={`${getTypeLabel()} title...`}
          className={`h-12 text-base font-medium ${errors.title ? "border-red-500" : ""}`}
          autoFocus
        />
        {errors.title && <p className="text-xs text-red-500">{errors.title}</p>}
      </div>

      {/* Extra Info - one collapsible: description, notes, subtasks (folded by default) */}
      {!showExtraInfo ? (
        <button
          type="button"
          onClick={() => setShowExtraInfo(true)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4 shrink-0" />
          Extra Info
        </button>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowExtraInfo(false)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="h-4 w-4 shrink-0" />
            Extra Info
          </button>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="description"
              value={formData.description || ""}
              onChange={(e) => handleInputChange("description", e.target.value)}
              placeholder="Add task details..."
              rows={2}
              className="min-h-[60px] text-sm resize-none"
            />
          </div>

          {/* Notes - create only, tick-box list when you open the task */}
          {!initialData?.id && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <p className="text-xs text-muted-foreground">Tick-box list when you open the task.</p>
              <div className="space-y-2">
                {initialNoteTexts.map((note) => (
                  <div key={note.id} className="flex gap-2 items-center">
                    <Input
                      value={note.text}
                      onChange={(e) =>
                        setInitialNoteTexts((prev) =>
                          prev.map((n) => (n.id === note.id ? { ...n, text: e.target.value } : n))
                        )
                      }
                      placeholder="Note item"
                      className="flex-1 h-10 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setInitialNoteTexts((prev) => prev.filter((n) => n.id !== note.id))
                      }
                      aria-label="Remove note"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() =>
                    setInitialNoteTexts((prev) => [...prev, { id: generateTaskId(), text: "" }])
                  }
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add note
                </Button>
              </div>
            </div>
          )}

          {/* Subtasks - create only, task/todo only */}
          {!initialData?.id && (formData.task_type === "task" || formData.task_type === "todo") && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Subtasks</Label>
              <div className="space-y-2">
                {subtaskDrafts.map((subtask) => (
                  <div key={subtask.id} className="flex gap-2 items-start">
                    <Input
                      value={subtask.title}
                      onChange={(e) =>
                        setSubtaskDrafts((prev) =>
                          prev.map((s) =>
                            s.id === subtask.id ? { ...s, title: e.target.value } : s
                          )
                        )
                      }
                      placeholder="Subtask title"
                      className="flex-1 h-10 text-sm"
                    />
                    <Input
                      type="number"
                      value={subtask.duration ?? 30}
                      onChange={(e) =>
                        setSubtaskDrafts((prev) =>
                          prev.map((s) =>
                            s.id === subtask.id
                              ? {
                                  ...s,
                                  duration: e.target.value
                                    ? parseInt(e.target.value, 10)
                                    : undefined,
                                }
                              : s
                          )
                        )
                      }
                      placeholder="mins"
                      min={1}
                      className="w-20 h-10 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setSubtaskDrafts((prev) => prev.filter((s) => s.id !== subtask.id))
                      }
                      aria-label="Remove subtask"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() =>
                    setSubtaskDrafts((prev) => [
                      ...prev,
                      { id: generateTaskId(), title: "", duration: 30 },
                    ])
                  }
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add subtask
                </Button>
              </div>
            </div>
          )}
        </div>
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
                {taskGroups
                  .filter((group) => !group.is_parent_group) // Only show regular groups, not parent groups
                  .map((group) => (
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
            {isTodo && <span className="text-red-500 ml-1">*</span>}
          </Label>
          <Input
            id="due_date"
            type="datetime-local"
            value={formData.due_date || ""}
            onChange={(e) => handleInputChange("due_date", e.target.value)}
            onFocus={handleDueDateFocus}
            className={`h-10 ${errors.due_date ? "border-red-500" : ""}`}
            placeholder={isTodo ? "Required for todos" : undefined}
          />
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { preset: "today" as DueDatePreset, label: "TDY" },
                { preset: "tomorrow" as DueDatePreset, label: "TMRW" },
                { preset: "eow" as DueDatePreset, label: "EOW" },
                { preset: "next-eow" as DueDatePreset, label: "Next EOW" },
                { preset: "eom" as DueDatePreset, label: "EOM" },
                { preset: "next-eom" as DueDatePreset, label: "Next EOM" },
              ] as const
            ).map(({ preset, label }) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                title={getDueDatePresetTooltip(preset, timezone)}
                onClick={() => {
                  const value = getDueDatePresetDateTimeLocal(preset, timezone);
                  handleInputChange("due_date", value);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {errors.due_date && <p className="text-xs text-red-500">{errors.due_date}</p>}
          {isTodo && !formData.due_date && !errors.due_date && (
            <p className="text-xs text-muted-foreground">Due date is required for todos</p>
          )}
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
            groupId={formData.group_id}
            selectedIds={formData.dependency_ids || []}
            onChange={(ids) => handleInputChange("dependency_ids", ids)}
          />
        ))}

      {/* Schedule Section */}
      <div className="pt-3 border-t space-y-3">
        <Label className="text-xs text-muted-foreground">
          {isEvent ? "Event Time *" : "Schedule"}
        </Label>
        {(isTask || isTodo) && (
          <div className="space-y-2 pb-2">
            <div className="flex items-center gap-2">
              <Switch
                id="auto_schedule"
                checked={formData.auto_schedule || false}
                onCheckedChange={(checked) => handleInputChange("auto_schedule", checked)}
                disabled={
                  !!(formData.scheduled_start || formData.scheduled_end) ||
                  (formData.task_type !== "task" && formData.task_type !== "todo")
                }
              />
              <Label
                htmlFor="auto_schedule"
                className="text-sm font-normal cursor-pointer flex items-center gap-1.5 flex-1"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Auto-schedule</span>
              </Label>
              {formData.auto_schedule && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={
                        !!(formData.scheduled_start || formData.scheduled_end) ||
                        (formData.task_type !== "task" && formData.task_type !== "todo")
                      }
                    >
                      {(() => {
                        const mode = (formData as any).schedule_mode || "now";
                        const labels: Record<string, string> = {
                          now: "Schedule Now",
                          today: "Schedule Today",
                          tomorrow: "Schedule Tomorrow",
                          "next-week": "Schedule Next Week",
                          "next-month": "Schedule Next Month",
                          asap: "Schedule ASAP",
                          "due-date": "Schedule to Due Date",
                        };
                        return labels[mode] || "Schedule Now";
                      })()}
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => handleInputChange("schedule_mode", "now")}>
                      <Clock className="h-4 w-4 mr-2" />
                      Schedule Now
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleInputChange("schedule_mode", "today")}>
                      <CalendarClock className="h-4 w-4 mr-2" />
                      Schedule Today
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleInputChange("schedule_mode", "tomorrow")}
                    >
                      <CalendarClock className="h-4 w-4 mr-2" />
                      Schedule Tomorrow
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleInputChange("schedule_mode", "next-week")}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      Schedule Next Week
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleInputChange("schedule_mode", "next-month")}
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      Schedule Next Month
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleInputChange("schedule_mode", "asap")}>
                      <Zap className="h-4 w-4 mr-2" />
                      Schedule ASAP
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        formData.due_date && handleInputChange("schedule_mode", "due-date")
                      }
                      disabled={!formData.due_date}
                      title={!formData.due_date ? "Set a due date first" : undefined}
                    >
                      <CalendarClock className="h-4 w-4 mr-2" />
                      Schedule to Due Date
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        )}
        {(isTask || isTodo) && formData.auto_schedule && !formData.duration && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Note: Auto-schedule requires a duration to be set.
          </p>
        )}
        {(isTask || isTodo) &&
          (formData.scheduled_start || formData.scheduled_end) &&
          formData.auto_schedule && (
            <p className="text-xs text-muted-foreground">
              Manual times are set. Auto-schedule is disabled.
            </p>
          )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Start{isEvent && <span className="text-red-500 ml-1">*</span>}
            </span>
            <Input
              id="scheduled_start"
              type="datetime-local"
              value={formData.scheduled_start || ""}
              onChange={(e) => handleInputChange("scheduled_start", e.target.value)}
              className={`h-10 text-sm ${errors.scheduled_start ? "border-red-500" : ""}`}
              required={isEvent}
            />
            {errors.scheduled_start && (
              <p className="text-xs text-red-500">{errors.scheduled_start}</p>
            )}
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">
              End{isEvent && <span className="text-red-500 ml-1">*</span>}
            </span>
            <Input
              id="scheduled_end"
              type="datetime-local"
              value={formData.scheduled_end || ""}
              onChange={(e) => handleInputChange("scheduled_end", e.target.value)}
              className={`h-10 text-sm ${errors.scheduled_end ? "border-red-500" : ""}`}
              required={isEvent}
            />
            {errors.scheduled_end && <p className="text-xs text-red-500">{errors.scheduled_end}</p>}
          </div>
        </div>
      </div>

      {/* Lock Toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="locked"
          checked={formData.locked || false}
          onCheckedChange={(checked) => handleInputChange("locked", checked)}
        />
        <Label
          htmlFor="locked"
          className="text-sm font-normal cursor-pointer flex items-center gap-1.5"
        >
          {formData.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          <span>{formData.locked ? "Locked" : "Unlocked"}</span>
        </Label>
        <span className="text-xs text-muted-foreground ml-auto">
          {formData.locked ? "Won\u0027t be moved by shuffle" : "Will be moved by shuffle"}
        </span>
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
          loading={isLoading}
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
