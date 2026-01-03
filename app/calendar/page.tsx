"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { format, startOfMonth } from "date-fns";
import { CheckSquare, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarSkeleton } from "@/components/calendar-skeleton";
import { DayCalendar } from "@/components/day-calendar";
import { DayNoteDialog } from "@/components/day-note-dialog";
import { DayNotesSection } from "@/components/day-notes-section";
import { MonthCalendar } from "@/components/month-calendar";
import { ProcessOverdueDialog } from "@/components/process-overdue-dialog";
import { SlimTaskCard } from "@/components/slim-task-card";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { TaskForm } from "@/components/task-form";
import { RefreshButton } from "@/components/refresh-button";
import { TaskGroupManager } from "@/components/task-group-manager";
import { TaskMetrics } from "@/components/task-metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeeklyCalendar } from "@/components/weekly-calendar";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { sortTasksByCreatedTimeDesc } from "@/lib/task-utils";
import {
  createDateInTimezone,
  formatDateTimeLocalForTimezone,
  getDateInTimezone,
} from "@/lib/timezone-utils";
import type { CreateTaskRequest, DayNote, Task, TaskGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

type ViewMode = "day" | "week" | "month";

export default function CalendarPage() {
  const { data: session, status } = useSession();
  const { timezone, isLoading: timezoneLoading } = useUserTimezone();
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [_processingTaskId, setProcessingTaskId] = useState<string | null>(null);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["task-groups", "quick-stats", "unscheduled-tasks"])
  );
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [dayNotes, setDayNotes] = useState<Map<string, DayNote>>(new Map());
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteDialogDate, setNoteDialogDate] = useState<Date | null>(null);
  const [processOverdueOpen, setProcessOverdueOpen] = useState(false);
  const [quickAddInitialData, setQuickAddInitialData] = useState<Partial<CreateTaskRequest> | null>(
    null
  );
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    // Load from localStorage or default to 380px (wider for buttons to fit in one row)
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-width");
      return saved ? parseInt(saved, 10) : 380;
    }
    return 380;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [subtasksMap, setSubtasksMap] = useState<Map<string, Task[]>>(new Map());
  const fetchedGroupsUserIdRef = useRef<string | null>(null);
  const isFetchingGroupsRef = useRef<boolean>(false);
  const hasFetchedInitialDataRef = useRef<boolean>(false);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  );

  const fetchTasks = useCallback(async (setLoading = true) => {
    try {
      if (setLoading) {
        setIsLoading(true);
      }
      const response = await fetch("/api/tasks");
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
        // Clear subtasks map when tasks are refreshed to ensure fresh data
        setSubtasksMap(new Map());
      } else {
        console.error("Failed to fetch tasks");
      }
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      if (setLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetchingGroupsRef.current) {
      return;
    }
    isFetchingGroupsRef.current = true;
    try {
      const response = await fetch("/api/task-groups");
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      } else {
        console.error("Failed to fetch task groups");
      }
    } catch (error) {
      console.error("Error fetching task groups:", error);
    } finally {
      isFetchingGroupsRef.current = false;
    }
  }, []);

  const fetchSubtasks = useCallback(async (parentTaskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${parentTaskId}/subtasks`);
      if (response.ok) {
        const data = await response.json();
        const subtasks = data.subtasks || [];
        setSubtasksMap((prev) => {
          // Only update if we don't already have this data
          if (prev.has(parentTaskId)) {
            return prev;
          }
          const newMap = new Map(prev);
          newMap.set(parentTaskId, subtasks);
          return newMap;
        });
      }
    } catch (error) {
      console.error("Error fetching subtasks:", error);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }

    // Only fetch tasks and groups once authenticated AND timezone is loaded
    // Use a ref to ensure we only fetch once, even if the effect runs multiple times
    if (
      status === "authenticated" &&
      !timezoneLoading &&
      session?.user?.id &&
      !hasFetchedInitialDataRef.current
    ) {
      const currentUserId = session.user.id;

      hasFetchedInitialDataRef.current = true;

      // Fetch tasks
      fetchTasks();

      // Fetch groups only once per user
      if (fetchedGroupsUserIdRef.current !== currentUserId && !isFetchingGroupsRef.current) {
        fetchedGroupsUserIdRef.current = currentUserId;
        fetchGroups();
      }
    }

    // Reset the ref if user logs out (but only if we actually had data fetched)
    if (status !== "authenticated" && hasFetchedInitialDataRef.current) {
      hasFetchedInitialDataRef.current = false;
      fetchedGroupsUserIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status,
    timezoneLoading,
    fetchGroups, // Fetch tasks
    fetchTasks,
    router.push,
    session?.user?.id,
  ]);

  // Helper function to format date to YYYY-MM-DD in user's timezone
  const formatDateKey = useCallback(
    (date: Date): string => {
      const dateInTimezone = getDateInTimezone(date, timezone);
      return format(dateInTimezone, "yyyy-MM-dd");
    },
    [timezone]
  );

  // Fetch day note for a specific date
  const fetchDayNote = useCallback(
    async (date: Date) => {
      try {
        const dateKey = formatDateKey(date);
        const response = await fetch(`/api/day-notes?date=${dateKey}`);
        if (response.ok) {
          const data = await response.json();
          if (data.note === null) {
            // Note doesn't exist, remove from map
            setDayNotes((prev) => {
              const newMap = new Map(prev);
              newMap.delete(dateKey);
              return newMap;
            });
            return null;
          }
          setDayNotes((prev) => {
            const newMap = new Map(prev);
            newMap.set(dateKey, data.note);
            return newMap;
          });
          return data.note;
        }
      } catch (error) {
        console.error("Error fetching day note:", error);
      }
      return null;
    },
    [formatDateKey]
  );

  // Create or update day note
  const createOrUpdateDayNote = async (date: Date, content: string) => {
    const dateKey = formatDateKey(date);
    try {
      // Try to get existing note first
      const existingNote = dayNotes.get(dateKey);

      let response: Response;
      if (existingNote) {
        // Update existing note
        response = await fetch(`/api/day-notes?date=${dateKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      } else {
        // Create new note
        response = await fetch("/api/day-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note_date: dateKey, content }),
        });
      }

      if (response.ok) {
        const data = await response.json();
        setDayNotes((prev) => {
          const newMap = new Map(prev);
          newMap.set(dateKey, data.note);
          return newMap;
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save note");
      }
    } catch (error) {
      console.error("Error saving day note:", error);
      throw error;
    }
  };

  // Delete day note
  const deleteDayNote = async (date: Date) => {
    const dateKey = formatDateKey(date);
    try {
      const response = await fetch(`/api/day-notes?date=${dateKey}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setDayNotes((prev) => {
          const newMap = new Map(prev);
          newMap.delete(dateKey);
          return newMap;
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete note");
      }
    } catch (error) {
      console.error("Error deleting day note:", error);
      throw error;
    }
  };

  // Handle note icon click
  const handleNoteClick = (date: Date) => {
    setNoteDialogDate(date);
    setNoteDialogOpen(true);
  };

  // Fetch notes for visible dates when calendar view changes
  useEffect(() => {
    if (status !== "authenticated" || timezoneLoading) return;

    const fetchVisibleNotes = async () => {
      const datesToFetch: Date[] = [];

      if (viewMode === "day") {
        datesToFetch.push(currentDate);
      } else if (viewMode === "week") {
        // Fetch notes for the week
        const weekStart = new Date(currentDate);
        weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1); // Monday
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          datesToFetch.push(date);
        }
      }

      // Fetch notes for all dates
      await Promise.all(datesToFetch.map((date) => fetchDayNote(date)));
    };

    fetchVisibleNotes();
  }, [viewMode, currentDate, status, timezoneLoading, fetchDayNote]);

  const handleTaskClick = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setSelectedTask(task);
      setShowTaskDetail(true);
      setSidebarOpen(false); // Close sidebar on mobile when viewing task details
    }
  };

  const handleEditTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setEditingTask(task);
      setIsEditing(true);
    }
  };

  const handleUpdateTask = async (taskData: CreateTaskRequest) => {
    if (!editingTask) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/tasks/${editingTask.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taskData),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((task) => (task.id === editingTask.id ? data.task : task)));
        // Update selected task if it's the one being edited
        if (selectedTask?.id === editingTask.id) {
          setSelectedTask(data.task);
        }
        setEditingTask(null);
        setIsEditing(false);
      } else {
        const error = await response.json();
        console.error("Failed to update task:", error);
        throw new Error(error.error || "Failed to update task");
      }
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUnscheduleTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduled_start: null,
          scheduled_end: null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
        // Update selected task if it's the one being unscheduled
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task);
        }
      } else {
        const error = await response.json();
        console.error("Failed to unschedule task:", error);
        throw new Error(error.error || "Failed to unschedule task");
      }
    } catch (error) {
      console.error("Error unscheduling task:", error);
      throw error;
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const data = await response.json();
        // Remove the deleted task and all its subtasks from the UI
        const deletedIds = data.deleted_task_ids || [taskId];
        setTasks((prev) => prev.filter((task) => !deletedIds.includes(task.id)));
        // Also clear selected task if it was deleted
        if (selectedTask && deletedIds.includes(selectedTask.id)) {
          setSelectedTask(null);
        }
      } else {
        const error = await response.json();
        console.error("Failed to delete task:", error);
        throw new Error(error.error || "Failed to delete task");
      }
    } catch (error) {
      console.error("Error deleting task:", error);
      throw error;
    }
  };

  const handleStatusChange = async (taskId: string, status: Task["status"]) => {
    setProcessingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
        // Update selected task if it's the one being changed
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task);
        }
      } else {
        const error = await response.json();
        console.error("Failed to update task status:", error);
        throw new Error(error.error || "Failed to update task status");
      }
    } catch (error) {
      console.error("Error updating task status:", error);
      throw error;
    } finally {
      setProcessingTaskId(null);
    }
  };

  const handleCreateTask = async (taskData: CreateTaskRequest) => {
    setIsCreating(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taskData),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => [data.task, ...prev]);
        setShowCreateForm(false);
        setQuickAddInitialData(null); // Clear quick add data after successful creation
      } else {
        const error = await response.json();
        console.error("Failed to create task:", error);
        throw new Error(error.error || "Failed to create task");
      }
    } catch (error) {
      console.error("Error creating task:", error);
      throw error;
    } finally {
      setIsCreating(false);
    }
  };

  const handleSlotDoubleClick = (day: Date, hour: number, minute: number) => {
    // Create the start time in UTC using the user's timezone
    const startDate = createDateInTimezone(day, hour, minute, timezone);

    // Calculate end time (30 minutes later)
    const endDate = new Date(startDate.getTime() + 30 * 60000);

    // Convert to datetime-local format for the form inputs
    const scheduledStart = formatDateTimeLocalForTimezone(startDate.toISOString(), timezone);
    const scheduledEnd = formatDateTimeLocalForTimezone(endDate.toISOString(), timezone);

    // Set initial data for quick add
    setQuickAddInitialData({
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      duration: 30, // Default duration of 30 minutes
    });

    // Open the create form dialog
    setShowCreateForm(true);
    setSidebarOpen(false); // Close sidebar on mobile when creating task
  };

  // Show all tasks - selectedGroupId is now only used for visual highlighting in sidebar
  // Filter out tasks from hidden groups
  const filteredTasks = tasks.filter((task) => {
    if (!task.group_id) {
      // Ungrouped tasks
      return !hiddenGroups.has("ungrouped");
    }
    // Grouped tasks
    return !hiddenGroups.has(task.group_id);
  });

  const scheduledTasks = showAllTasks
    ? filteredTasks.filter((task) => task.scheduled_start && task.scheduled_end)
    : filteredTasks.filter((task) => task.scheduled_start && task.scheduled_end);

  const unscheduledTasks = filteredTasks.filter((task) => {
    const isUnscheduled = !task.scheduled_start || !task.scheduled_end;
    if (!isUnscheduled) return false;

    // Only show pending tasks
    if (task.status !== "pending") return false;

    // Include parent tasks with subtasks (they will be shown with nested subtasks)
    // Exclude subtasks themselves (they will be shown nested under their parent)
    if (task.parent_task_id) {
      return false;
    }

    return true;
  });

  // Fetch subtasks for parent tasks that have them
  useEffect(() => {
    const parentTasksWithSubtasks = unscheduledTasks.filter(
      (task) => (task.subtask_count || 0) > 0
    );
    parentTasksWithSubtasks.forEach((task) => {
      // Only fetch if we don't already have subtasks for this task
      if (!subtasksMap.has(task.id)) {
        fetchSubtasks(task.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unscheduledTasks]);

  // For display in calendar - only show scheduled tasks
  const calendarTasks = scheduledTasks;

  const handleDragStart = (event: DragStartEvent) => {
    const activeData = event.active.data.current;
    const activeId = event.active.id as string;
    setActiveDragId(activeId);

    // Track if we're resizing
    if (activeData?.type === "resize-handle") {
      setResizingTaskId(activeData.task?.id || null);
    } else if (activeData?.type === "sidebar-task" || activeData?.type === "task") {
      // Track the dragged task for the overlay
      setDraggedTask(activeData.task as Task);
    }
  };

  const handleDragOver = (_event: DragOverEvent) => {
    // Handle real-time resize preview if needed
    // For now, we'll handle resize on drop
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    setResizingTaskId(null);
    setDraggedTask(null);
    const { active, over } = event;

    if (!over) return;

    const activeData = active.data.current;
    const dropData = over.data.current;

    // Handle resize handle drag
    if (activeData?.type === "resize-handle") {
      const task = activeData.task as Task;
      const resizeDirection = activeData.resizeDirection as "top" | "bottom";

      if (
        !task.locked &&
        dropData?.type === "calendar-slot" &&
        task.scheduled_start &&
        task.scheduled_end
      ) {
        // Calculate new time based on drop position
        const { day, time } = dropData;
        // The time from the slot is already in decimal hours
        // Convert to hours and minutes, rounding to nearest 15-minute interval
        let totalMinutes = Math.round(time * 60);

        // Apply -15 minute offset for top resize (same as scheduling/rescheduling)
        // Bottom resize doesn't need the offset
        if (resizeDirection === "top") {
          totalMinutes = Math.max(0, totalMinutes - 15);
        }

        const snappedMinutes = Math.round(totalMinutes / 15) * 15;
        const hours = Math.floor(snappedMinutes / 60);
        const minutes = snappedMinutes % 60;

        if (resizeDirection === "bottom") {
          // Resize from bottom - change end time
          // Pass day directly - createDateInTimezone will extract the correct date from it
          const newEndDate = createDateInTimezone(day, hours, minutes, timezone);
          const startDate = new Date(task.scheduled_start);

          // Ensure end time is after start time
          if (newEndDate > startDate) {
            await handleTaskResize(task.id, newEndDate);
          }
        } else if (resizeDirection === "top") {
          // Resize from top - change start time
          // Pass day directly - createDateInTimezone will extract the correct date from it
          const newStartDate = createDateInTimezone(day, hours, minutes, timezone);
          const endDate = new Date(task.scheduled_end);

          // Ensure start time is before end time
          if (newStartDate < endDate) {
            await handleTaskResizeStart(task.id, newStartDate);
          }
        }
      }
      return;
    }

    // Handle task drag (scheduling/rescheduling)
    // Get task from active data (for sidebar tasks) or find it (for calendar tasks)
    const taskId = active.id as string;
    let task = activeData?.task as Task | undefined;
    if (!task) {
      task = tasks.find((t) => t.id === taskId);
    }

    if (!task || task.locked) return;

    // Get drop target data
    if (dropData?.type === "calendar-slot") {
      const { day, time } = dropData;

      // If task is already scheduled, reschedule it; otherwise schedule it
      if (task.scheduled_start) {
        await handleRescheduleTaskDrop(taskId, day, time);
      } else {
        await handleScheduleTaskDrop(taskId, day, time);
      }
    }
  };

  const handleTaskResize = async (taskId: string, newEndTime: Date) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked || !task.scheduled_start) return;

    const startDate = new Date(task.scheduled_start);

    // Ensure end time is after start time
    if (newEndTime <= startDate) return;

    // newEndTime is already snapped to 15-minute intervals from the drop position
    // Calculate duration based on the new end time
    const totalMinutes = (newEndTime.getTime() - startDate.getTime()) / 60000;
    const duration = Math.max(15, Math.round(totalMinutes / 15) * 15); // Minimum 15 minutes

    setProcessingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduled_end: newEndTime.toISOString(),
          duration: duration,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
    } catch (error) {
      console.error("Error resizing task:", error);
    } finally {
      setProcessingTaskId(null);
    }
  };

  const handleTaskResizeStart = async (taskId: string, newStartTime: Date) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked || !task.scheduled_start || !task.scheduled_end) return;

    const endDate = new Date(task.scheduled_end);

    // Ensure start time is before end time
    if (newStartTime >= endDate) return;

    // The newStartTime is already snapped to 15-minute intervals from the drop position
    // Calculate new duration based on the new start time and existing end time
    const totalMinutes = (endDate.getTime() - newStartTime.getTime()) / 60000;
    const snappedMinutes = Math.max(15, Math.round(totalMinutes / 15) * 15); // Minimum 15 minutes
    const duration = snappedMinutes;

    setProcessingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduled_start: newStartTime.toISOString(),
          duration: duration,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
    } catch (error) {
      console.error("Error resizing task start:", error);
    } finally {
      setProcessingTaskId(null);
    }
  };

  const handleScheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked) return;

    // The time from the slot is already in decimal hours (e.g., 18.0 for 6pm)
    // Apply -15 minute offset to account for slot positioning
    // Convert to hours and minutes, rounding to nearest 15-minute interval
    let totalMinutes = Math.round(time * 60);
    totalMinutes = Math.max(0, totalMinutes - 15); // Subtract 15 minutes to fix offset
    const snappedMinutes = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(snappedMinutes / 60);
    const minutes = snappedMinutes % 60;

    const duration = task.duration || 60; // Default to 60 minutes

    // Create the start date in the user's timezone, then convert to UTC
    // Pass day directly - createDateInTimezone will extract the correct date from it
    const startDate = createDateInTimezone(day, hours, minutes, timezone);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    setProcessingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
    } catch (error) {
      console.error("Error scheduling task:", error);
    } finally {
      setProcessingTaskId(null);
    }
  };

  const handleRescheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked || !task.scheduled_start || !task.scheduled_end) return;

    // The time from the slot is already in decimal hours (e.g., 18.0 for 6pm)
    // Apply -15 minute offset to account for slot positioning
    // Convert to hours and minutes, rounding to nearest 15-minute interval
    let totalMinutes = Math.round(time * 60);
    totalMinutes = Math.max(0, totalMinutes - 15); // Subtract 15 minutes to fix offset
    const snappedMinutes = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(snappedMinutes / 60);
    const minutes = snappedMinutes % 60;

    // Calculate duration from existing schedule
    const oldStart = new Date(task.scheduled_start);
    const oldEnd = new Date(task.scheduled_end);
    const duration = (oldEnd.getTime() - oldStart.getTime()) / 60000; // in minutes

    // Create the start date in the user's timezone, then convert to UTC
    // Pass day directly - createDateInTimezone will extract the correct date from it
    const startDate = createDateInTimezone(day, hours, minutes, timezone);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    setProcessingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      }
    } catch (error) {
      console.error("Error rescheduling task:", error);
    } finally {
      setProcessingTaskId(null);
    }
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    // When switching views, update currentDate appropriately
    if (mode === "day") {
      // If switching to day view, use today or keep current date
      setCurrentDate(new Date());
    } else if (mode === "month") {
      // If switching to month view, use current month
      setCurrentDate(startOfMonth(new Date()));
    } else {
      // Week view - use current week
      setCurrentDate(new Date());
    }
  };

  // View toggle buttons - mobile (abbreviated)
  const mobileViewToggleButtons = (
    <>
      <Button
        variant={viewMode === "day" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("day")}
        className="min-w-[2.5rem]"
      >
        D
      </Button>
      <Button
        variant={viewMode === "week" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("week")}
        className="min-w-[2.5rem]"
      >
        W
      </Button>
      <Button
        variant={viewMode === "month" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("month")}
        className="min-w-[2.5rem]"
      >
        M
      </Button>
    </>
  );

  // View toggle buttons - desktop (full text)
  const desktopViewToggleButtons = (
    <>
      <Button
        variant={viewMode === "day" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("day")}
      >
        Day
      </Button>
      <Button
        variant={viewMode === "week" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("week")}
      >
        Week
      </Button>
      <Button
        variant={viewMode === "month" ? "default" : "outline"}
        size="sm"
        onClick={() => handleViewModeChange("month")}
      >
        Month
      </Button>
    </>
  );

  // Sidebar resize handlers
  const resizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX;
      const minWidth = 240; // Minimum width
      const maxWidth = 600; // Maximum width

      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar-width", sidebarWidth.toString());
      }
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, sidebarWidth]);

  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined" && !isResizing) {
      localStorage.setItem("sidebar-width", sidebarWidth.toString());
    }
  }, [sidebarWidth, isResizing]);

  // Show skeleton while loading session, timezone, or tasks
  // Don't render calendar until timezone is loaded and stable
  const isReady = status === "authenticated" && !timezoneLoading && !isLoading && !!session;
  if (!isReady) {
    return <CalendarSkeleton />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-4rem)] relative">
        {/* Backdrop overlay for mobile */}
        {sidebarOpen && (
          // biome-ignore lint/a11y/noStaticElementInteractions: Backdrop overlay for mobile sidebar
          // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop overlay doesn't need keyboard interaction
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <div
          className={cn(
            "fixed md:static inset-y-0 left-0 z-50 md:z-auto w-[85vw] max-w-sm border-r overflow-y-auto bg-background transform transition-transform duration-300 ease-in-out md:transition-none",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          )}
          style={{
            width:
              typeof window !== "undefined" && window.innerWidth >= 768
                ? `${sidebarWidth}px`
                : undefined,
          }}
        >
          <div className="p-4 space-y-4">
            {/* Close button for mobile */}
            <div className="flex items-center justify-between md:hidden pb-2 border-b">
              <h3 className="font-semibold">Task Groups</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Add Task Button */}
            <Button
              className="w-full h-11"
              onClick={() => {
                setShowCreateForm(true);
                setSidebarOpen(false); // Close sidebar on mobile when creating task
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>

            {/* Day Notes Section - Only show in day view when note exists - Always at top */}
            {viewMode === "day" &&
              (() => {
                const dateKey = formatDateKey(currentDate);
                const note = dayNotes.get(dateKey);
                return note ? (
                  <DayNotesSection
                    note={note}
                    onUpdate={async (content) => {
                      await createOrUpdateDayNote(currentDate, content);
                    }}
                    onDelete={async () => {
                      await deleteDayNote(currentDate);
                    }}
                  />
                ) : null;
              })()}

            {/* Task Groups */}
            <div className="border rounded-lg overflow-hidden">
              {/* biome-ignore lint/a11y/useSemanticElements: Collapsible section header requires div for layout */}
              <div
                role="button"
                tabIndex={0}
                className="px-4 py-3 border-b cursor-pointer hover:bg-accent/50 transition-colors flex items-center justify-between bg-card"
                onClick={() => {
                  const newSet = new Set(expandedSections);
                  if (newSet.has("task-groups")) {
                    newSet.delete("task-groups");
                  } else {
                    newSet.add("task-groups");
                  }
                  setExpandedSections(newSet);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    const newSet = new Set(expandedSections);
                    if (newSet.has("task-groups")) {
                      newSet.delete("task-groups");
                    } else {
                      newSet.add("task-groups");
                    }
                    setExpandedSections(newSet);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  {expandedSections.has("task-groups") ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <h3 className="text-sm font-semibold">Task Groups</h3>
                </div>
                <RefreshButton
                  onRefresh={async () => {
                    await fetchTasks(false); // Don't set loading state for refresh
                    await fetchGroups();
                  }}
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Refresh task groups"
                />
              </div>
              {expandedSections.has("task-groups") && (
                <div>
                  <TaskGroupManager
                    onGroupSelect={setSelectedGroupId}
                    selectedGroupId={selectedGroupId}
                    tasks={tasks}
                    onTaskClick={handleTaskClick}
                    showAllTasks={showAllTasks}
                    onShowAllTasksChange={setShowAllTasks}
                    onHiddenGroupsChange={setHiddenGroups}
                  />
                </div>
              )}
            </div>

            {/* Task Metrics */}
            <TaskMetrics
              tasks={filteredTasks}
              onTaskClick={handleTaskClick}
              onProcessOverdue={() => setProcessOverdueOpen(true)}
              onRefresh={async () => {
                await fetchTasks(false); // Don't set loading state for refresh
                await fetchGroups();
              }}
            />

            {/* Unscheduled Tasks */}
            {unscheduledTasks.length > 0 && (
              <Card>
                <CardHeader
                  className="cursor-pointer hover:bg-accent/50 transition-colors py-2 px-3"
                  onClick={() => {
                    const newSet = new Set(expandedSections);
                    if (newSet.has("unscheduled-tasks")) {
                      newSet.delete("unscheduled-tasks");
                    } else {
                      newSet.add("unscheduled-tasks");
                    }
                    setExpandedSections(newSet);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {expandedSections.has("unscheduled-tasks") ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckSquare className="h-4 w-4" />
                        Unscheduled ({unscheduledTasks.length})
                      </CardTitle>
                    </div>
                    <RefreshButton
                      onRefresh={async () => {
                        await fetchTasks(false); // Don't set loading state for refresh
                        await fetchGroups();
                      }}
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Refresh unscheduled tasks"
                    />
                  </div>
                </CardHeader>
                {expandedSections.has("unscheduled-tasks") && (
                  <CardContent className="px-2 pb-2 pt-0">
                    <div className="max-h-[400px] overflow-y-auto space-y-1 pr-1">
                      {sortTasksByCreatedTimeDesc(unscheduledTasks).map((task) => {
                        const allSubtasks = subtasksMap.get(task.id) || [];
                        // Filter to only show unscheduled subtasks (matching the unscheduled filter)
                        const filteredSubtasks = allSubtasks.filter(
                          (st) =>
                            st.status === "pending" &&
                            (!st.scheduled_start || !st.scheduled_end)
                        );
                        return (
                          <SlimTaskCard
                            key={task.id}
                            task={task}
                            onTaskClick={handleTaskClick}
                            subtasks={filteredSubtasks.length > 0 ? filteredSubtasks : undefined}
                          />
                        );
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}
          </div>

          {/* Resize handle - only visible on desktop */}
          {/* biome-ignore lint/a11y/useSemanticElements: Resize handle requires div for resize functionality */}
          <div
            ref={resizeRef}
            role="button"
            tabIndex={0}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsResizing(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setIsResizing(true);
              }
            }}
            className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 transition-all z-10 group"
            style={{
              backgroundColor: isResizing ? "rgba(59, 130, 246, 0.5)" : "transparent",
            }}
            onMouseEnter={(e) => {
              e.stopPropagation();
            }}
            onMouseLeave={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-0.5 h-16 bg-primary/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </div>
        </div>

        {/* Main Calendar Area */}
        <div className="flex-1 overflow-hidden w-full">
          {viewMode === "day" && (
            <DayCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              activeDragId={activeDragId}
              resizingTaskId={resizingTaskId}
              selectedGroupId={selectedGroupId}
              groups={groups}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              currentDate={currentDate}
              onDateChange={setCurrentDate}
              mobileViewToggleButtons={mobileViewToggleButtons}
              desktopViewToggleButtons={desktopViewToggleButtons}
              onNoteClick={handleNoteClick}
              onSlotDoubleClick={handleSlotDoubleClick}
              onRefresh={() => fetchTasks(false)}
            />
          )}
          {viewMode === "week" && (
            <WeeklyCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              activeDragId={activeDragId}
              resizingTaskId={resizingTaskId}
              selectedGroupId={selectedGroupId}
              groups={groups}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              mobileViewToggleButtons={mobileViewToggleButtons}
              desktopViewToggleButtons={desktopViewToggleButtons}
              onNoteClick={handleNoteClick}
              onSlotDoubleClick={handleSlotDoubleClick}
              onRefresh={() => fetchTasks(false)}
            />
          )}
          {viewMode === "month" && (
            <MonthCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              groups={groups}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              currentDate={currentDate}
              onDateChange={setCurrentDate}
              onDateClick={(date) => {
                setCurrentDate(date);
                setViewMode("day");
              }}
              mobileViewToggleButtons={mobileViewToggleButtons}
              desktopViewToggleButtons={desktopViewToggleButtons}
              onRefresh={() => fetchTasks(false)}
            />
          )}
        </div>
      </div>

      {/* Task Detail Dialog */}
      <TaskDetailDialog
        task={selectedTask}
        open={showTaskDetail}
        onOpenChange={setShowTaskDetail}
        onEdit={handleEditTask}
        onDelete={handleDeleteTask}
        onStatusChange={handleStatusChange}
        onUnschedule={handleUnscheduleTask}
        onTaskUpdate={async () => {
          // Task updates are handled via onTaskRefresh callback
          // No need to refresh the entire list
        }}
        onTaskRefresh={(updatedTask) => {
          // Update the selected task with fresh data
          setSelectedTask(updatedTask);
          // Also update the task in the tasks array
          setTasks((prev) => prev.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        }}
      />

      {/* Day Note Dialog */}
      {noteDialogDate && (
        <DayNoteDialog
          open={noteDialogOpen}
          onOpenChange={setNoteDialogOpen}
          date={noteDialogDate}
          note={dayNotes.get(formatDateKey(noteDialogDate)) || null}
          onSave={async (date, content) => {
            await createOrUpdateDayNote(date, content);
            // Day note is already updated in state via createOrUpdateDayNote
          }}
        />
      )}

      {/* Create Task Dialog */}
      <Dialog
        open={showCreateForm}
        onOpenChange={(open) => {
          setShowCreateForm(open);
          if (!open) {
            // Clear quick add data when dialog closes
            setQuickAddInitialData(null);
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] md:w-full mx-2 md:mx-auto"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>
          <TaskForm
            onSubmit={handleCreateTask}
            onCancel={() => {
              setShowCreateForm(false);
              setQuickAddInitialData(null);
            }}
            isLoading={isCreating}
            initialData={quickAddInitialData || undefined}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog
        open={isEditing}
        onOpenChange={(open) => {
          setIsEditing(open);
          if (!open) {
            setEditingTask(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] md:w-full mx-2 md:mx-auto">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          {editingTask && (
            <TaskForm
              onSubmit={handleUpdateTask}
              onCancel={() => {
                setEditingTask(null);
                setIsEditing(false);
              }}
              initialData={{
                title: editingTask.title,
                description: editingTask.description || undefined,
                priority: editingTask.priority,
                duration: editingTask.duration || undefined,
                task_type: editingTask.task_type,
                group_id: editingTask.group_id || undefined,
                template_id: editingTask.template_id || undefined,
                energy_level_required: editingTask.energy_level_required,
                depends_on_task_id: editingTask.depends_on_task_id || undefined,
                scheduled_start: editingTask.scheduled_start || undefined,
                scheduled_end: editingTask.scheduled_end || undefined,
                due_date: editingTask.due_date || undefined,
              }}
              isLoading={isUpdating}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Process Overdue Dialog */}
      <ProcessOverdueDialog
        tasks={tasks}
        open={processOverdueOpen}
        onOpenChange={setProcessOverdueOpen}
        onTasksUpdated={fetchTasks}
      />

      {/* Drag Overlay - renders dragged item in a portal to avoid overflow clipping */}
      <DragOverlay>
        {draggedTask && (
          <div
            className="p-2 rounded border bg-card shadow-lg cursor-grabbing text-sm"
            style={{ opacity: 0.9 }}
          >
            <div className="font-medium truncate">{draggedTask.title}</div>
            <Badge variant="outline" className="text-xs mt-1">
              Priority {draggedTask.priority}
            </Badge>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
