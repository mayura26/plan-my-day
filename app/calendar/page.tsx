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
import { useEffect, useState } from "react";
import { CalendarSkeleton } from "@/components/calendar-skeleton";
import { DayCalendar } from "@/components/day-calendar";
import { DayNoteDialog } from "@/components/day-note-dialog";
import { DayNotesSection } from "@/components/day-notes-section";
import { MonthCalendar } from "@/components/month-calendar";
import { SlimTaskCard } from "@/components/slim-task-card";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { TaskForm } from "@/components/task-form";
import { TaskGroupManager } from "@/components/task-group-manager";
import { TaskMetrics } from "@/components/task-metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeeklyCalendar } from "@/components/weekly-calendar";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { sortTasksByCreatedTimeDesc } from "@/lib/task-utils";
import { createDateInTimezone, getDateInTimezone } from "@/lib/timezone-utils";
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

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  );

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/tasks");
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      } else {
        console.error("Failed to fetch tasks");
      }
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch("/api/task-groups");
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }

    // Only fetch tasks once authenticated AND timezone is loaded
    if (status === "authenticated" && !timezoneLoading) {
      fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router, timezoneLoading]);

  useEffect(() => {
    if (session) {
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Helper function to format date to YYYY-MM-DD in user's timezone
  const formatDateKey = (date: Date): string => {
    const dateInTimezone = getDateInTimezone(date, timezone);
    return format(dateInTimezone, "yyyy-MM-dd");
  };

  // Fetch day note for a specific date
  const fetchDayNote = async (date: Date) => {
    try {
      const dateKey = formatDateKey(date);
      const response = await fetch(`/api/day-notes?date=${dateKey}`);
      if (response.ok) {
        const data = await response.json();
        setDayNotes((prev) => {
          const newMap = new Map(prev);
          newMap.set(dateKey, data.note);
          return newMap;
        });
        return data.note;
      } else if (response.status === 404) {
        // Note doesn't exist, remove from map
        setDayNotes((prev) => {
          const newMap = new Map(prev);
          newMap.delete(dateKey);
          return newMap;
        });
        return null;
      }
    } catch (error) {
      console.error("Error fetching day note:", error);
    }
    return null;
  };

  // Create or update day note
  const createOrUpdateDayNote = async (date: Date, content: string) => {
    const dateKey = formatDateKey(date);
    try {
      // Try to get existing note first
      const existingNote = dayNotes.get(dateKey);

      let response;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, currentDate, status, timezoneLoading, timezone]);

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

    // Exclude parent tasks that have subtasks (only show subtasks in unscheduled view)
    if (!task.parent_task_id && (task.subtask_count || 0) > 0) {
      return false;
    }

    return true;
  });

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
        // Snap to 15-minute intervals
        const totalMinutes = time * 60;
        const snappedMinutes = Math.round(totalMinutes / 15) * 15;
        const hours = Math.floor(snappedMinutes / 60);
        const minutes = snappedMinutes % 60;

        if (resizeDirection === "bottom") {
          // Resize from bottom - change end time
          const newEndDate = createDateInTimezone(day, hours, minutes, timezone);
          const startDate = new Date(task.scheduled_start);

          // Ensure end time is after start time
          if (newEndDate > startDate) {
            await handleTaskResize(task.id, newEndDate);
          }
        } else if (resizeDirection === "top") {
          // Resize from top - change start time
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
    }
  };

  const handleScheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked) return;

    // Snap to 15-minute intervals
    const totalMinutes = time * 60;
    const snappedMinutes = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(snappedMinutes / 60);
    const minutes = snappedMinutes % 60;

    const duration = task.duration || 60; // Default to 60 minutes
    // Create the start date in the user's timezone, then convert to UTC
    const startDate = createDateInTimezone(day, hours, minutes, timezone);
    const endDate = new Date(startDate.getTime() + duration * 60000);

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
    }
  };

  const handleRescheduleTaskDrop = async (taskId: string, day: Date, time: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.locked || !task.scheduled_start || !task.scheduled_end) return;

    // Snap to 15-minute intervals
    const totalMinutes = time * 60;
    const snappedMinutes = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(snappedMinutes / 60);
    const minutes = snappedMinutes % 60;

    // Calculate duration from existing schedule
    const oldStart = new Date(task.scheduled_start);
    const oldEnd = new Date(task.scheduled_end);
    const duration = (oldEnd.getTime() - oldStart.getTime()) / 60000; // in minutes

    // Create the start date in the user's timezone, then convert to UTC
    const startDate = createDateInTimezone(day, hours, minutes, timezone);
    const endDate = new Date(startDate.getTime() + duration * 60000);

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
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <div
          className={cn(
            "fixed md:static inset-y-0 left-0 z-50 md:z-auto w-[85vw] max-w-sm md:w-80 border-r overflow-y-auto bg-background transform transition-transform duration-300 ease-in-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          )}
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
              <div
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
              >
                <div className="flex items-center gap-2">
                  {expandedSections.has("task-groups") ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <h3 className="text-sm font-semibold">Task Groups</h3>
                </div>
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
            <TaskMetrics tasks={filteredTasks} onTaskClick={handleTaskClick} />

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
                  </div>
                </CardHeader>
                {expandedSections.has("unscheduled-tasks") && (
                  <CardContent className="space-y-1 px-2 pb-2 pt-0">
                    {sortTasksByCreatedTimeDesc(unscheduledTasks)
                      .slice(0, 5)
                      .map((task) => (
                        <SlimTaskCard key={task.id} task={task} onTaskClick={handleTaskClick} />
                      ))}
                    {unscheduledTasks.length > 5 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => router.push("/tasks")}
                      >
                        View all {unscheduledTasks.length} tasks
                      </Button>
                    )}
                  </CardContent>
                )}
              </Card>
            )}
          </div>
        </div>

        {/* Main Calendar Area */}
        <div className="flex-1 overflow-hidden w-full">
          {viewMode === "day" && (
            <DayCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              onTaskSchedule={handleScheduleTaskDrop}
              onTaskReschedule={handleRescheduleTaskDrop}
              onTaskResize={handleTaskResize}
              activeDragId={activeDragId}
              resizingTaskId={resizingTaskId}
              selectedGroupId={selectedGroupId}
              groups={groups}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              currentDate={currentDate}
              onDateChange={setCurrentDate}
              mobileViewToggleButtons={mobileViewToggleButtons}
              desktopViewToggleButtons={desktopViewToggleButtons}
              dayNote={dayNotes.get(formatDateKey(currentDate)) || null}
              onNoteClick={handleNoteClick}
            />
          )}
          {viewMode === "week" && (
            <WeeklyCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              onTaskSchedule={handleScheduleTaskDrop}
              onTaskReschedule={handleRescheduleTaskDrop}
              onTaskResize={handleTaskResize}
              activeDragId={activeDragId}
              resizingTaskId={resizingTaskId}
              selectedGroupId={selectedGroupId}
              groups={groups}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              mobileViewToggleButtons={mobileViewToggleButtons}
              desktopViewToggleButtons={desktopViewToggleButtons}
              dayNotes={dayNotes}
              onNoteClick={handleNoteClick}
            />
          )}
          {viewMode === "month" && (
            <MonthCalendar
              tasks={calendarTasks}
              timezone={timezone}
              onTaskClick={handleTaskClick}
              selectedGroupId={selectedGroupId}
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
          // Refresh the task list
          await fetchTasks();
        }}
        onTaskRefresh={(updatedTask) => {
          // Update the selected task with fresh data
          setSelectedTask(updatedTask);
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
            // Refresh the note to ensure sidebar updates
            await fetchDayNote(date);
          }}
        />
      )}

      {/* Create Task Dialog */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw] md:w-full mx-2 md:mx-auto">
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>
          <TaskForm
            onSubmit={handleCreateTask}
            onCancel={() => setShowCreateForm(false)}
            isLoading={isCreating}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
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
