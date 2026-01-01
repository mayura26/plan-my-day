"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { GroupedTaskList } from "@/components/grouped-task-list";
import { TaskForm } from "@/components/task-form";
import { TaskImportDialog } from "@/components/task-import-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CreateTaskRequest, Task, TaskGroup } from "@/lib/types";

export default function TasksPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  // Fetch tasks
  const fetchTasks = async () => {
    try {
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
    if (session) {
      fetchTasks();
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Create task
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

  // Edit task
  const handleEditTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setEditingTask(task);
      setIsEditing(true);
    }
  };

  const handleUpdateTaskForm = async (taskData: CreateTaskRequest) => {
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
        // Refresh tasks to ensure all updates are reflected
        await fetchTasks();
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

  // Update task status/properties
  const handleUpdateTaskStatus = async (taskId: string, updates: Partial<Task>) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        const data = await response.json();
        setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
      } else {
        const error = await response.json();
        console.error("Failed to update task:", error);
        throw new Error(error.error || "Failed to update task");
      }
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    }
  };

  // Delete task
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

  // Extend task (placeholder for future functionality)
  const handleExtendTask = (taskId: string) => {
    console.log("Extend task:", taskId);
    // TODO: Implement task extension
  };

  // Unschedule task
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

  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Main Content */}
      <main className="container mx-auto px-4 py-4 md:py-8">
        <GroupedTaskList
          tasks={tasks}
          groups={groups}
          onUpdateTask={handleUpdateTaskStatus}
          onDeleteTask={handleDeleteTask}
          onEditTask={handleEditTask}
          onExtendTask={handleExtendTask}
          onUnscheduleTask={handleUnscheduleTask}
          onCreateTask={() => setShowCreateForm(true)}
          onImport={() => setShowImportDialog(true)}
          showAllTasks={showAllTasks}
          onShowAllTasksChange={setShowAllTasks}
        />
      </main>

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
            <DialogDescription>
              Modify the task details below and click "Update Task" to save your changes.
            </DialogDescription>
          </DialogHeader>
          {editingTask && (
            <TaskForm
              onSubmit={handleUpdateTaskForm}
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

      {/* Import Tasks Dialog */}
      <TaskImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        groups={groups}
        onImport={async () => {
          await fetchTasks();
          await fetchGroups();
        }}
      />
    </div>
  );
}
