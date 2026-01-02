"use client";

import { AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { ENERGY_LABELS, PRIORITY_LABELS } from "@/lib/task-utils";
import {
  createDateInTimezone,
  formatDateTimeLocalForTimezone,
  parseDateTimeLocalToUTC,
} from "@/lib/timezone-utils";
import type { CreateTaskRequest, TaskGroup, TaskType } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TaskImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: TaskGroup[];
  onImport: () => Promise<void>;
}

interface ParsedTask {
  type: TaskType;
  group: string | null;
  name: string;
  description: string | null;
  duration: number | null;
  dueDate: string | null;
  priority: number | null;
  energyLevel: number | null;
  errors: string[];
  rowNumber: number;
}

type ImportStep = "input" | "preview";

export function TaskImportDialog({ open, onOpenChange, groups, onImport }: TaskImportDialogProps) {
  const { timezone } = useUserTimezone();
  const [step, setStep] = useState<ImportStep>("input");
  const [csvData, setCsvData] = useState("");
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; failed: number } | null>(
    null
  );

  // Reset state when dialog opens/closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setStep("input");
      setCsvData("");
      setParsedTasks([]);
      setImportResults(null);
    }
    onOpenChange(newOpen);
  };

  // Check if first row looks like headers
  const isHeaderRow = (row: string[]): boolean => {
    if (row.length === 0) return false;
    const firstCell = row[0].toLowerCase().trim();
    const headerKeywords = [
      "type",
      "group",
      "name",
      "description",
      "duration",
      "due",
      "date",
      "priority",
      "energy",
    ];
    return headerKeywords.some((keyword) => firstCell.includes(keyword));
  };

  // Simple CSV parser - handles quoted fields and commas
  const parseCSVRow = (row: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      const nextChar = row[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    // Add last field
    result.push(current.trim());
    return result;
  };

  // Parse date with flexible formats and default to 5pm if no time
  const parseDueDate = (dateStr: string | null | undefined): string | null => {
    if (!dateStr || !dateStr.trim()) return null;

    const trimmed = dateStr.trim();

    try {
      // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:mm)
      const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?/);
      if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10) - 1;
        const day = parseInt(isoMatch[3], 10);
        const hours = isoMatch[5] ? parseInt(isoMatch[5], 10) : 17; // Default to 5pm
        const minutes = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;

        const date = new Date(year, month, day);
        const utcDate = createDateInTimezone(date, hours, minutes, timezone);
        return utcDate.toISOString();
      }

      // Try MM/DD/YYYY format
      const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (usMatch) {
        const month = parseInt(usMatch[1], 10) - 1;
        const day = parseInt(usMatch[2], 10);
        const year = parseInt(usMatch[3], 10);

        const date = new Date(year, month, day);
        const utcDate = createDateInTimezone(date, 17, 0, timezone); // Default to 5pm
        return utcDate.toISOString();
      }

      // Try YYYY/MM/DD format
      const isoSlashMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (isoSlashMatch) {
        const year = parseInt(isoSlashMatch[1], 10);
        const month = parseInt(isoSlashMatch[2], 10) - 1;
        const day = parseInt(isoSlashMatch[3], 10);

        const date = new Date(year, month, day);
        const utcDate = createDateInTimezone(date, 17, 0, timezone); // Default to 5pm
        return utcDate.toISOString();
      }

      // Try to parse as general date
      const parsedDate = new Date(trimmed);
      if (!Number.isNaN(parsedDate.getTime())) {
        const year = parsedDate.getFullYear();
        const month = parsedDate.getMonth();
        const day = parsedDate.getDate();
        const utcDate = createDateInTimezone(new Date(year, month, day), 17, 0, timezone); // Default to 5pm
        return utcDate.toISOString();
      }

      return null;
    } catch (error) {
      console.error("Error parsing date:", error);
      return null;
    }
  };

  // Normalize task type (case-insensitive)
  const normalizeTaskType = (type: string): TaskType | null => {
    const normalized = type.toLowerCase().trim();
    if (normalized === "task") return "task";
    if (normalized === "event") return "event";
    if (normalized === "todo") return "todo";
    return null;
  };

  // Validate a single task and return errors
  const validateTask = (task: ParsedTask): string[] => {
    const errors: string[] = [];

    // Validate type
    if (!task.type || !normalizeTaskType(task.type)) {
      errors.push("Type is required and must be Task, Event, or Todo");
    }

    // Validate name
    if (!task.name || !task.name.trim()) {
      errors.push("Name is required");
    }

    // Validate duration if provided
    if (task.duration !== null && (Number.isNaN(task.duration) || task.duration < 0)) {
      errors.push("Duration must be a valid positive number");
    }

    return errors;
  };

  // Update a task field and re-validate
  const updateTaskField = (index: number, field: keyof ParsedTask, value: any) => {
    setParsedTasks((prev) => {
      const updated = [...prev];
      const task = { ...updated[index] };

      if (field === "type") {
        const normalized = normalizeTaskType(value);
        task.type = normalized || (task.type as TaskType);
      } else if (field === "duration") {
        const parsed = value === "" || value === null ? null : parseFloat(value);
        task.duration = Number.isNaN(parsed as number) ? null : parsed;
      } else if (field === "dueDate") {
        // If value is already an ISO string (from datetime-local input), use it directly
        // Otherwise parse it (from CSV parsing)
        if (value && typeof value === "string" && value.includes("T") && value.includes("Z")) {
          task.dueDate = value;
        } else {
          const parsed = parseDueDate(value);
          task.dueDate = parsed;
        }
      } else {
        (task as any)[field] = value === "" ? null : value;
      }

      // Re-validate
      task.errors = validateTask(task);
      updated[index] = task;
      return updated;
    });
  };

  // Format date for input (datetime-local format in user's timezone)
  // If time is midnight (00:00), default to 5pm (17:00)
  const formatDateForInput = (isoString: string | null): string => {
    if (!isoString) return "";
    const formatted = formatDateTimeLocalForTimezone(isoString, timezone);
    // If the formatted time is 00:00, change it to 17:00 (5pm)
    if (formatted?.match(/T00:00$/)) {
      return formatted.replace(/T00:00$/, "T17:00");
    }
    return formatted;
  };

  // Parse and validate CSV data
  const handleParseCSV = () => {
    if (!csvData.trim()) {
      return;
    }

    setIsParsing(true);
    // Use setTimeout to allow UI to update before parsing
    setTimeout(() => {
      const lines = csvData
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim());
      if (lines.length === 0) {
        setIsParsing(false);
        return;
      }

      const tasks: ParsedTask[] = [];
      let startIndex = 0;

      // Check if first row is header
      const firstRow = parseCSVRow(lines[0]);
      if (isHeaderRow(firstRow)) {
        startIndex = 1;
      }

      // Group lookup map
      const groupMap = new Map<string, string>();
      groups.forEach((group) => {
        groupMap.set(group.name, group.id);
      });

      // Parse each row
      for (let i = startIndex; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        const rowNumber = i + 1; // 1-indexed for display

        const errors: string[] = [];

        // Extract columns (type, group, name, description, duration, due date, priority, energy)
        const typeStr = row[0]?.trim() || "";
        const groupStr = row[1]?.trim() || "";
        const nameStr = row[2]?.trim() || "";
        const descriptionStr = row[3]?.trim() || "";
        const durationStr = row[4]?.trim() || "";
        const dueDateStr = row[5]?.trim() || "";
        const priorityStr = row[6]?.trim() || "";
        const energyStr = row[7]?.trim() || "";

        // Validate type (required)
        const type = normalizeTaskType(typeStr);
        if (!type) {
          errors.push("Type is required and must be Task, Event, or Todo");
        }

        // Validate name (required)
        if (!nameStr) {
          errors.push("Name is required");
        }

        // Parse duration
        let duration: number | null = null;
        if (durationStr) {
          const parsed = parseFloat(durationStr);
          if (Number.isNaN(parsed) || parsed < 0) {
            errors.push("Duration must be a valid positive number");
          } else {
            duration = parsed;
          }
        }

        // Parse due date
        let dueDate: string | null = null;
        if (dueDateStr) {
          const parsed = parseDueDate(dueDateStr);
          if (!parsed) {
            errors.push("Due date format is invalid");
          } else {
            dueDate = parsed;
          }
        }

        // Parse priority (1-5 scale, optional)
        let priority: number | null = null;
        if (priorityStr) {
          const parsed = parseInt(priorityStr, 10);
          if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
            errors.push("Priority must be a number between 1 and 5");
          } else {
            priority = parsed;
          }
        }

        // Parse energy level (1-5 scale, optional)
        let energyLevel: number | null = null;
        if (energyStr) {
          const parsed = parseInt(energyStr, 10);
          if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
            errors.push("Energy level must be a number between 1 and 5");
          } else {
            energyLevel = parsed;
          }
        }

        tasks.push({
          type: type || "task", // Default to task if invalid (will show error)
          group: groupStr || null,
          name: nameStr,
          description: descriptionStr || null,
          duration,
          dueDate,
          priority,
          energyLevel,
          errors,
          rowNumber,
        });
      }

      setParsedTasks(tasks);
      setStep("preview");
      setIsParsing(false);
    }, 0);
  };

  // Execute import
  const handleImport = async () => {
    // Filter out tasks with errors
    const validTasks = parsedTasks.filter(
      (task) => task.errors.length === 0 && task.name && task.type
    );

    if (validTasks.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportResults(null);

    try {
      const groupMap = new Map<string, string>();
      groups.forEach((group) => {
        groupMap.set(group.name, group.id);
      });

      // Collect unique group names that need to be created
      const groupsToCreate = new Set<string>();
      validTasks.forEach((task) => {
        if (task.group && !groupMap.has(task.group)) {
          groupsToCreate.add(task.group);
        }
      });

      // Create missing groups
      for (const groupName of groupsToCreate) {
        try {
          const response = await fetch("/api/task-groups", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: groupName,
              color: "#3B82F6", // Default color
            }),
          });

          if (response.ok) {
            const data = await response.json();
            groupMap.set(groupName, data.group.id);
          }
        } catch (error) {
          console.error(`Failed to create group "${groupName}":`, error);
        }
      }

      // Create tasks
      let successCount = 0;
      let failedCount = 0;

      for (const task of validTasks) {
        try {
          const taskData: CreateTaskRequest = {
            title: task.name,
            task_type: task.type,
            description: task.description || undefined,
            duration: task.duration || undefined,
            due_date: task.dueDate || undefined,
            priority: task.priority || 3,
            energy_level_required: task.energyLevel || 3,
            group_id: task.group && groupMap.has(task.group) ? groupMap.get(task.group) : undefined,
          };

          const response = await fetch("/api/tasks", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(taskData),
          });

          if (response.ok) {
            successCount++;
          } else {
            failedCount++;
            console.error(`Failed to create task "${task.name}":`, await response.json());
          }
        } catch (error) {
          failedCount++;
          console.error(`Error creating task "${task.name}":`, error);
        }
      }

      setImportResults({ success: successCount, failed: failedCount });

      // Refresh tasks if any were successful
      if (successCount > 0) {
        await onImport();
      }

      // Close dialog after a short delay if successful
      if (failedCount === 0) {
        setTimeout(() => {
          handleOpenChange(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Error during import:", error);
      setImportResults({ success: 0, failed: validTasks.length });
    } finally {
      setIsImporting(false);
    }
  };

  const hasValidTasks = parsedTasks.some(
    (task) => task.errors.length === 0 && task.name && task.type
  );
  const errorCount = parsedTasks.filter((task) => task.errors.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!max-w-[1800px] max-h-[90vh] overflow-y-auto w-[95vw] mx-2 md:mx-auto">
        <DialogHeader>
          <DialogTitle>Import Tasks from CSV</DialogTitle>
          <DialogDescription>
            {step === "input" ? (
              <div className="space-y-2 pt-2">
                <p>
                  Paste your CSV data below. You can edit the data in the preview step before
                  importing.
                </p>
                <div className="bg-muted/50 rounded-md p-3 text-xs font-mono">
                  <div className="font-semibold mb-1">CSV Format:</div>
                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Required:</span> type, name
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Optional:</span> group,
                      description, duration (minutes), due date, priority (1-5), energy (1-5)
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1 pt-2">
                <p>
                  Review and edit the parsed tasks below. Make any necessary changes before
                  importing.
                </p>
                {errorCount > 0 && (
                  <p className="text-destructive font-medium">
                    ⚠️ {errorCount} row(s) have errors that must be fixed before importing.
                  </p>
                )}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="csv-data" className="text-sm font-medium">
                CSV Data
              </label>
              <Textarea
                id="csv-data"
                value={csvData}
                onChange={(e) => setCsvData(e.target.value)}
                placeholder={`type,group,name,description,duration,due date,priority,energy
Task,Work,Complete project,Finish the documentation,60,2025-12-31,3,3
Event,Personal,Doctor appointment,,,2025-12-15,,
Todo,Home,Buy groceries,Get milk and eggs,30,2025-12-20,2,2`}
                className="min-h-[300px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Headers are automatically detected and ignored. Type must be: Task, Event, or Todo
                (case-insensitive).
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Import Results */}
            {importResults && (
              <div
                className={cn(
                  "p-4 rounded-lg",
                  importResults.failed === 0
                    ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                    : "bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800"
                )}
              >
                <div className="flex items-center gap-2">
                  {importResults.failed === 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  )}
                  <div>
                    <p className="font-medium">
                      {importResults.failed === 0
                        ? `Successfully imported ${importResults.success} task(s)`
                        : `Imported ${importResults.success} task(s), ${importResults.failed} failed`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Row</th>
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-left font-medium">Group</th>
                      <th className="px-4 py-2 text-left font-medium">Name</th>
                      <th className="px-4 py-2 text-left font-medium">Description</th>
                      <th className="px-4 py-2 text-left font-medium">Duration</th>
                      <th className="px-4 py-2 text-left font-medium">Due Date</th>
                      <th className="px-4 py-2 text-left font-medium">Priority</th>
                      <th className="px-4 py-2 text-left font-medium">Energy</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTasks.map((task, index) => {
                      const hasError = task.errors.length > 0 || !task.name || !task.type;
                      const taskKey = `task-row-${task.rowNumber || index}-${task.name || "unnamed"}`;
                      return (
                        <tr
                          key={taskKey}
                          className={cn(
                            "border-t",
                            hasError ? "bg-red-50 dark:bg-red-950/20" : "hover:bg-muted/50"
                          )}
                        >
                          <td className="px-4 py-2">{task.rowNumber}</td>
                          <td className="px-4 py-2">
                            <Select
                              value={task.type}
                              onValueChange={(value) => updateTaskField(index, "type", value)}
                            >
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="task">Task</SelectItem>
                                <SelectItem value="event">Event</SelectItem>
                                <SelectItem value="todo">Todo</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              value={task.group || ""}
                              onChange={(e) => updateTaskField(index, "group", e.target.value)}
                              placeholder="Group name"
                              className="w-32 h-8"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              value={task.name}
                              onChange={(e) => updateTaskField(index, "name", e.target.value)}
                              placeholder="Task name"
                              className="w-48 h-8"
                              aria-invalid={!task.name}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              value={task.description || ""}
                              onChange={(e) =>
                                updateTaskField(index, "description", e.target.value)
                              }
                              placeholder="Description"
                              className="w-64 h-8"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              type="number"
                              value={task.duration || ""}
                              onChange={(e) => updateTaskField(index, "duration", e.target.value)}
                              placeholder="Minutes"
                              className="w-24 h-8"
                              min="0"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              type="datetime-local"
                              value={formatDateForInput(task.dueDate)}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value) {
                                  // Check if time is 00:00 (midnight) - default to 5pm (17:00)
                                  let dateTimeValue = value;
                                  if (value.match(/T00:00$/)) {
                                    dateTimeValue = value.replace(/T00:00$/, "T17:00");
                                  }
                                  const utcDate = parseDateTimeLocalToUTC(dateTimeValue, timezone);
                                  updateTaskField(index, "dueDate", utcDate || null);
                                } else {
                                  updateTaskField(index, "dueDate", null);
                                }
                              }}
                              onBlur={(e) => {
                                // On blur, if time is still 00:00, default to 17:00
                                const value = e.target.value;
                                if (value?.match(/T00:00$/)) {
                                  const dateTimeValue = value.replace(/T00:00$/, "T17:00");
                                  const utcDate = parseDateTimeLocalToUTC(dateTimeValue, timezone);
                                  updateTaskField(index, "dueDate", utcDate || null);
                                  // Update the input value to show 17:00
                                  e.target.value = dateTimeValue;
                                }
                              }}
                              className="w-48 h-8"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Select
                              value={(task.priority || 3).toString()}
                              onValueChange={(value) =>
                                updateTaskField(index, "priority", parseInt(value, 10))
                              }
                            >
                              <SelectTrigger className="w-32 h-8">
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
                          </td>
                          <td className="px-4 py-2">
                            <Select
                              value={(task.energyLevel || 3).toString()}
                              onValueChange={(value) =>
                                updateTaskField(index, "energyLevel", parseInt(value, 10))
                              }
                            >
                              <SelectTrigger className="w-32 h-8">
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
                          </td>
                          <td className="px-4 py-2">
                            {hasError ? (
                              <div className="flex items-center gap-1 text-destructive text-xs">
                                <AlertCircle className="h-3 w-3" />
                                <span>Error</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Valid</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Error Details */}
            {errorCount > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-destructive">Errors:</h4>
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2 max-h-40 overflow-y-auto">
                  {parsedTasks
                    .filter((task) => task.errors.length > 0 || !task.name || !task.type)
                    .map((task) => (
                      <div
                        key={`error-${task.rowNumber}-${task.name || "unnamed"}`}
                        className="text-sm"
                      >
                        <span className="font-medium">Row {task.rowNumber}:</span>{" "}
                        {task.errors.length > 0
                          ? task.errors.join(", ")
                          : !task.name
                            ? "Name is required"
                            : !task.type
                              ? "Type is required"
                              : ""}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm">
                <span className="font-medium">{parsedTasks.length}</span> total row(s),{" "}
                <span className="font-medium text-green-600 dark:text-green-400">
                  {parsedTasks.filter((t) => t.errors.length === 0 && t.name && t.type).length}
                </span>{" "}
                valid, <span className="font-medium text-destructive">{errorCount}</span> with
                errors
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "input" ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleParseCSV} loading={isParsing} disabled={!csvData.trim() || isParsing}>
                <Upload className="h-4 w-4 mr-2" />
                {isParsing ? "Parsing..." : "Parse CSV"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("input")} disabled={isImporting}>
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button onClick={handleImport} loading={isImporting} disabled={!hasValidTasks || isImporting}>
                <Upload className="h-4 w-4 mr-2" />
                {isImporting
                  ? "Importing..."
                  : `Import ${parsedTasks.filter((t) => t.errors.length === 0 && t.name && t.type).length} Task(s)`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
