"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import type { GroupScheduleHours, ReminderSettings, TaskGroup } from "@/lib/types";

interface EditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: TaskGroup | null;
  groups: TaskGroup[];
  onGroupUpdated?: () => void;
}

export function EditGroupDialog({
  open,
  onOpenChange,
  group,
  groups,
  onGroupUpdated,
}: EditGroupDialogProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3B82F6");
  const [newParentGroupId, setNewParentGroupId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [autoScheduleEnabled, setAutoScheduleEnabled] = useState(false);
  const [autoScheduleHours, setAutoScheduleHours] = useState<GroupScheduleHours>({});
  const [isAutoScheduleExpanded, setIsAutoScheduleExpanded] = useState(false);
  const [priority, setPriority] = useState<number>(5);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);
  const [isReminderExpanded, setIsReminderExpanded] = useState(false);

  // Initialize form when group changes
  useEffect(() => {
    if (group) {
      setNewGroupName(group.name);
      setNewGroupColor(group.color);
      setNewParentGroupId(group.parent_group_id || null);
      setAutoScheduleEnabled(group.auto_schedule_enabled ?? false);
      setAutoScheduleHours(group.auto_schedule_hours || {});
      setPriority(group.priority ?? 5);
      setReminderSettings(group.reminder_settings ?? null);
    }
  }, [group]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setNewGroupName("");
      setNewGroupColor("#3B82F6");
      setNewParentGroupId(null);
      setAutoScheduleEnabled(false);
      setAutoScheduleHours({});
      setIsAutoScheduleExpanded(false);
      setPriority(5);
      setReminderSettings(null);
      setIsReminderExpanded(false);
    }
  }, [open]);

  // Get available parent groups (exclude current group and its descendants)
  const getAvailableParentGroups = (excludeGroupId?: string): TaskGroup[] => {
    const excludeIds = new Set<string>();
    if (excludeGroupId) {
      excludeIds.add(excludeGroupId);
      // Find all descendants
      const findDescendants = (parentId: string) => {
        groups.forEach((g) => {
          if (g.parent_group_id === parentId) {
            excludeIds.add(g.id);
            findDescendants(g.id);
          }
        });
      };
      findDescendants(excludeGroupId);
    }
    return groups.filter((g) => g.is_parent_group && !excludeIds.has(g.id));
  };

  const updateGroup = async () => {
    if (!group || !newGroupName.trim()) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/task-groups/${group.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newGroupName.trim(),
          color: newGroupColor,
          parent_group_id: newParentGroupId || null,
          auto_schedule_enabled: autoScheduleEnabled,
          auto_schedule_hours: autoScheduleEnabled ? autoScheduleHours : null,
          priority,
          reminder_settings: reminderSettings,
        }),
      });

      if (response.ok) {
        const _data = await response.json();
        toast.success("Task group updated successfully");
        onGroupUpdated?.();
        onOpenChange(false);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Failed to update task group" }));
        toast.error(errorData.error || "Failed to update task group. Please try again.");
      }
    } catch (error) {
      console.error("Error updating task group:", error);
      toast.error("An error occurred while updating the task group. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>Update the group name, color, and parent group.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-1">Group Name</div>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Enter group name"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="group-color-input-edit" className="text-sm font-medium">
              Color
            </label>
            <div className="mt-1 flex items-center gap-3">
              <div className="relative">
                <input
                  id="group-color-input-edit"
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
          {!group.is_parent_group && (
            <div>
              <label htmlFor="parent-group-select-edit" className="text-sm font-medium">
                Parent Group
              </label>
              <Select
                value={newParentGroupId || "__none__"}
                onValueChange={(value) => setNewParentGroupId(value === "__none__" ? null : value)}
              >
                <SelectTrigger id="parent-group-select-edit" className="mt-1 w-full">
                  <SelectValue placeholder="None (top-level group)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (top-level group)</SelectItem>
                  {getAvailableParentGroups(group.id).map((parentGroup) => (
                    <SelectItem key={parentGroup.id} value={parentGroup.id}>
                      {parentGroup.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!group.is_parent_group && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-3 border-b cursor-pointer hover:bg-accent/50 transition-colors flex items-center justify-between bg-card"
                onClick={() => setIsAutoScheduleExpanded(!isAutoScheduleExpanded)}
              >
                <div className="flex items-center gap-2">
                  {isAutoScheduleExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <h3 className="text-sm font-semibold">Auto-Schedule Settings</h3>
                </div>
              </button>
              {isAutoScheduleExpanded && (
                <div className="p-4 space-y-4">
                  <div>
                    <label htmlFor="priority-select-edit" className="text-sm font-medium">
                      Priority
                    </label>
                    <div className="text-xs text-muted-foreground mb-1">
                      1 = Highest priority, 10 = Lowest priority (used as tie-breaker in scheduling)
                    </div>
                    <Select
                      value={priority.toString()}
                      onValueChange={(value) => setPriority(parseInt(value, 10))}
                    >
                      <SelectTrigger id="priority-select-edit" className="mt-1 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                          <SelectItem key={p} value={p.toString()}>
                            {p} {p === 1 ? "(Highest)" : p === 10 ? "(Lowest)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="auto-schedule-enabled" className="text-sm font-medium">
                      Enable Auto-Scheduling
                    </label>
                    <Switch
                      id="auto-schedule-enabled"
                      checked={autoScheduleEnabled}
                      onCheckedChange={setAutoScheduleEnabled}
                    />
                  </div>
                  {autoScheduleEnabled && (
                    <div className="space-y-3 pt-2 border-t">
                      <div className="text-xs text-muted-foreground mb-2">
                        Select days and time ranges when tasks can be automatically scheduled
                      </div>
                      {(
                        [
                          { key: "monday", label: "Monday" },
                          { key: "tuesday", label: "Tuesday" },
                          { key: "wednesday", label: "Wednesday" },
                          { key: "thursday", label: "Thursday" },
                          { key: "friday", label: "Friday" },
                          { key: "saturday", label: "Saturday" },
                          { key: "sunday", label: "Sunday" },
                        ] as const
                      ).map((day) => {
                        const daySchedule = autoScheduleHours[day.key as keyof GroupScheduleHours];
                        const isDayEnabled = daySchedule !== null && daySchedule !== undefined;
                        const startHour = daySchedule?.start ?? 9;
                        const endHour = daySchedule?.end ?? 17;

                        return (
                          <div key={day.key} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`day-${day.key}`}
                                checked={isDayEnabled}
                                onCheckedChange={(checked) => {
                                  setAutoScheduleHours((prev) => ({
                                    ...prev,
                                    [day.key]: checked ? { start: startHour, end: endHour } : null,
                                  }));
                                }}
                              />
                              <label
                                htmlFor={`day-${day.key}`}
                                className="text-sm font-medium flex-1 cursor-pointer"
                              >
                                {day.label}
                              </label>
                            </div>
                            {isDayEnabled && (
                              <div className="ml-6 flex items-center gap-4 py-2 px-2">
                                <div className="flex items-center gap-2.5">
                                  <label
                                    htmlFor={`start-${day.key}`}
                                    className="text-xs text-muted-foreground whitespace-nowrap"
                                  >
                                    Start:
                                  </label>
                                  <Select
                                    value={startHour.toString()}
                                    onValueChange={(value) => {
                                      const newStart = parseInt(value, 10);
                                      const currentEnd =
                                        autoScheduleHours[day.key as keyof GroupScheduleHours]
                                          ?.end ?? 17;
                                      setAutoScheduleHours((prev) => ({
                                        ...prev,
                                        [day.key]: {
                                          start: newStart,
                                          end: currentEnd > newStart ? currentEnd : newStart + 1,
                                        },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger
                                      id={`start-${day.key}`}
                                      className="h-8 min-w-[5rem] px-3"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Array.from({ length: 24 }, (_, i) => {
                                        const hourValue = i.toString();
                                        return (
                                          <SelectItem key={hourValue} value={hourValue}>
                                            {hourValue.padStart(2, "0")}:00
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <span className="text-xs text-muted-foreground px-1">to</span>
                                <div className="flex items-center gap-2.5">
                                  <label
                                    htmlFor={`end-${day.key}`}
                                    className="text-xs text-muted-foreground whitespace-nowrap"
                                  >
                                    End:
                                  </label>
                                  <Select
                                    value={endHour.toString()}
                                    onValueChange={(value) => {
                                      const newEnd = parseInt(value, 10);
                                      const currentStart =
                                        autoScheduleHours[day.key as keyof GroupScheduleHours]
                                          ?.start ?? 9;
                                      setAutoScheduleHours((prev) => ({
                                        ...prev,
                                        [day.key]: { start: currentStart, end: newEnd },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger
                                      id={`end-${day.key}`}
                                      className="h-8 min-w-[5rem] px-3"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Array.from({ length: 24 }, (_, i) => {
                                        const currentStart =
                                          autoScheduleHours[day.key as keyof GroupScheduleHours]
                                            ?.start ?? 9;
                                        if (i <= currentStart) return null;
                                        const hourValue = i.toString();
                                        return (
                                          <SelectItem key={hourValue} value={hourValue}>
                                            {hourValue.padStart(2, "0")}:00
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Reminder Notifications */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full px-4 py-3 border-b cursor-pointer hover:bg-accent/50 transition-colors flex items-center justify-between bg-card"
              onClick={() => setIsReminderExpanded(!isReminderExpanded)}
            >
              <div className="flex items-center gap-2">
                {isReminderExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <h3 className="text-sm font-semibold">Reminder Notifications</h3>
              </div>
            </button>
            {isReminderExpanded && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="reminder-enabled" className="text-sm font-medium">
                    Enable Reminders
                  </label>
                  <Switch
                    id="reminder-enabled"
                    checked={reminderSettings?.enabled ?? false}
                    onCheckedChange={(checked) =>
                      setReminderSettings((prev) => ({
                        enabled: checked,
                        min_priority: prev?.min_priority ?? 3,
                        lead_time_minutes: prev?.lead_time_minutes ?? null,
                        on_time_reminder: prev?.on_time_reminder ?? true,
                        due_date_lead_minutes: prev?.due_date_lead_minutes ?? null,
                      }))
                    }
                  />
                </div>
                {reminderSettings?.enabled && (
                  <div className="space-y-4 pt-2 border-t">
                    <div>
                      <label htmlFor="reminder-min-priority" className="text-sm font-medium">
                        Remind for priorities
                      </label>
                      <div className="text-xs text-muted-foreground mb-1">
                        Remind for tasks with priority 1 (Critical) through selected value
                      </div>
                      <Select
                        value={(reminderSettings.min_priority ?? 3).toString()}
                        onValueChange={(value) =>
                          setReminderSettings((prev) =>
                            prev ? { ...prev, min_priority: parseInt(value, 10) } : prev
                          )
                        }
                      >
                        <SelectTrigger id="reminder-min-priority" className="mt-1 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((p) => (
                            <SelectItem key={p} value={p.toString()}>
                              1 (Critical) through {p}{" "}
                              {p === 1 ? "(Critical only)" : p === 5 ? "(All)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label htmlFor="reminder-lead-time" className="text-sm font-medium">
                        Lead time reminder
                      </label>
                      <div className="text-xs text-muted-foreground mb-1">
                        Send a reminder before the task starts
                      </div>
                      <Select
                        value={(reminderSettings.lead_time_minutes ?? "off").toString()}
                        onValueChange={(value) =>
                          setReminderSettings((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lead_time_minutes: value === "off" ? null : parseInt(value, 10),
                                }
                              : prev
                          )
                        }
                      >
                        <SelectTrigger id="reminder-lead-time" className="mt-1 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="5">5 minutes before</SelectItem>
                          <SelectItem value="10">10 minutes before</SelectItem>
                          <SelectItem value="15">15 minutes before</SelectItem>
                          <SelectItem value="30">30 minutes before</SelectItem>
                          <SelectItem value="60">1 hour before</SelectItem>
                          <SelectItem value="120">2 hours before</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="reminder-ontime" className="text-sm font-medium">
                        On-time reminder
                      </label>
                      <Switch
                        id="reminder-ontime"
                        checked={reminderSettings.on_time_reminder ?? false}
                        onCheckedChange={(checked) =>
                          setReminderSettings((prev) =>
                            prev ? { ...prev, on_time_reminder: checked } : prev
                          )
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="reminder-due-lead" className="text-sm font-medium">
                        Due date reminder
                      </label>
                      <div className="text-xs text-muted-foreground mb-1">
                        For tasks with no scheduled time — remind before the due date
                      </div>
                      <Select
                        value={(reminderSettings.due_date_lead_minutes ?? "off").toString()}
                        onValueChange={(value) =>
                          setReminderSettings((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  due_date_lead_minutes:
                                    value === "off" ? null : parseInt(value, 10),
                                }
                              : prev
                          )
                        }
                      >
                        <SelectTrigger id="reminder-due-lead" className="mt-1 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="30">30 minutes before</SelectItem>
                          <SelectItem value="60">1 hour before</SelectItem>
                          <SelectItem value="120">2 hours before</SelectItem>
                          <SelectItem value="1440">1 day before</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
        </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button
              onClick={updateGroup}
              loading={isUpdating}
              disabled={!newGroupName.trim() || isUpdating}
            >
              {isUpdating ? "Updating..." : "Update Group"}
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
}
