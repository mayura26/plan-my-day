"use client";

import { Calendar, Filter, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  sortTasksByCreatedTime,
  sortTasksByPriority,
  sortTasksByScheduledTime,
} from "@/lib/task-utils";
import type { Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";
import { TaskCard } from "./task-card";

interface TaskListProps {
  tasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onEditTask?: (taskId: string) => void;
  onExtendTask?: (taskId: string) => void;
  onCreateTask?: () => void;
  showGroup?: boolean;
  compact?: boolean;
  groups?: TaskGroup[];
}

export function TaskList({
  tasks,
  onUpdateTask,
  onDeleteTask,
  onEditTask,
  onExtendTask,
  onCreateTask,
  showGroup = false,
  compact = false,
  groups = [],
}: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<number[]>([]);
  const [typeFilter, setTypeFilter] = useState<TaskType[]>([]);
  const [sortBy, setSortBy] = useState<"priority" | "scheduled" | "created">("priority");
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort tasks
  const filteredTasks = tasks.filter((task) => {
    // Search filter
    if (
      searchQuery &&
      !task.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !task.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    // Status filter
    if (statusFilter.length > 0 && !statusFilter.includes(task.status)) {
      return false;
    }

    // Priority filter
    if (priorityFilter.length > 0 && !priorityFilter.includes(task.priority)) {
      return false;
    }

    // Type filter
    if (typeFilter.length > 0 && !typeFilter.includes(task.task_type)) {
      return false;
    }

    return true;
  });

  // Sort filtered tasks
  const sortedTasks = (() => {
    switch (sortBy) {
      case "priority":
        return sortTasksByPriority(filteredTasks);
      case "scheduled":
        return sortTasksByScheduledTime(filteredTasks);
      case "created":
        return sortTasksByCreatedTime(filteredTasks);
      default:
        return filteredTasks;
    }
  })();

  // Task counts by status
  const taskCounts = {
    pending: tasks.filter((t) => t.status === "pending").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
  };

  const totalTasks = tasks.length;
  const filteredCount = filteredTasks.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tasks</h2>
          <p className="text-muted-foreground">
            {filteredCount} of {totalTasks} tasks
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        </div>
        {onCreateTask && (
          <Button onClick={onCreateTask}>
            <Plus className="w-4 h-4 mr-2" />
            Add Task
          </Button>
        )}
      </div>

      {/* Task Counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {taskCounts.pending}
            </div>
            <p className="text-sm text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {taskCounts.in_progress}
            </div>
            <p className="text-sm text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {taskCounts.completed}
            </div>
            <p className="text-sm text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {taskCounts.cancelled}
            </div>
            <p className="text-sm text-muted-foreground">Cancelled</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center"
              >
                <Filter className="w-4 h-4 mr-2" />
                Filters
                {(statusFilter.length > 0 ||
                  priorityFilter.length > 0 ||
                  typeFilter.length > 0) && (
                  <Badge variant="secondary" className="ml-2">
                    {statusFilter.length + priorityFilter.length + typeFilter.length}
                  </Badge>
                )}
              </Button>

              {/* Sort */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground">Sort by:</span>
                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="created">Created</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Filter Options */}
            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                {/* Status Filter */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Status</div>
                  <div className="space-y-1">
                    {(["pending", "in_progress", "completed", "cancelled"] as TaskStatus[]).map(
                      (status) => (
                        <label key={status} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={statusFilter.includes(status)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setStatusFilter((prev) => [...prev, status]);
                              } else {
                                setStatusFilter((prev) => prev.filter((s) => s !== status));
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm capitalize">{status.replace("_", " ")}</span>
                        </label>
                      )
                    )}
                  </div>
                </div>

                {/* Priority Filter */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Priority</div>
                  <div className="space-y-1">
                    {[1, 2, 3, 4, 5].map((priority) => (
                      <label key={priority} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={priorityFilter.includes(priority)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPriorityFilter((prev) => [...prev, priority]);
                            } else {
                              setPriorityFilter((prev) => prev.filter((p) => p !== priority));
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm">
                          {priority}. Priority {priority}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Type Filter */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Type</div>
                  <div className="space-y-1">
                    {(["task", "event"] as TaskType[]).map((type) => (
                      <label key={type} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={typeFilter.includes(type)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTypeFilter((prev) => [...prev, type]);
                            } else {
                              setTypeFilter((prev) => prev.filter((t) => t !== type));
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm capitalize">{type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Task List */}
      {sortedTasks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No tasks found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery ||
              statusFilter.length > 0 ||
              priorityFilter.length > 0 ||
              typeFilter.length > 0
                ? "Try adjusting your filters or search terms."
                : "Get started by creating your first task."}
            </p>
            {onCreateTask && (
              <Button onClick={onCreateTask}>
                <Plus className="w-4 h-4 mr-2" />
                Create Task
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
              onEdit={onEditTask}
              compact={compact}
              groups={groups}
            />
          ))}
        </div>
      )}
    </div>
  );
}
