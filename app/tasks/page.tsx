"use client";

import { Folder } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EditGroupDialog } from "@/components/edit-group-dialog";
import { GroupedTaskList } from "@/components/grouped-task-list";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { TaskForm } from "@/components/task-form";
import { TaskImportDialog } from "@/components/task-import-dialog";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CreateTaskGroupRequest, CreateTaskRequest, Task, TaskGroup } from "@/lib/types";

export default function TasksPage() {
  const { confirm } = useConfirmDialog();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [showCreateParentDialog, setShowCreateParentDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3B82F6");

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
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
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch("/api/task-groups");
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error("Error fetching groups:", error);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchTasks();
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fetchGroups, fetchTasks]);

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
        toast.success("Task created successfully");
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

  // Handle task click - opens detail dialog
  const handleTaskClick = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setSelectedTask(task);
      setShowTaskDetail(true);
    }
  };

  // Edit task - called from detail dialog
  const handleEditTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      setEditingTask(task);
      setIsEditing(true);
      setShowTaskDetail(false); // Close detail dialog when opening edit dialog
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
        toast.success("Task updated successfully");
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
        // Update selected task if it's the one being updated
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task);
        }
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

  // Handle status change from detail dialog
  const handleStatusChange = async (taskId: string, status: Task["status"]) => {
    await handleUpdateTaskStatus(taskId, { status });
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
        // Clear selected task if it was deleted
        if (selectedTask && deletedIds.includes(selectedTask.id)) {
          setSelectedTask(null);
          setShowTaskDetail(false);
        }
        toast.success("Task deleted successfully");
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
        // Update selected task if it's the one being unscheduled
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.task);
        }
        toast.success("Task unscheduled successfully");
      } else {
        const error = await response.json();
        console.error("Failed to unschedule task:", error);
        toast.error(error.error || "Failed to unschedule task");
        throw new Error(error.error || "Failed to unschedule task");
      }
    } catch (error) {
      console.error("Error unscheduling task:", error);
      throw error;
    }
  };

  // Edit group
  const handleRenameGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    setShowEditGroupDialog(true);
  };

  const handleGroupUpdated = async () => {
    // Refresh groups after update
    await fetchGroups();
  };

  // Create parent group
  const handleCreateParentGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      const response = await fetch("/api/task-groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
          is_parent_group: true,
        } as CreateTaskGroupRequest),
      });

      if (response.ok) {
        const data = await response.json();
        setGroups((prev) => [...prev, data.group]);
        setNewGroupName("");
        setNewGroupColor("#3B82F6");
        setShowCreateParentDialog(false);
        toast.success("Parent group created successfully");
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to create parent group");
        console.error("Failed to create parent group:", error);
        throw new Error(error.error || "Failed to create parent group");
      }
    } catch (error) {
      console.error("Error creating parent group:", error);
      throw error;
    }
  };

  // Delete group
  const handleDeleteGroup = async (groupId: string) => {
    const confirmed = await confirm({
      title: "Delete Task Group",
      description:
        "Are you sure you want to delete this group? Tasks in this group will be ungrouped.",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/task-groups/${groupId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setGroups((prev) => prev.filter((group) => group.id !== groupId));
        // Refresh tasks to update group_id references
        await fetchTasks();
        toast.success("Task group deleted successfully");
      } else {
        const error = await response.json();
        console.error("Failed to delete group:", error);
        toast.error(error.error || "Failed to delete group");
        throw new Error(error.error || "Failed to delete group");
      }
    } catch (error) {
      console.error("Error deleting group:", error);
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
          onEditTask={handleTaskClick}
          onExtendTask={handleExtendTask}
          onUnscheduleTask={handleUnscheduleTask}
          onCreateTask={() => setShowCreateForm(true)}
          onImport={() => setShowImportDialog(true)}
          showAllTasks={showAllTasks}
          onShowAllTasksChange={setShowAllTasks}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onCreateParentGroup={() => setShowCreateParentDialog(true)}
        />
      </main>

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
          // Also update in tasks list
          setTasks((prev) => prev.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        }}
      />

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

      {/* Create Parent Group Dialog */}
      <Dialog
        open={showCreateParentDialog}
        onOpenChange={(open) => {
          setShowCreateParentDialog(open);
          if (!open) {
            setNewGroupName("");
            setNewGroupColor("#3B82F6");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Parent Group</DialogTitle>
            <DialogDescription>
              Create a new parent group to organize your task groups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="parent-group-name-input" className="text-sm font-medium">
                Parent Group Name
              </label>
              <Input
                id="parent-group-name-input"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter parent group name"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="parent-group-color-input" className="text-sm font-medium">
                Color
              </label>
              <div className="mt-1 flex items-center gap-3">
                <div className="relative">
                  <input
                    id="parent-group-color-input"
                    type="color"
                    value={newGroupColor}
                    onChange={(e) => setNewGroupColor(e.target.value)}
                    className="h-10 w-20 cursor-pointer rounded-md border border-input bg-background"
                    title="Pick a color"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-10 w-10 rounded-md border border-input"
                    style={{ backgroundColor: newGroupColor }}
                  />
                  <Input
                    type="text"
                    value={newGroupColor}
                    onChange={(e) => setNewGroupColor(e.target.value)}
                    placeholder="#3B82F6"
                    className="w-24 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateParentDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateParentGroup} disabled={!newGroupName.trim()}>
                Create Parent Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <EditGroupDialog
        open={showEditGroupDialog}
        onOpenChange={setShowEditGroupDialog}
        group={editingGroup}
        groups={groups}
        onGroupUpdated={handleGroupUpdated}
      />
    </div>
  );
}
