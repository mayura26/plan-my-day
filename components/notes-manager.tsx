"use client";

import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { TaskTodo } from "@/lib/types";

interface NotesManagerProps {
  taskId: string;
  onNotesChange?: () => void;
  readOnly?: boolean;
  noCard?: boolean; // If true, don't render the Card wrapper
}

export function NotesManager({
  taskId,
  onNotesChange,
  readOnly = false,
  noCard = false,
}: NotesManagerProps) {
  const { confirm } = useConfirmDialog();
  const [todos, setTodos] = useState<TaskTodo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [togglingTodoId, setTogglingTodoId] = useState<string | null>(null);
  const [deletingTodoId, setDeletingTodoId] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/todos`);
      if (response.ok) {
        const data = await response.json();
        setTodos(data.todos || []);
      }
    } catch (error) {
      console.error("Error fetching todos:", error);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsAdding(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (response.ok) {
        setDescription("");
        setShowAddForm(false);
        await fetchTodos();
        onNotesChange?.();
        toast.success("Note added successfully");
      } else {
        toast.error("Failed to add note");
      }
    } catch (error) {
      console.error("Error adding todo:", error);
      toast.error("Failed to add note");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleTodo = async (todo: TaskTodo) => {
    const newCompleted = !todo.completed;
    setTogglingTodoId(todo.id);
    try {
      const response = await fetch(`/api/tasks/${taskId}/todos/${todo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: newCompleted }),
      });

      if (response.ok) {
        await fetchTodos();
        onNotesChange?.();
      }
    } catch (error) {
      console.error("Error toggling todo:", error);
    } finally {
      setTogglingTodoId(null);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    const confirmed = await confirm({
      title: "Delete Note",
      description: "Are you sure you want to delete this note?",
      variant: "destructive",
      confirmText: "Delete",
    });

    if (!confirmed) return;

    setDeletingTodoId(todoId);
    try {
      const response = await fetch(`/api/tasks/${taskId}/todos/${todoId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchTodos();
        onNotesChange?.();
        toast.success("Note deleted successfully");
      } else {
        toast.error("Failed to delete note");
      }
    } catch (error) {
      console.error("Error deleting todo:", error);
      toast.error("Failed to delete note");
    } finally {
      setDeletingTodoId(null);
    }
  };

  const completedCount = todos.filter((todo) => todo.completed).length;
  const totalCount = todos.length;

  const content = (
    <>
      {!noCard && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Notes</CardTitle>
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {completedCount}/{totalCount} checked
              </span>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className={noCard ? "p-0 space-y-3" : "space-y-3"}>
        {/* Todo List */}
        {todos.length > 0 && (
          <div className="space-y-2">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className={`flex items-center gap-2 p-2 rounded-md border ${
                  todo.completed ? "bg-muted/50 border-muted" : "bg-background border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => !readOnly && handleToggleTodo(todo)}
                  disabled={readOnly || togglingTodoId === todo.id}
                  className="flex-shrink-0 hover:opacity-70 disabled:cursor-not-allowed"
                >
                  {togglingTodoId === todo.id ? (
                    <LoadingSpinner size="sm" className="h-5 w-5" />
                  ) : todo.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={`flex-1 text-sm ${
                    todo.completed ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {todo.description}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteTodo(todo.id)}
                    disabled={deletingTodoId === todo.id}
                    className="flex-shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    {deletingTodoId === todo.id ? (
                      <LoadingSpinner size="sm" className="h-4 w-4" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Todo Form */}
        {!readOnly &&
          (showAddForm ? (
            <form onSubmit={handleAddTodo} className="space-y-3 pt-2 border-t">
              <div>
                <Input
                  placeholder="Add a note..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && description.trim()) {
                      e.preventDefault();
                      handleAddTodo(e as any);
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setDescription("");
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isAdding || !description.trim()}
                  className="flex-1"
                >
                  {isAdding ? "Adding..." : "Add"}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Note
            </Button>
          ))}

        {todos.length === 0 && !showAddForm && (
          <p className="text-sm text-muted-foreground text-center py-2">No notes yet</p>
        )}
      </CardContent>
    </>
  );

  // Reserve space during loading to prevent layout shift
  if (isLoading) {
    if (noCard) {
      return <div className="text-sm text-muted-foreground py-2">Loading notes...</div>;
    }
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Notes</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground py-2">Loading notes...</div>
        </CardContent>
      </Card>
    );
  }

  if (noCard) {
    return <div className="space-y-3">{content}</div>;
  }

  return <Card>{content}</Card>;
}
